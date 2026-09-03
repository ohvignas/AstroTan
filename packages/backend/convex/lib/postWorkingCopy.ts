import { v } from "convex/values"
import type { Infer } from "convex/values"
import { geoValidator, seoValidator } from "../content"

export const postWorkingCopyValidator = v.object({
  slug: v.string(),
  title: v.string(),
  excerpt: v.optional(v.string()),
  coverId: v.optional(v.id("_storage")),
  body: v.string(),
  seo: v.optional(seoValidator),
  geo: v.optional(geoValidator),
  targetKeyword: v.optional(v.string()),
  tagIds: v.array(v.id("tags")),
})

export type WorkingCopy = Infer<typeof postWorkingCopyValidator>

export type WorkingPatch = {
  title?: string
  slug?: string
  body?: string
  excerpt?: string
  coverId?: WorkingCopy["coverId"] | null
  seo?: WorkingCopy["seo"]
  geo?: WorkingCopy["geo"]
  targetKeyword?: string | null
  tagIds?: WorkingCopy["tagIds"]
}

export function snapshotLive(post: WorkingCopy): WorkingCopy {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverId: post.coverId,
    body: post.body,
    seo: post.seo,
    geo: post.geo,
    targetKeyword: post.targetKeyword,
    tagIds: post.tagIds,
  }
}

export function applyWorkingPatch(base: WorkingCopy, patch: WorkingPatch): WorkingCopy {
  const next: WorkingCopy = { ...base }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.slug !== undefined) next.slug = patch.slug
  if (patch.body !== undefined) next.body = patch.body
  if (patch.excerpt !== undefined) next.excerpt = patch.excerpt
  if (patch.seo !== undefined) next.seo = patch.seo
  if (patch.geo !== undefined) next.geo = patch.geo
  if (patch.tagIds !== undefined) next.tagIds = patch.tagIds
  if (patch.coverId === null) delete next.coverId
  else if (patch.coverId !== undefined) next.coverId = patch.coverId
  if (patch.targetKeyword === null) delete next.targetKeyword
  else if (patch.targetKeyword !== undefined) next.targetKeyword = patch.targetKeyword
  return next
}

export function overlayForEditor<T extends WorkingCopy>(
  post: T & { workingCopy?: WorkingCopy },
): T & { hasUnpublishedChanges: boolean } {
  if (post.workingCopy === undefined) {
    return { ...post, hasUnpublishedChanges: false }
  }
  const working = post.workingCopy
  return {
    ...post,
    title: working.title,
    slug: working.slug,
    excerpt: working.excerpt,
    body: working.body,
    coverId: working.coverId,
    seo: working.seo,
    geo: working.geo,
    targetKeyword: working.targetKeyword,
    tagIds: working.tagIds,
    hasUnpublishedChanges: true,
  }
}

export function applyWorkingToLive<T extends WorkingCopy>(
  post: T & { workingCopy?: WorkingCopy },
): T {
  const overlaid = overlayForEditor(post)
  const rest = { ...overlaid } as T & {
    workingCopy?: WorkingCopy
    hasUnpublishedChanges?: boolean
  }
  delete rest.workingCopy
  delete rest.hasUnpublishedChanges
  return rest
}
