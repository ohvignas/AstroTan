import type { GenericActionCtx } from "convex/server"
import type { DataModel, Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import type { ApiRoute } from "./apiRoutes"

type Ctx = GenericActionCtx<DataModel>

export async function dispatchApi(
  ctx: Ctx,
  method: string,
  route: ApiRoute,
  acteurId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (route.resource === "posts") return posts(ctx, method, route, acteurId, body)
  if (route.resource === "leads") return leads(ctx, route)
  if (route.resource === "pages") return pages(ctx, method, route, acteurId, body)
  if (route.resource === "tags") return tags(ctx, method, acteurId, body)
  return { status: 404, body: { error: "NOT_FOUND" } }
}

async function posts(
  ctx: Ctx,
  method: string,
  route: ApiRoute,
  acteurId: string,
  body: Record<string, unknown>,
) {
  if (!route.id) {
    if (method === "POST") {
      const id = await ctx.runMutation(internal.siteApi.createPost, {
        title: String(body.title ?? ""),
        slug: String(body.slug ?? ""),
        acteurId,
      })
      return { status: 201, body: await ctx.runQuery(internal.siteApi.getPost, { id }) }
    }
    return { status: 200, body: await ctx.runQuery(internal.siteApi.listPosts, {}) }
  }
  const id = route.id as Id<"posts">
  if (route.action === "publish") {
    await ctx.runMutation(internal.siteApi.publishPost, { id, acteurId })
    return { status: 200, body: await ctx.runQuery(internal.siteApi.getPost, { id }) }
  }
  if (route.action === "unpublish") {
    await ctx.runMutation(internal.siteApi.unpublishPost, { id, acteurId })
    return { status: 200, body: await ctx.runQuery(internal.siteApi.getPost, { id }) }
  }
  if (method === "PATCH") {
    await ctx.runMutation(internal.siteApi.updatePost, {
      id,
      acteurId,
      title: asString(body.title),
      slug: asString(body.slug),
      body: asString(body.body),
      excerpt: asString(body.excerpt),
      coverId: asCover(body.coverId),
      tagIds: Array.isArray(body.tagIds) ? (body.tagIds as Id<"tags">[]) : undefined,
      seo: asObj(body.seo),
      geo: asObj(body.geo),
      targetKeyword: asString(body.targetKeyword),
    })
    return { status: 200, body: await ctx.runQuery(internal.siteApi.getPost, { id }) }
  }
  if (method === "DELETE") {
    await ctx.runMutation(internal.siteApi.removePost, { id, acteurId })
    return { status: 204, body: null }
  }
  const got = await ctx.runQuery(internal.siteApi.getPost, { id })
  if (got === null) return { status: 404, body: { error: "NOT_FOUND" } }
  return { status: 200, body: got }
}

async function leads(ctx: Ctx, route: ApiRoute) {
  if (!route.id) return { status: 200, body: await ctx.runQuery(internal.siteApi.listLeads, {}) }
  return {
    status: 200,
    body: await ctx.runQuery(internal.siteApi.getLead, { id: route.id as Id<"leads"> }),
  }
}

async function pages(
  ctx: Ctx,
  method: string,
  route: ApiRoute,
  acteurId: string,
  body: Record<string, unknown>,
) {
  if (!route.id) return { status: 200, body: await ctx.runQuery(internal.siteApi.listPages, {}) }
  const id = route.id as Id<"pages">
  if (method === "PATCH") {
    await ctx.runMutation(internal.siteApi.updatePage, {
      id,
      acteurId,
      title: asString(body.title),
      seo: asObj(body.seo),
      geo: asObj(body.geo),
      targetKeyword: asString(body.targetKeyword),
    })
  }
  return { status: 200, body: await ctx.runQuery(internal.siteApi.getPage, { id }) }
}

async function tags(
  ctx: Ctx,
  method: string,
  acteurId: string,
  body: Record<string, unknown>,
) {
  if (method === "POST") {
    const id = await ctx.runMutation(internal.siteApi.createTag, {
      name: String(body.name ?? ""),
      acteurId,
    })
    return { status: 201, body: { _id: id } }
  }
  return { status: 200, body: await ctx.runQuery(internal.siteApi.listTags, {}) }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asCover(value: unknown): Id<"_storage"> | null | undefined {
  if (value === null) return null
  if (typeof value === "string") return value as Id<"_storage">
  return undefined
}

function asObj(value: unknown): never | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as never
  }
  return undefined
}
