export function assertMcpUrl(url: string): "ok" | "MCP_URL" {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "MCP_URL"
  }
  if (parsed.protocol === "https:") return "ok"
  if (parsed.protocol !== "http:") return "MCP_URL"
  const host = parsed.hostname
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "ok"
  return "MCP_URL"
}
