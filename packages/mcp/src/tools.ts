import { apiRequest } from "./client.js"

export const TOOL_NAMES = [
  "list_posts",
  "get_post",
  "create_post",
  "update_post",
  "delete_post",
  "publish_post",
  "unpublish_post",
  "list_leads",
  "get_lead",
  "list_pages",
  "get_page",
  "update_page",
  "list_tags",
  "create_tag",
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  request = apiRequest,
): Promise<unknown> {
  switch (name) {
    case "list_posts":
      return request("/api/v1/posts")
    case "get_post":
      return request(`/api/v1/posts/${args.id}`)
    case "create_post":
      return request("/api/v1/posts", { method: "POST", body: JSON.stringify(args) })
    case "update_post":
      return request(`/api/v1/posts/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify(args),
      })
    case "delete_post":
      return request(`/api/v1/posts/${args.id}`, { method: "DELETE" })
    case "publish_post":
      return request(`/api/v1/posts/${args.id}/publish`, { method: "POST" })
    case "unpublish_post":
      return request(`/api/v1/posts/${args.id}/unpublish`, { method: "POST" })
    case "list_leads":
      return request("/api/v1/leads")
    case "get_lead":
      return request(`/api/v1/leads/${args.id}`)
    case "list_pages":
      return request("/api/v1/pages")
    case "get_page":
      return request(`/api/v1/pages/${args.id}`)
    case "update_page":
      return request(`/api/v1/pages/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify(args),
      })
    case "list_tags":
      return request("/api/v1/tags")
    case "create_tag":
      return request("/api/v1/tags", { method: "POST", body: JSON.stringify(args) })
  }
}
