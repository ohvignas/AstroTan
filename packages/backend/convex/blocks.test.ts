import { convexTest } from "convex-test"
import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import schema from "./schema"
import {
  assertBlockWithinLimits,
  assertPageTextWithinLimits,
  MAX_BLOCK_SUBTITLE_LENGTH,
  MAX_BLOCK_TITLE_LENGTH,
  MAX_CANONICAL_URL_LENGTH,
  MAX_CTA_HREF_LENGTH,
  MAX_CTA_LABEL_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FEATURE_ITEM_BODY_LENGTH,
  MAX_FEATURE_ITEM_TITLE_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_RICH_TEXT_HTML_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  type Block,
  type PageSeoInput,
} from "./blocks"

const modules = import.meta.glob("./**/*.ts")

// One instance of every block type the union declares. Kept as a single
// source of truth for this file's "all six accepted" test and reused (with
// targeted field overrides) by the bounding tests below, so a field added
// to one block's shape can't silently go untested in the other.
const oneOfEach: Block[] = [
  { type: "hero", title: "Bienvenue", subtitle: "Un sous-titre", cta: { label: "En savoir plus", href: "/a-propos" } },
  { type: "richText", html: "<p>Contenu</p>" },
  { type: "features", items: [{ title: "Rapide", body: "Très rapide." }] },
  { type: "gallery", mediaIds: [] },
  { type: "faq", items: [{ question: "Pourquoi ?", answer: "Parce que." }] },
  { type: "cta", title: "Prêt ?", cta: { label: "Contact", href: "/contact" } },
]

function minimalPage(blocks: Block[]) {
  return {
    slug: "accueil",
    title: "Accueil",
    status: "draft" as const,
    blocks,
    createdBy: "user_1",
    updatedBy: "user_1",
  }
}

test("la table pages accepte une page portant les six types de blocs", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run((ctx) => ctx.db.insert("pages", minimalPage(oneOfEach)))
  const doc = await t.run((ctx) => ctx.db.get(id))
  expect(doc?.blocks).toHaveLength(6)
  expect(doc?.blocks.map((b) => b.type)).toEqual([
    "hero", "richText", "features", "gallery", "faq", "cta",
  ])
})

// The one thing worth testing that the brief above doesn't spell out: an
// unrecognized block `type` must be rejected by the schema itself, not
// merely by application code that happens to check it. If `blockValidator`
// were ever widened to `v.any()` (or the union lost its discriminant),
// this insert would silently succeed and this test would fail — that's
// the property under test, not just "insert with bad data throws".
test("la table pages rejette un type de bloc inconnu", async () => {
  const t = convexTest(schema, modules)
  const rogueBlock = { type: "carousel", slides: [] } as unknown as Block
  await expect(
    t.run((ctx) => ctx.db.insert("pages", minimalPage([rogueBlock]))),
  ).rejects.toThrow()
})

test("la table pages rejette une valeur de status inconnue", async () => {
  const t = convexTest(schema, modules)
  const page = { ...minimalPage([]), status: "archived" as unknown as "draft" }
  await expect(t.run((ctx) => ctx.db.insert("pages", page))).rejects.toThrow()
})

test("createdBy et updatedBy acceptent l'id Better Auth tel quel — pas un v.id() Convex", async () => {
  const t = convexTest(schema, modules)
  // Un id Better Auth ne se décode pas comme un `Id<"...">` Convex ; si
  // `createdBy`/`updatedBy` était déclaré `v.id(...)` cet insert serait
  // rejeté par la validation ci-dessus (voir `blocks.ts` pour pourquoi ce
  // sont des `v.string()`).
  const id = await t.run((ctx) =>
    ctx.db.insert("pages", {
      ...minimalPage([]),
      createdBy: "better-auth-user-abc123",
      updatedBy: "better-auth-user-abc123",
    }),
  )
  const doc = await t.run((ctx) => ctx.db.get(id))
  expect(doc?.createdBy).toBe("better-auth-user-abc123")
  expect(doc?.updatedBy).toBe("better-auth-user-abc123")
})

test("l'index by_slug retrouve une page par son slug", async () => {
  const t = convexTest(schema, modules)
  await t.run((ctx) => ctx.db.insert("pages", minimalPage(oneOfEach)))
  const found = await t.run((ctx) =>
    ctx.db.query("pages").withIndex("by_slug", (q) => q.eq("slug", "accueil")).unique(),
  )
  expect(found?.slug).toBe("accueil")
})

test("l'index by_status retrouve les pages par statut", async () => {
  const t = convexTest(schema, modules)
  await t.run((ctx) => ctx.db.insert("pages", { ...minimalPage([]), slug: "a", status: "draft" }))
  await t.run((ctx) =>
    ctx.db.insert("pages", { ...minimalPage([]), slug: "b", status: "published" }),
  )
  const published = await t.run((ctx) =>
    ctx.db.query("pages").withIndex("by_status", (q) => q.eq("status", "published")).collect(),
  )
  expect(published.map((p) => p.slug)).toEqual(["b"])
})

test("l'index by_created_by retrouve les pages par créateur", async () => {
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    ctx.db.insert("pages", { ...minimalPage([]), slug: "a", createdBy: "user_a" }),
  )
  await t.run((ctx) =>
    ctx.db.insert("pages", { ...minimalPage([]), slug: "b", createdBy: "user_b" }),
  )
  const byA = await t.run((ctx) =>
    ctx.db
      .query("pages")
      .withIndex("by_created_by", (q) => q.eq("createdBy", "user_a"))
      .collect(),
  )
  expect(byA.map((p) => p.slug)).toEqual(["a"])
})

