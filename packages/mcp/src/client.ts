export function requireEnv(env: NodeJS.ProcessEnv = process.env): {
  url: string
  token: string
} {
  const url = env.ASTROTAN_API_URL?.replace(/\/+$/, "")
  const token = env.ASTROTAN_API_TOKEN
  if (!url) throw new Error("ASTROTAN_API_URL est requis")
  if (!token) throw new Error("ASTROTAN_API_TOKEN est requis")
  return { url, token }
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const { url, token } = requireEnv(env)
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${token}`)
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json")
  }
  const res = await fetchImpl(`${url}${path}`, { ...init, headers })
  if (res.status === 204) return null
  const text = await res.text()
  const parsed: unknown = text.length === 0 ? null : JSON.parse(text)
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text}`)
  }
  return parsed
}
