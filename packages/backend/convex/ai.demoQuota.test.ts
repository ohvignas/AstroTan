import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { TestConvex } from "convex-test"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const DEMO_EMAIL = "demo@astrotan.invalid"
const DEMO_MODEL = "google/gemini-2.5-flash-lite"

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env[SECRETS_KEY_VAR] = Buffer.alloc(32, 7).toString("base64")
  delete process.env.OPENROUTER_API_KEY
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
  delete process.env.DEMO_OPENROUTER_MODEL
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

const DRAFT_JSON = {
  seoTitle: "Titre généré",
  seoDescription: "Description générée.",
  geoSummary: "Résumé extractible.",
  geoFaq: [{ question: "Quoi ?", answer: "Ceci." }],
  geoEntities: ["AstroTan", "Convex"],
  geoNoai: false,
  excerpt: "Chapô généré.",
}

function reponseOk(corps: unknown = DRAFT_JSON): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(corps) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function activerSandbox(email = DEMO_EMAIL) {
  process.env.DEMO_SANDBOX = "true"
  process.env.DEMO_ACCOUNT_EMAIL = email
  process.env.DEMO_OPENROUTER_MODEL = DEMO_MODEL
}

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
  email?: string,
) {
  const resolved = email ?? `ai-quota-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple ai quota"
  const user = await seedUser(t, { email: resolved, password, name: `Actor ${role}`, role })
  await signIn(t, resolved, password)
  return { identity: await identityFor(t, user.id), id: user.id, email: resolved }
}

async function insertPage(t: TestConvex<typeof schema>, createdBy: string) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: `page-ai-quota-${Date.now()}`,
      title: "Page de démo",
      status: "draft",
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

test("assertDemoAiBudget refuse le 16e appel du même userId", async () => {
  const t = makeTestConvex()
  const userId = "demo-ai-quota-user"
  for (let n = 0; n < 15; n++) {
    await t.mutation(internal.ai.assertDemoAiBudget, { userId })
  }
  await expect(t.mutation(internal.ai.assertDemoAiBudget, { userId })).rejects.toMatchObject({
    data: { code: "DEMO_RATE_LIMITED" },
  })
})

test("hors sandbox, le quota n'existe pas : deux générations passent", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockImplementation(() => Promise.resolve(reponseOk()))
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test("le compte démo consomme le seau et s'arrête avant OpenRouter", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor", DEMO_EMAIL)
  const id = await insertPage(t, editor.id)
  activerSandbox(editor.email)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  const draft = await editor.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(draft.seo.title).toBe("Titre généré")
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  expect(JSON.parse(String(init.body)).model).toBe(DEMO_MODEL)

  for (let n = 0; n < 14; n++) {
    await t.mutation(internal.ai.assertDemoAiBudget, { userId: editor.id })
  }
  await expect(
    editor.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "DEMO_RATE_LIMITED" } })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("un owner hors compte démo n'est pas plafonné par ce seau", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  activerSandbox(DEMO_EMAIL)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  for (let n = 0; n < 15; n++) {
    await t.mutation(internal.ai.assertDemoAiBudget, { userId: owner.id })
  }
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