// ---------------------------------------------------------------------
// Length bounds. The schema itself only enforces shape/type (above); it
// can't enforce a string's length. These target `assertBlockWithinLimits`
// / `assertPageTextWithinLimits` directly — the runtime half of "bound
// every text field". Each case accepts exactly the max and rejects
// max + 1, so the test would fail both if the bound were dropped
// (max + 1 stops throwing) and if it were tightened by mistake (max
// stops being accepted).
// ---------------------------------------------------------------------

const blockCases: Array<{ name: string; max: number; build: (len: number) => Block }> = [
  {
    name: "hero.title",
    max: MAX_BLOCK_TITLE_LENGTH,
    build: (len) => ({ type: "hero", title: "x".repeat(len) }),
  },
  {
    name: "hero.subtitle",
    max: MAX_BLOCK_SUBTITLE_LENGTH,
    build: (len) => ({ type: "hero", title: "t", subtitle: "x".repeat(len) }),
  },
  {
    name: "hero.cta.label",
    max: MAX_CTA_LABEL_LENGTH,
    build: (len) => ({ type: "hero", title: "t", cta: { label: "x".repeat(len), href: "/a" } }),
  },
  {
    name: "hero.cta.href",
    max: MAX_CTA_HREF_LENGTH,
    build: (len) => ({ type: "hero", title: "t", cta: { label: "l", href: "x".repeat(len) } }),
  },
  {
    name: "richText.html",
    max: MAX_RICH_TEXT_HTML_LENGTH,
    build: (len) => ({ type: "richText", html: "x".repeat(len) }),
  },
  {
    name: "features.items[].title",
    max: MAX_FEATURE_ITEM_TITLE_LENGTH,
    build: (len) => ({ type: "features", items: [{ title: "x".repeat(len), body: "b" }] }),
  },
  {
    name: "features.items[].body",
    max: MAX_FEATURE_ITEM_BODY_LENGTH,
    build: (len) => ({ type: "features", items: [{ title: "t", body: "x".repeat(len) }] }),
  },
  {
    name: "faq.items[].question",
    max: MAX_FAQ_QUESTION_LENGTH,
    build: (len) => ({ type: "faq", items: [{ question: "x".repeat(len), answer: "a" }] }),
  },
  {
    name: "faq.items[].answer",
    max: MAX_FAQ_ANSWER_LENGTH,
    build: (len) => ({ type: "faq", items: [{ question: "q", answer: "x".repeat(len) }] }),
  },
  {
    name: "cta.title",
    max: MAX_BLOCK_TITLE_LENGTH,
    build: (len) => ({ type: "cta", title: "x".repeat(len), cta: { label: "l", href: "/a" } }),
  },
  {
    name: "cta.cta.label",
    max: MAX_CTA_LABEL_LENGTH,
    build: (len) => ({ type: "cta", title: "t", cta: { label: "x".repeat(len), href: "/a" } }),
  },
  {
    name: "cta.cta.href",
    max: MAX_CTA_HREF_LENGTH,
    build: (len) => ({ type: "cta", title: "t", cta: { label: "l", href: "x".repeat(len) } }),
  },
]

test.each(blockCases)(
  "assertBlockWithinLimits : $name accepte la limite ($max) et rejette limite+1",
  ({ max, build }) => {
    expect(() => assertBlockWithinLimits(build(max))).not.toThrow()
    expect(() => assertBlockWithinLimits(build(max + 1))).toThrow(ConvexError)
  },
)

test("assertBlockWithinLimits rejette un type de bloc inconnu (garde d'exhaustivité)", () => {
  const rogue = { type: "carousel" } as unknown as Block
  expect(() => assertBlockWithinLimits(rogue)).toThrow(ConvexError)
})

const pageTextCases: Array<{
  name: string
  max: number
  build: (len: number) => { title: string; slug: string; seo?: PageSeoInput }
}> = [
  { name: "title", max: MAX_PAGE_TITLE_LENGTH, build: (len) => ({ title: "x".repeat(len), slug: "s" }) },
  { name: "slug", max: MAX_SLUG_LENGTH, build: (len) => ({ title: "t", slug: "x".repeat(len) }) },
  {
    name: "seo.title",
    max: MAX_SEO_TITLE_LENGTH,
    build: (len) => ({ title: "t", slug: "s", seo: { title: "x".repeat(len) } }),
  },
  {
    name: "seo.description",
    max: MAX_SEO_DESCRIPTION_LENGTH,
    build: (len) => ({ title: "t", slug: "s", seo: { description: "x".repeat(len) } }),
  },
  {
    name: "seo.canonicalUrl",
    max: MAX_CANONICAL_URL_LENGTH,
    build: (len) => ({ title: "t", slug: "s", seo: { canonicalUrl: "x".repeat(len) } }),
  },
]

test.each(pageTextCases)(
  "assertPageTextWithinLimits : $name accepte la limite ($max) et rejette limite+1",
  ({ max, build }) => {
    expect(() => assertPageTextWithinLimits(build(max))).not.toThrow()
    expect(() => assertPageTextWithinLimits(build(max + 1))).toThrow(ConvexError)
  },
)
