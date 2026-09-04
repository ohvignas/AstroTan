import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})

async function withToken() {
  const t = makeTestConvex()
  const email = `http-api-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple http api"
  const user = await seedUser(t, {
    email,
    password,
    name: "Api Owner",
    role: "owner",
  })
  await signIn(t, email, password)
  const identity = await identityFor(t, user.id)
  const { token } = await identity.mutation(api.apiTokens.generate, {})
  return { t, token }
}

test("sans Bearer → 401", async () => {
  const t = makeTestConvex()
  const res = await t.fetch("/api/v1/posts", { method: "GET" })
  expect(res.status).toBe(401)
})

test("Bearer faux → 401", async () => {
  const t = makeTestConvex()
  const res = await t.fetch("/api/v1/posts", {
    method: "GET",
    headers: { authorization: "Bearer deadbeef" },
  })
  expect(res.status).toBe(401)
})

test("GET /api/v1/posts avec jeton → 200 liste", async () => {
  const { t, token } = await withToken()
  const res = await t.fetch("/api/v1/posts", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([])
})

test("POST puis PATCH published écrit workingCopy", async () => {
  const { t, token } = await withToken()
  const created = await t.fetch("/api/v1/posts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "Article", slug: "article-api" }),
  })
  expect(created.status).toBe(201)
  const { _id } = (await created.json()) as { _id: string }

  const pub = await t.fetch(`/api/v1/posts/${_id}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })
  expect(pub.status).toBe(200)

  const patched = await t.fetch(`/api/v1/posts/${_id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "Titre brouillon" }),
  })
  expect(patched.status).toBe(200)

  const row = await t.run(async (ctx) => ctx.db.get(_id as never))
  expect(row && "title" in row ? row.title : null).toBe("Article")
  expect(
    row && "workingCopy" in row
      ? (row.workingCopy as { title?: string } | undefined)?.title
      : null,
  ).toBe("Titre brouillon")
})

test("GET leads 200 ; POST leads refusé", async () => {
  const { t, token } = await withToken()
  const get = await t.fetch("/api/v1/leads", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  })
  expect(get.status).toBe(200)
  const post = await t.fetch("/api/v1/leads", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "x@y.z" }),
  })
  expect([404, 405]).toContain(post.status)
})

test("openapi.json sans Bearer, sans jeton", async () => {
  const { t, token } = await withToken()
  const res = await t.fetch("/api/v1/openapi.json", { method: "GET" })
  expect(res.status).toBe(200)
  const body = await res.text()
  expect(body).toContain("3.0.3")
  expect(body).not.toContain(token)
})

test("settings.get ne porte aucun champ de jeton API", async () => {
  const t = makeTestConvex()
  const settings = await t.query(api.settings.get, {})
  const dumped = JSON.stringify(settings)
  expect(dumped).not.toMatch(/apiToken|tokenHash|Bearer/)
})
