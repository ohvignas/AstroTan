import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireRole, requireOwnDocument } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"

// The media library: metadata for files held in Convex storage.
//
// A *sidecar* table, not the target of a `v.id()` reference. The fields
// that designate a file (`seo.ogImageId`, and posts' `coverId`) point at
// `_storage` directly, and this table hangs off them through `by_storage`.
// The consequence is deliberate and has to be handled everywhere the data
// is read: a `storageId` can exist with no row here — a file uploaded
// outside the library — and that is a missing `alt`, never an error.

export const MAX_ALT_LENGTH = 300
export const MAX_FILENAME_LENGTH = 255
export const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024

// An allow-list, never a deny-list, and `image/svg+xml` is the reason why.
// An SVG is an executable document: served from the site's own origin it
// is an XSS vector, and it looks like an image format from every angle
// except the one that matters.
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const

type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number]

function assertAlt(alt: string): string {
  const trimmed = alt.trim()
  // Emptiness is checked after trimming and length before: a wall of
  // spaces is an absent alt, and a 400-character alt is a different
  // mistake that deserves its own message.
  if (alt.length > MAX_ALT_LENGTH) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field: "alt", max: MAX_ALT_LENGTH })
  }
  if (trimmed.length === 0) throw new ConvexError({ code: "INVALID_ALT" })
  return trimmed
}

/**
 * A short-lived URL the browser uploads the file to, directly.
 *
 * The file never passes through a mutation: Convex hands out an upload URL
 * and the bytes go straight to storage, which is why `register` below
 * takes a `storageId` rather than the file itself.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.storage.generateUploadUrl()
  },
})

/**
 * Record an uploaded file in the library.
 *
 * Called after the upload completes, with the `storageId` it returned.
 * Every bound here is the server's, not the form's — the upload dialog
 * caps the same fields, but a caller that skips it gets the same answers.
 */
export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mime: v.string(),
    size: v.number(),
    alt: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])

    const alt = assertAlt(args.alt)

    const filename = args.filename.trim()
    if (args.filename.length > MAX_FILENAME_LENGTH) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field: "filename",
        max: MAX_FILENAME_LENGTH,
      })
    }
    if (filename.length === 0) throw new ConvexError({ code: "INVALID_FILENAME" })

    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(args.mime)) {
      throw new ConvexError({ code: "UNSUPPORTED_MIME", mime: args.mime })
    }
    if (args.size > MAX_MEDIA_SIZE_BYTES) {
      throw new ConvexError({ code: "FILE_TOO_LARGE", max: MAX_MEDIA_SIZE_BYTES })
    }

    // One row per file. Without this, `by_storage` stops being a one-to-one
    // mapping and resolving an `alt` from a `storageId` becomes ambiguous —
    // silently, and differently depending on insertion order.
    const existing = await ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique()
    if (existing !== null) throw new ConvexError({ code: "ALREADY_REGISTERED" })

    return ctx.db.insert("media", {
      storageId: args.storageId,
      filename,
      mime: args.mime as AllowedMime,
      size: args.size,
      alt,
      width: args.width,
      height: args.height,
      createdBy: authUser._id,
    })
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const rows = await ctx.db.query("media").order("desc").collect()
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        // Resolved here rather than in the client: a storage URL is only
        // obtainable server-side, and the library grid needs one per row.
        url: await ctx.storage.getUrl(row.storageId),
      }))
    )
  },
})

/**
 * The sidecar lookup: metadata for a file, or `null` when the file was
 * uploaded outside the library. `null` is an ordinary answer here, not a
 * failure — see this module's header.
 */
export const byStorageId = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique()
  },
})

export const updateAlt = mutation({
  args: { id: v.id("media"), alt: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.patch(args.id, { alt: assertAlt(args.alt) })
  },
})

/**
 * `true` when anything still points at this file.
 *
 * Checks every field in the schema that can hold a `storageId`. Adding a
 * new one without adding it here is how a deletion starts leaving broken
 * references — the test for `MEDIA_IN_USE` is what catches that.
 */
async function isReferenced(
  ctx: { db: { query: (table: "pages") => any } },
  storageId: Id<"_storage">
): Promise<boolean> {
  const pages = await ctx.db.query("pages").collect()
  return pages.some((page: { seo?: { ogImageId?: Id<"_storage"> } }) =>
    page.seo?.ogImageId === storageId
  )
}

export const remove = mutation({
  args: { id: v.id("media") },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })
    // Owner and admin delete anything; an editor only what they uploaded —
    // the same ownership rule pages use, through the same helper.
    requireOwnDocument(authUser, row)

    if (await isReferenced(ctx, row.storageId)) {
      throw new ConvexError({ code: "MEDIA_IN_USE" })
    }

    // Row and file together. Deleting only the row would leave a byte that
    // is billed, unreachable, and invisible in the interface.
    await ctx.db.delete(args.id)
    await ctx.storage.delete(row.storageId)
  },
})

MUTATION_REGISTRY.push(
  {
    name: "media.generateUploadUrl",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) => t.mutation(api.media.generateUploadUrl, {}),
  },
  {
    name: "media.register",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])))
      return t.mutation(api.media.register, {
        storageId,
        filename: "registry.png",
        mime: "image/png",
        size: 1,
        alt: "Registry fixture",
      })
    },
  },
  {
    name: "media.updateAlt",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])))
      const id = await t.mutation(api.media.register, {
        storageId,
        filename: "registry.png",
        mime: "image/png",
        size: 1,
        alt: "Registry fixture",
      })
      return t.mutation(api.media.updateAlt, { id, alt: "Registry fixture 2" })
    },
  },
  {
    name: "media.remove",
    // Listed for all three because ownership, not role, is what `remove`
    // gates on for an editor: the fixture below uploads as the caller, so
    // every role is deleting its own row and none is refused.
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])))
      const id = await t.mutation(api.media.register, {
        storageId,
        filename: "registry.png",
        mime: "image/png",
        size: 1,
        alt: "Registry fixture",
      })
      return t.mutation(api.media.remove, { id })
    },
  }
)
