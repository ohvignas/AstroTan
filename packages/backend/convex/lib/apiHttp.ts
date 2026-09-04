import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { HttpRouter } from "convex/server"
import { extractBearer, hashesMatch } from "./apiAuth"
import { parseApiRoute } from "./apiRoutes"
import { openapiDocument } from "./apiOpenapi"
import { dispatchApi } from "./apiDispatch"
import { corsHeaders, json, jsonError } from "./apiErrors"
import { hashToken } from "./token"

const METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] as const

export function registerSiteApi(http: HttpRouter) {
  const handler = httpAction(async (ctx, request) => {
    try {
      return await handle(ctx, request)
    } catch (error) {
      return jsonError(error)
    }
  })
  for (const method of METHODS) {
    http.route({ pathPrefix: "/api/v1/", method, handler })
  }
}

async function handle(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  const url = new URL(request.url)
  const route = parseApiRoute(request.method, url.pathname)
  if (route === null) {
    return json({ error: "NOT_FOUND" }, 404)
  }
  if (route.resource === "openapi") {
    return json(openapiDocument(url.origin), 200)
  }
  if (route.resource === "docs") {
    return new Response(swaggerHtml(url.origin), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders() },
    })
  }

  const presented = extractBearer({ authorization: request.headers.get("authorization") })
  if (presented === null) return json({ error: "UNAUTHENTICATED" }, 401)
  const stored = await ctx.runQuery(internal.siteApi.lookupToken, {
    tokenHash: await hashToken(presented),
  })
  if (stored === null || !(await hashesMatch(presented, stored.tokenHash))) {
    return json({ error: "UNAUTHENTICATED" }, 401)
  }

  let body: Record<string, unknown> = {}
  if (request.method === "POST" || request.method === "PATCH") {
    const text = await request.text()
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    }
  }

  const result = await dispatchApi(ctx, request.method, route, stored.createdBy, body)
  if (result.status === 204) {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  return json(result.body, result.status)
}

function swaggerHtml(origin: string): string {
  const spec = `${origin.replace(/\/+$/, "")}/api/v1/openapi.json`
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><title>AstroTan API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:${JSON.stringify(spec)},dom_id:"#swagger-ui"})</script></body></html>`
}
