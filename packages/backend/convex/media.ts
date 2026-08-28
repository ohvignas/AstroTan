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

// The bounds live in `content.ts` and are re-exported here so existing
// importers do not have to know they moved. They had to leave this module:
// the admin's upload and edit dialogs cap the same fields, and importing
// them from here dragged this file's whole graph — `_generated/server`,
// `_registry`, `lib/authz` → `auth.ts` — into the browser bundle, which
// the Convex client reports as "Convex functions should not be imported in
// the browser. This will throw an error in future versions of `convex`",
// once per function definition it finds.
import {
  ALLOWED_MIME_TYPES,
  MAX_ALT_LENGTH,
  MAX_FILENAME_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
} from "./content"

export {
  ALLOWED_MIME_TYPES,
  MAX_ALT_LENGTH,
  MAX_FILENAME_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
}

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

function assertFilename(raw: string): string {
  if (raw.length > MAX_FILENAME_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "filename",
      max: MAX_FILENAME_LENGTH,
    })
  }
  const filename = raw.trim()
  if (filename.length === 0) throw new ConvexError({ code: "INVALID_FILENAME" })
  return filename
}

/** The two checks `register` and `replaceFile` must answer identically. */
function assertMimeAndSize(mime: string, size: number): void {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ConvexError({ code: "UNSUPPORTED_MIME", mime })
  }
  if (size > MAX_MEDIA_SIZE_BYTES) {
    throw new ConvexError({ code: "FILE_TOO_LARGE", max: MAX_MEDIA_SIZE_BYTES })
  }
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

    const filename = assertFilename(args.filename)
    assertMimeAndSize(args.mime, args.size)

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
 * A storage URL for a file, readable without a session.
 *
 * Deliberately public and deliberately narrow: it takes a `storageId` the
 * caller already has and returns only a URL. `apps/web` needs the site's
 * logo on every page and carries no session, and the alternative — making
 * the whole `media` row public to get one URL — would expose who uploaded
 * what to anyone who asks.
 */
export const publicUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => ctx.storage.getUrl(args.storageId),
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

/**
 * Edit what a media item *says* — its displayed name and its alt text.
 *
 * Both fields are optional, and only what the caller sends is patched: the
 * dialog can save one field without re-reading and re-sending the other.
 * Neither can be blanked — an empty alt is refused here exactly as it is at
 * upload, or "required at upload" would only mean "required once".
 */
export const update = mutation({
  args: {
    id: v.id("media"),
    filename: v.optional(v.string()),
    alt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })

    const patch: { filename?: string; alt?: string } = {}
    if (args.alt !== undefined) patch.alt = assertAlt(args.alt)
    if (args.filename !== undefined) patch.filename = assertFilename(args.filename)
    await ctx.db.patch(args.id, patch)
  },
})

/**
 * Swap the file behind a media item, keeping the row and its id.
 *
 * This is what makes "replace this image" possible without breaking every
 * reference to it: a post's `coverId` and a page's `seo.ogImageId` point at
 * a `storageId`, so those are re-pointed here, in the same transaction that
 * swaps the row — otherwise replacing an image would silently detach it
 * from everything using it.
 *
 * The previous file is deleted last. Deleting it first would leave a window
 * where the row points at nothing.
 */
export const replaceFile = mutation({
  args: {
    id: v.id("media"),
    storageId: v.id("_storage"),
    mime: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, row)

    assertMimeAndSize(args.mime, args.size)

    const alreadyKnown = await ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique()
    if (alreadyKnown !== null && alreadyKnown._id !== args.id) {
      throw new ConvexError({ code: "ALREADY_REGISTERED" })
    }

    const previous = row.storageId

    await ctx.db.patch(args.id, {
      storageId: args.storageId,
      mime: args.mime as AllowedMime,
      size: args.size,
      // Re-derived, never carried over: the new file has its own
      // dimensions, and keeping the old ones would reintroduce the layout
      // shift the fields exist to prevent.
      width: args.width,
      height: args.height,
      ...(args.filename !== undefined
        ? { filename: assertFilename(args.filename) }
        : {}),
    })

    // Everything that pointed at the old file now points at the new one.
    // Without this, replacing an image would leave every post and page
    // using it pointing at a file that is about to be deleted.
    for (const post of await ctx.db.query("posts").collect()) {
      if (post.coverId === previous) {
        await ctx.db.patch(post._id, { coverId: args.storageId })
      }
    }
    for (const page of await ctx.db.query("pages").collect()) {
      if (page.seo?.ogImageId === previous) {
        await ctx.db.patch(page._id, {
          seo: { ...page.seo, ogImageId: args.storageId },
        })
      }
    }

    if (previous !== args.storageId) await ctx.storage.delete(previous)
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
  ctx: { db: { query: (table: "pages" | "posts" | "settings") => any } },
  storageId: Id<"_storage">
): Promise<boolean> {
  const pages = await ctx.db.query("pages").collect()
  if (
    pages.some(
      (page: { seo?: { ogImageId?: Id<"_storage"> } }) =>
        page.seo?.ogImageId === storageId
    )
  ) {
    return true
  }
  // `posts.coverId` and `posts.seo.ogImageId` were added after this
  // function, and missing them is exactly the failure its own header warns
  // about: deleting an image still used as an article's cover was allowed,
  // leaving that article pointing at a file that no longer exists.
  const posts = await ctx.db.query("posts").collect()
  if (
    posts.some(
      (post: { coverId?: Id<"_storage">; seo?: { ogImageId?: Id<"_storage"> } }) =>
        post.coverId === storageId || post.seo?.ogImageId === storageId
    )
  ) {
    return true
  }

  // Les réglages du site — troisième oubli du même genre, et celui qui se
  // voit le plus : supprimer le média servant de logo était autorisé, la
  // référence restait, et l'écran des réglages affichait « fichier hors
  // médiathèque » sans que personne comprenne pourquoi. Trois champs, et
  // ils tiennent dans une seule ligne.
  const settings = await ctx.db.query("settings").collect()
  return settings.some(
    (row: {
      logoId?: Id<"_storage">
      iconId?: Id<"_storage">
      defaultSeo?: { ogImageId?: Id<"_storage"> }
    }) =>
      row.logoId === storageId ||
      row.iconId === storageId ||
      row.defaultSeo?.ogImageId === storageId
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
    name: "media.update",
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
      return t.mutation(api.media.update, { id, alt: "Registry fixture 2" })
    },
  },
  {
    name: "media.replaceFile",
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
      const next = await t.run((ctx: any) => ctx.storage.store(new Blob(["y"])))
      return t.mutation(api.media.replaceFile, {
        id,
        storageId: next,
        mime: "image/png",
        size: 1,
      })
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
