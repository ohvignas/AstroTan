export type ApiResource = "posts" | "leads" | "pages" | "tags" | "openapi" | "docs"

export type ApiRoute = {
  resource: ApiResource
  id?: string
  action?: "publish" | "unpublish"
}

const COLLECTION: Record<string, { methods: readonly string[] }> = {
  posts: { methods: ["GET", "POST"] },
  leads: { methods: ["GET"] },
  pages: { methods: ["GET"] },
  tags: { methods: ["GET", "POST"] },
}

const ITEM: Record<string, { methods: readonly string[] }> = {
  posts: { methods: ["GET", "PATCH", "DELETE"] },
  leads: { methods: ["GET"] },
  pages: { methods: ["GET", "PATCH"] },
}

export function parseApiRoute(method: string, pathname: string): ApiRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  const prefix = "/api/v1/"
  if (!path.startsWith(prefix) && path !== "/api/v1") return null
  const rest = path === "/api/v1" ? "" : path.slice(prefix.length)
  const parts = rest.split("/").filter(Boolean)

  if (parts.length === 1 && parts[0] === "openapi.json" && method === "GET") {
    return { resource: "openapi" }
  }
  if (parts.length === 1 && parts[0] === "docs" && method === "GET") {
    return { resource: "docs" }
  }

  const [resource, id, action] = parts
  if (resource !== "posts" && resource !== "leads" && resource !== "pages" && resource !== "tags") {
    return null
  }

  if (parts.length === 1) {
    return COLLECTION[resource]?.methods.includes(method) ? { resource } : null
  }
  if (parts.length === 2 && id) {
    return ITEM[resource]?.methods.includes(method) ? { resource, id } : null
  }
  if (
    parts.length === 3 &&
    resource === "posts" &&
    method === "POST" &&
    (action === "publish" || action === "unpublish") &&
    id
  ) {
    return { resource, id, action }
  }
  return null
}
