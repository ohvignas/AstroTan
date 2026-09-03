import { expect, test } from "vitest"
import { apiRequest, requireEnv } from "./client"

test("refuse de démarrer sans URL ou jeton", () => {
  expect(() => requireEnv({})).toThrow(/ASTROTAN_API_URL/)
  expect(() => requireEnv({ ASTROTAN_API_URL: "https://x.convex.site" })).toThrow(
    /ASTROTAN_API_TOKEN/,
  )
  expect(
    requireEnv({
      ASTROTAN_API_URL: "https://x.convex.site/",
      ASTROTAN_API_TOKEN: "tok",
    }),
  ).toEqual({ url: "https://x.convex.site", token: "tok" })
})

test("envoie le Bearer", async () => {
  const calls: { url: string; auth: string | null }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
    })
    return new Response("[]", { status: 200 })
  }
  await apiRequest(
    "/api/v1/posts",
    { method: "GET" },
    {
      ASTROTAN_API_URL: "https://x.convex.site",
      ASTROTAN_API_TOKEN: "secret-token",
    },
    fetchImpl,
  )
  expect(calls[0]).toEqual({
    url: "https://x.convex.site/api/v1/posts",
    auth: "Bearer secret-token",
  })
})
