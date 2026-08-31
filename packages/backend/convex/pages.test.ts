import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { signPreviewToken, PREVIEW_TOKEN_TTL_MS } from "./lib/previewToken"

const modules = import.meta.glob("./**/*.ts")

const TEST_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.PREVIEW_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

function pageDoc(overrides: {
  slug: string
  status: "draft" | "published"
  targetKeyword?: string
}) {
  return {
    slug: overrides.slug,
    title: "Titre de test",
    status: overrides.status,
    createdBy: "user_1",
    updatedBy: "user_1",
    ...(overrides.targetKeyword !== undefined
      ? { targetKeyword: overrides.targetKeyword }
      : {}),
  }
}

async function insertPage(
  t: TestConvex<typeof schema>,
  overrides: { slug: string; status: "draft" | "published"; targetKeyword?: string },
) {
  return t.run((ctx) => ctx.db.insert("pages", pageDoc(overrides)))
}

// ---------------------------------------------------------------------
// getPublishedPage — no token parameter exists on this function at all;
// see pages.ts's own header comment. These tests are the concrete case
// pages.publicQueryFamily.test.ts's programmatic scan generalizes.
// ---------------------------------------------------------------------

test("getPublishedPage renvoie null pour un brouillon, même avec le bon slug", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const result = await t.query(api.pages.getPublishedPage, { slug: "brouillon" })
  expect(result).toBeNull()
})

test("getPublishedPage renvoie null pour un slug inexistant", async () => {
  const t = convexTest(schema, modules)
  const result = await t.query(api.pages.getPublishedPage, { slug: "inexistant" })
  expect(result).toBeNull()
})

test("getPublishedPage renvoie la page publiée correspondante", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "publiee", status: "published" })
  const result = await t.query(api.pages.getPublishedPage, { slug: "publiee" })
  expect(result?.slug).toBe("publiee")
  expect(result?.status).toBe("published")
})

// ---------------------------------------------------------------------
// listPublishedPages — same "no token parameter" property.
// ---------------------------------------------------------------------

test("listPublishedPages exclut les brouillons", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  await insertPage(t, { slug: "publiee", status: "published" })
  const result = await t.query(api.pages.listPublishedPages, {})
  expect(result.map((p) => p.slug)).toEqual(["publiee"])
})

test("listPublishedPages renvoie un tableau vide s'il n'existe que des brouillons", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const result = await t.query(api.pages.listPublishedPages, {})
  expect(result).toEqual([])
})

// ---------------------------------------------------------------------
// previewPage — the other family. Revalidates the HMAC itself
// (lib/previewToken.test.ts already covers verifyPreviewToken's own
// unhappy paths in isolation); these confirm the query wires that
// primitive in correctly, end to end, including "no token at all".
// ---------------------------------------------------------------------

test("previewPage renvoie un brouillon avec un jeton valide émis pour son slug exact", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const token = await signPreviewToken({
    type: "page",
    id: "brouillon",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  const result = await t.query(api.pages.previewPage, { slug: "brouillon", token })
  expect(result?.slug).toBe("brouillon")
  expect(result?.status).toBe("draft")
})

test("previewPage omet targetKeyword", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, {
    slug: "brouillon",
    status: "draft",
    targetKeyword: "agence web lyon",
  })
  const token = await signPreviewToken({
    type: "page",
    id: "brouillon",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  const result = await t.query(api.pages.previewPage, { slug: "brouillon", token })
  expect(JSON.stringify(result)).not.toContain("targetKeyword")
  expect(JSON.stringify(result)).not.toContain("agence web lyon")
})

test("previewPage renvoie aussi une page déjà publiée avec un jeton valide", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "publiee", status: "published" })
  const token = await signPreviewToken({
    type: "page",
    id: "publiee",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  const result = await t.query(api.pages.previewPage, { slug: "publiee", token })
  expect(result?.slug).toBe("publiee")
})

test("previewPage refuse un jeton expiré", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const token = await signPreviewToken({ type: "page", id: "brouillon", expiresAt: Date.now() - 1 })
  await expect(t.query(api.pages.previewPage, { slug: "brouillon", token })).rejects.toThrow()
})

test("previewPage refuse un jeton altéré d'un octet", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const token = await signPreviewToken({
    type: "page",
    id: "brouillon",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  const lastChar = token.at(-1)
  const tampered = token.slice(0, -1) + (lastChar === "0" ? "1" : "0")
  await expect(
    t.query(api.pages.previewPage, { slug: "brouillon", token: tampered }),
  ).rejects.toThrow()
})

test("previewPage refuse un jeton émis pour une autre page", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "page-a", status: "draft" })
  await insertPage(t, { slug: "page-b", status: "draft" })
  const token = await signPreviewToken({
    type: "page",
    id: "page-a",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  await expect(t.query(api.pages.previewPage, { slug: "page-b", token })).rejects.toThrow()
})

test("previewPage refuse un jeton dont l'exp a été trafiquée", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "brouillon", expiresAt })
  const dot = token.indexOf(".")
  const forged = `${expiresAt + 10 * PREVIEW_TOKEN_TTL_MS}.${token.slice(dot + 1)}`
  await expect(
    t.query(api.pages.previewPage, { slug: "brouillon", token: forged }),
  ).rejects.toThrow()
})

test("previewPage refuse en l'absence de jeton (chaîne vide)", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  await expect(
    t.query(api.pages.previewPage, { slug: "brouillon", token: "" }),
  ).rejects.toThrow()
})

test("previewPage refuse si PREVIEW_SECRET n'est pas configuré sur ce déploiement", async () => {
  const t = convexTest(schema, modules)
  await insertPage(t, { slug: "brouillon", status: "draft" })
  const token = await signPreviewToken({
    type: "page",
    id: "brouillon",
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_MS,
  })
  delete process.env.PREVIEW_SECRET
  await expect(t.query(api.pages.previewPage, { slug: "brouillon", token })).rejects.toThrow(
    "PREVIEW_SECRET is not set on this Convex deployment",
  )
})
