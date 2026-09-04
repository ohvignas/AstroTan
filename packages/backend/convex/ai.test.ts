import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { TestConvex } from "convex-test"
import schema from "./schema"
import { api } from "./_generated/api"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import { DEFAULT_OPENROUTER_MODEL } from "./lib/openRouterModels"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env[SECRETS_KEY_VAR] = Buffer.alloc(32, 7).toString("base64")
  delete process.env.OPENROUTER_API_KEY
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

function userMessageOf(call: unknown[] | undefined): string {
  const init = call?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    messages: { role: string; content: string }[]
  }
  return body.messages.find((m) => m.role === "user")?.content ?? ""
}

function reponseOk(corps: unknown = DRAFT_JSON): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(corps) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `ai-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple ai"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

async function insertPage(
  t: TestConvex<typeof schema>,
  createdBy: string,
  overrides: { status?: "draft" | "published"; slug?: string } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: overrides.slug ?? `page-ai-${Date.now()}`,
      title: "Page de démo",
      status: overrides.status ?? "draft",
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

async function insertPost(
  t: TestConvex<typeof schema>,
  createdBy: string,
  overrides: { body?: string; excerpt?: string } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("posts", {
      slug: `post-ai-${Date.now()}`,
      title: "Article de démo",
      excerpt: overrides.excerpt ?? "L'attaque.",
      body: overrides.body ?? "<p>Le corps déjà en base.</p>",
      status: "draft",
      tagIds: [],
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

test("sans session, on n'appelle pas OpenRouter", async () => {
  const t = makeTestConvex()
  const id = await insertPage(t, "inconnu")
  await expect(t.action(api.ai.generateSeoGeo, { pageId: id })).rejects.toThrow()
  expect(fetchMock).not.toHaveBeenCalled()
})

test("sans clé OpenRouter, refuse en clair et n'appelle personne", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await expect(
    owner.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "OPENROUTER_NOT_CONFIGURED" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor ne génère pas la page d'un autre", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editor = await seedActor(t, "editor")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ne-doit-pas-partir"
  await expect(
    editor.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor ne génère pas sa propre page publiée", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await insertPage(t, editor.id, { status: "published" })
  process.env.OPENROUTER_API_KEY = "sk-or-ne-doit-pas-partir"
  await expect(
    editor.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor génère sa propre page brouillon", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await insertPage(t, editor.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  const draft = await editor.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(draft.seo.title).toBe("Titre généré")
  expect(draft.seo.description).toBe("Description générée.")
  expect(draft.geo.summary).toBe("Résumé extractible.")
  expect(draft.geo.faq).toEqual([{ question: "Quoi ?", answer: "Ceci." }])
  expect(draft.geo.entities).toEqual(["AstroTan", "Convex"])
  expect(draft.geo).toHaveProperty("noai", false)
  expect(draft.seo).not.toHaveProperty("noindex")
  expect(draft.seo).not.toHaveProperty("canonicalUrl")
})

test("la génération ne publie pas et n'écrit pas la ligne", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.status).toBe("draft")
  expect(page?.seo).toBeUndefined()
  expect(page?.geo).toBeUndefined()
})

test("le prompt d'une page n'embarque pas de corps", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === "user")?.content ?? ""
  expect(user).toContain('"kind":"page"')
  expect(user).not.toMatch(/"body"/)
  expect(user).toMatch(/Pas de corps HTML/)
})

test("le prompt d'un article embarque extrait et corps", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id, {
    excerpt: "L'attaque.",
    body: "<p>Le développement secret.</p>",
  })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  const draft = await owner.identity.action(api.ai.generateSeoGeo, { postId: id })
  expect(draft.seo.title).toBe("Titre généré")
  expect(draft.excerpt).toBe("Chapô généré.")
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === "user")?.content ?? ""
  expect(user).toContain("L'attaque.")
  expect(user).toContain("Le développement secret.")
})

test("un JSON imbriqué { seo, geo } n'est plus une réponse inutilisable", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(
    reponseOk({
      seo: { title: "Titre imbriqué", description: "Desc imbriquée." },
      geo: { summary: "Résumé imbriqué.", faq: [], entities: [], noai: false },
    }),
  )
  const draft = await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(draft.seo.title).toBe("Titre imbriqué")
  expect(draft.geo.summary).toBe("Résumé imbriqué.")
})

test("sans modèle posé, la génération envoie le défaut", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { model: string }
  expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL)
})

test("la génération lit le modèle enregistré, pas la constante", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await owner.identity.mutation(api.settings.update, {
    siteName: "AstroTan",
    openRouterModel: "anthropic/claude-opus-5",
  })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { model: string }
  expect(body.model).toBe("anthropic/claude-opus-5")
  expect(body.model).not.toBe(DEFAULT_OPENROUTER_MODEL)
})

test("la génération SEO ignore le modèle agent", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await owner.identity.mutation(api.settings.update, {
    siteName: "AstroTan",
    openRouterModel: "x-ai/grok-4.6",
    openRouterAgentModel: "anthropic/claude-opus-5",
  })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { model: string }
  expect(body.model).toBe("x-ai/grok-4.6")
  expect(body.model).not.toBe("anthropic/claude-opus-5")
})

test("une clé saisie en base (secrets) suffit, sans variable d'environnement", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await owner.identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: "sk-or-saisie-a-lecran",
  })
  fetchMock.mockResolvedValue(reponseOk())
  const draft = await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  expect(draft.seo.title).toBe("Titre généré")
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit
  expect((init.headers as Record<string, string>).Authorization).toBe(
    "Bearer sk-or-saisie-a-lecran",
  )
})

test("OpenRouter 401 → OPENROUTER_REFUSED", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-mauvaise"
  fetchMock.mockResolvedValue(new Response("nope", { status: 401 }))
  await expect(
    owner.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "OPENROUTER_REFUSED" } })
})

test("une instruction complémentaire arrive dans le prompt user OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, {
    pageId: id,
    extraInstructions: "  tutoiement, insiste sur Lyon  ",
  })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === "user")?.content ?? ""
  expect(user).toContain("Instruction complémentaire")
  expect(user).toContain("tutoiement, insiste sur Lyon")
  expect(user).not.toContain("  tutoiement")
})

test("sans instruction, le prompt SEO est identique à aujourd'hui", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, { pageId: id })
  const without = userMessageOf(fetchMock.mock.calls[0])
  fetchMock.mockClear()
  fetchMock.mockResolvedValue(reponseOk())
  await owner.identity.action(api.ai.generateSeoGeo, {
    pageId: id,
    extraInstructions: "   ",
  })
  expect(userMessageOf(fetchMock.mock.calls[0])).toBe(without)
})

test("une instruction trop longue est refusée avant OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  await expect(
    owner.identity.action(api.ai.generateSeoGeo, {
      pageId: id,
      extraInstructions: "x".repeat(501),
    }),
  ).rejects.toMatchObject({
    data: { code: "FIELD_TOO_LONG", field: "extraInstructions", max: 500 },
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("une page absente → NOT_FOUND, sans réseau", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await t.run((ctx) => ctx.db.delete(id))
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  await expect(
    owner.identity.action(api.ai.generateSeoGeo, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  expect(fetchMock).not.toHaveBeenCalled()
})
