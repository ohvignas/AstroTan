import { afterEach, beforeEach, expect, test } from "vitest"
import { ConvexError } from "convex/values"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import {
  MAX_EXCERPT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "./content"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.SEO_ANALYZE_STUB = "1"
})

afterEach(() => {
  process.env = originalEnv
})

const PAYLOAD = {
  title: "Titre",
  excerpt: "",
  bodyHtml: "<p>Corps</p>",
  targetKeyword: "astro",
  seoTitle: "Titre SEO",
  seoDescription: "Meta.",
  slug: "titre",
}

test("refuse sans session", async () => {
  const t = await makeTestConvex()
  await expect(t.action(api.seoAnalyze.analyze, PAYLOAD)).rejects.toThrow()
})

test("un editor authentifié reçoit la forme findings", async () => {
  const t = await makeTestConvex()
  const user = await seedUser(t, {
    email: "coach@example.com",
    password: "correct horse battery staple",
    name: "Coach",
    role: "editor",
  })
  await signIn(t, "coach@example.com", "correct horse battery staple")
  const identity = await identityFor(t, user.id)
  const out = await identity.action(api.seoAnalyze.analyze, PAYLOAD)
  expect(out).toEqual({ findings: [] })
})

test("un titre trop long lève FIELD_TOO_LONG avant Yoast", async () => {
  const t = await makeTestConvex()
  const user = await seedUser(t, {
    email: "long@example.com",
    password: "correct horse battery staple",
    name: "Long",
    role: "owner",
  })
  await signIn(t, "long@example.com", "correct horse battery staple")
  const identity = await identityFor(t, user.id)
  try {
    await identity.action(api.seoAnalyze.analyze, {
      ...PAYLOAD,
      title: "T".repeat(MAX_PAGE_TITLE_LENGTH + 1),
    })
    throw new Error("expected FIELD_TOO_LONG")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as ConvexError<{ code: string }>).data.code).toBe("FIELD_TOO_LONG")
  }
})

test("les plafonds documentés restent ceux de content.ts", () => {
  expect(MAX_POST_BODY_LENGTH).toBe(200_000)
  expect(MAX_EXCERPT_LENGTH).toBe(300)
  expect(MAX_SEO_TITLE_LENGTH).toBe(70)
  expect(MAX_SEO_DESCRIPTION_LENGTH).toBe(160)
  expect(MAX_TARGET_KEYWORD_LENGTH).toBe(80)
  expect(MAX_SLUG_LENGTH).toBe(200)
})
