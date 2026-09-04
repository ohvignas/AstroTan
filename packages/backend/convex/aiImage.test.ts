import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { TestConvex } from "convex-test"
import schema from "./schema"
import { api } from "./_generated/api"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import { DEFAULT_OPENROUTER_IMAGE_MODEL } from "./lib/openRouterImageModels"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

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

function imagePromptOf(call: unknown[] | undefined): string {
  const init = call?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { prompt: string }
  return body.prompt
}

function reponseImage(): Response {
  return new Response(
    JSON.stringify({
      data: [{ b64_json: PNG_B64, media_type: "image/png" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

async function seedActor(t: TestConvex<typeof schema>, role: "owner" | "editor") {
  const email = `ai-img-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple img"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

async function insertPost(t: TestConvex<typeof schema>, createdBy: string) {
  return t.run((ctx) =>
    ctx.db.insert("posts", {
      slug: `post-cover-${Date.now()}`,
      title: "Rénover une vitrine",
      excerpt: "Les trois gestes.",
      body: "<p>Le corps.</p>",
      status: "draft",
      tagIds: [],
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

test("sans clé, refuse et n'appelle pas OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  await expect(
    owner.identity.action(api.aiImage.generatePostCover, { postId: id }),
  ).rejects.toMatchObject({ data: { code: "OPENROUTER_NOT_CONFIGURED" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor ne génère pas la une d'un autre", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editor = await seedActor(t, "editor")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ne-doit-pas-partir"
  await expect(
    editor.identity.action(api.aiImage.generatePostCover, { postId: id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("enregistre l'image en médiathèque et l'attache au post", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  const result = await owner.identity.action(api.aiImage.generatePostCover, {
    postId: id,
  })
  const post = await t.run((ctx) => ctx.db.get(id))
  expect(post?.coverId).toBe(result.storageId)
  expect(post?.seo?.ogImageId).toBeUndefined()
  const media = await t.run((ctx) =>
    ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", result.storageId))
      .unique(),
  )
  expect(media?.alt).toContain("Rénover une vitrine")
  expect(media?.title).toBe("Rénover une vitrine")
  expect(media?.mime).toBe("image/png")
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    model: string
    prompt: string
    aspect_ratio?: string
    resolution?: string
    output_format?: string
  }
  expect(body.model).toBe(DEFAULT_OPENROUTER_IMAGE_MODEL)
  expect(body.prompt).toContain("Rénover une vitrine")
  expect(body.aspect_ratio).toBe("16:9")
  expect(body.resolution).toBe("1K")
  expect(body.output_format).toBeUndefined()
})

test("generatePostCover ne pose pas seo.ogImageId, même s'il existait déjà", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  const ancienOg = await t.run(async (ctx) => ctx.storage.store(new Blob(["og"])))
  await owner.identity.mutation(api.posts.update, {
    id,
    seo: { ogImageId: ancienOg, noindex: false },
  })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  const result = await owner.identity.action(api.aiImage.generatePostCover, {
    postId: id,
  })
  const post = await t.run((ctx) => ctx.db.get(id))
  expect(post?.coverId).toBe(result.storageId)
  expect(post?.seo?.ogImageId).toBe(ancienOg)
  expect(post?.seo?.ogImageId).not.toBe(result.storageId)
})

async function insertPage(
  t: TestConvex<typeof schema>,
  createdBy: string,
  overrides: {
    slug?: string
    title?: string
    targetKeyword?: string
    status?: "draft" | "published"
  } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: overrides.slug ?? `page-og-${Date.now()}`,
      title: overrides.title ?? "Page de démo",
      status: overrides.status ?? "draft",
      targetKeyword: overrides.targetKeyword,
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

test("sans clé, generatePageOg refuse et n'appelle pas OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id)
  await expect(
    owner.identity.action(api.aiImage.generatePageOg, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "OPENROUTER_NOT_CONFIGURED" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor ne génère pas l'OG d'une page d'un autre", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editor = await seedActor(t, "editor")
  const id = await insertPage(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ne-doit-pas-partir"
  await expect(
    editor.identity.action(api.aiImage.generatePageOg, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor ne génère pas l'OG d'une page publiée", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await insertPage(t, editor.id, { status: "published" })
  process.env.OPENROUTER_API_KEY = "sk-or-ne-doit-pas-partir"
  await expect(
    editor.identity.action(api.aiImage.generatePageOg, { pageId: id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("enregistre l'image en médiathèque et la pose sur seo.ogImageId", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id, {
    slug: "contact",
    title: "Nous écrire",
    targetKeyword: "contact artisan",
  })
  await owner.identity.mutation(api.settings.update, { siteName: "Atelier Nord" })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  const result = await owner.identity.action(api.aiImage.generatePageOg, {
    pageId: id,
  })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.seo?.ogImageId).toBe(result.storageId)
  const media = await t.run((ctx) =>
    ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", result.storageId))
      .unique(),
  )
  expect(media?.alt).toContain("Nous écrire")
  expect(media?.title).toBe("Nous écrire")
  expect(media?.filename).toBe("og-contact.png")
  expect(media?.mime).toBe("image/png")
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    model: string
    prompt: string
    aspect_ratio?: string
    resolution?: string
  }
  expect(body.model).toBe(DEFAULT_OPENROUTER_IMAGE_MODEL)
  expect(body.prompt).toContain("Nous écrire")
  expect(body.prompt).toContain("contact")
  expect(body.prompt).toContain("contact artisan")
  expect(body.prompt).toContain("Atelier Nord")
  expect(body.prompt).toMatch(/type de page\s*:\s*contact/i)
  expect(body.aspect_ratio).toBe("16:9")
  expect(body.resolution).toBe("1K")
})

test("generatePageOg préserve le titre et la description SEO déjà saisis", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: `page-seo-${Date.now()}`,
      title: "Nous écrire",
      status: "draft",
      seo: { title: "Titre déjà là", description: "Desc déjà là" },
      createdBy: owner.id,
      updatedBy: owner.id,
    }),
  )
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePageOg, { pageId: id })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.seo?.title).toBe("Titre déjà là")
  expect(page?.seo?.description).toBe("Desc déjà là")
  expect(page?.seo?.ogImageId).toBeDefined()
})

function reponseChat(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

test("la passe texte enregistre alt et title SEO issus du modèle", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock
    .mockResolvedValueOnce(reponseImage())
    .mockResolvedValueOnce(
      reponseChat({
        alt: "Vitrine commerçant rénovée, rue calme au petit matin",
        title: "Rénover une vitrine",
      }),
    )
  const result = await owner.identity.action(api.aiImage.generatePostCover, {
    postId: id,
  })
  const media = await t.run((ctx) =>
    ctx.db
      .query("media")
      .withIndex("by_storage", (q) => q.eq("storageId", result.storageId))
      .unique(),
  )
  expect(media?.alt).toBe("Vitrine commerçant rénovée, rue calme au petit matin")
  expect(media?.title).toBe("Rénover une vitrine")
  expect(media?.alt.toLowerCase()).not.toMatch(/image de/)
})

test("une instruction complémentaire arrive dans le prompt image", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePostCover, {
    postId: id,
    extraInstructions: "  style plat, pas de texte  ",
  })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { prompt: string }
  expect(body.prompt).toContain("Rénover une vitrine")
  expect(body.prompt).toContain("Instruction complémentaire")
  expect(body.prompt).toContain("style plat, pas de texte")
})

test("sans instruction, le prompt une est identique à aujourd'hui", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePostCover, { postId: id })
  const without = imagePromptOf(fetchMock.mock.calls[0])
  fetchMock.mockClear()
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePostCover, {
    postId: id,
    extraInstructions: "   ",
  })
  expect(imagePromptOf(fetchMock.mock.calls[0])).toBe(without)
})

test("generatePageOg envoie aussi l'instruction dans le prompt OG", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPage(t, owner.id, { slug: "contact", title: "Nous écrire" })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePageOg, {
    pageId: id,
    extraInstructions: "lumière du soir",
  })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { prompt: string }
  expect(body.prompt).toContain("Nous écrire")
  expect(body.prompt).toContain("Instruction complémentaire")
  expect(body.prompt).toContain("lumière du soir")
})

test("une instruction trop longue est refusée avant OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  await expect(
    owner.identity.action(api.aiImage.generatePostCover, {
      postId: id,
      extraInstructions: "x".repeat(501),
    }),
  ).rejects.toMatchObject({
    data: { code: "FIELD_TOO_LONG", field: "extraInstructions", max: 500 },
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("la génération image lit le modèle enregistré", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertPost(t, owner.id)
  await owner.identity.mutation(api.settings.update, {
    siteName: "AstroTan",
    openRouterImageModel: "google/gemini-2.5-flash-image",
  })
  process.env.OPENROUTER_API_KEY = "sk-or-ok"
  fetchMock.mockResolvedValue(reponseImage())
  await owner.identity.action(api.aiImage.generatePostCover, { postId: id })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as { model: string }
  expect(body.model).toBe("google/gemini-2.5-flash-image")
})
