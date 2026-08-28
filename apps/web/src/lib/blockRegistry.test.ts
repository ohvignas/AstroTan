// Astro 7.2.8 still exports this under its `experimental_` name at
// runtime even though the Container API itself is documented as stable —
// the type is aliased to the friendlier `AstroContainer` name in Astro's
// own `.d.ts`, but the actual export binding is `experimental_AstroContainer`.
import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { describe, expect, test } from "vitest"
import type { AstroComponentFactory } from "astro/runtime/server/index.js"
import { BLOCK_TYPES } from "@astrotan/backend/convex/blocks"
import type { Block } from "@astrotan/backend/convex/blocks"
import { blockRegistry } from "./blockRegistry"

// Lot 2, Task 5's exhaustiveness test — the task brief's own words: "tout
// `Block["type"]` a un composant, vérifié au type et au runtime. Ce test
// doit échouer si on ajoute un type de bloc sans son composant." Two
// independent checks, deliberately not sharing a mechanism (mirrors
// CLAUDE.md invariant #2's "never share a helper" rationale for the
// public/preview query split): a type-level one that only `astro
// check`/`tsc` enforces, and a runtime one this file actually executes.

// ---------------------------------------------------------------------
// Type-level check.
//
// `blockRegistry.ts` already declares `blockRegistry` with this exact
// annotation, so this line is redundant *today* — that's the point. If a
// future edit ever replaces that annotation with something weaker (an
// `as` cast, `Partial<...>`, a dynamically-built object), `tsc` stops
// complaining about a missing block type there but still fails right
// here, because this assignment re-states the requirement independently.
// Never read (a leading `_` plus this comment is the whole point — see
// eslint's `no-unused-vars` allowance for `_`-prefixed bindings), and
// never executed by Vitest (which strips types and does not itself
// typecheck) — this line's enforcement comes from `pnpm --filter
// @astrotan/web typecheck` (`astro check`), not from `vitest run`.
const _typeLevelExhaustiveness: Record<Block["type"], AstroComponentFactory> = blockRegistry

describe("blockRegistry", () => {
  test("has a component for every Block type at runtime", () => {
    // Re-derives the expected key list from `BLOCK_TYPES` — the same
    // constant `packages/backend/convex/blocks.ts` exports as the source
    // of truth — rather than trusting `Object.keys(blockRegistry)`, so a
    // registry that's missing a key (not just wrongly typed) still fails
    // this assertion regardless of what TypeScript did or didn't catch.
    for (const type of BLOCK_TYPES) {
      const component = blockRegistry[type]
      expect(component, `blockRegistry is missing a component for "${type}"`).toBeTypeOf(
        "function",
      )
    }
  })

  test("blockRegistry has no extra keys beyond BLOCK_TYPES", () => {
    expect(Object.keys(blockRegistry).sort()).toEqual([...BLOCK_TYPES].sort())
  })
})

// ---------------------------------------------------------------------
// Render smoke test — beyond "a component function exists", each one
// actually renders its exact block variant without throwing. Uses
// Astro's (stable as of 7.2.8) Container API rather than a real HTTP
// request; Task 6's own live verification (seeding through Convex,
// hitting the running dev server) is what proves the full pipeline, not
// this unit test.
const fixtures: { [T in Block["type"]]: Extract<Block, { type: T }> } = {
  hero: { type: "hero", title: "Built for astronomers", subtitle: "See further, tonight." },
  richText: {
    type: "richText",
    // Doubles as a live check that RichText.astro's sanitize-html
    // wiring actually strips a stored <script> tag — see the assertion
    // below and RichText.astro's own header comment for why sanitizing
    // (not trusting, not stripping all markup) is the deliberate choice.
    html: '<p>Hello <script>alert(1)</script><strong>world</strong></p>',
  },
  features: { type: "features", items: [{ title: "Fast", body: "Really fast." }] },
  gallery: { type: "gallery", mediaIds: [] },
  faq: { type: "faq", items: [{ question: "Why AstroTan?", answer: "Because." }] },
  cta: { type: "cta", title: "Join now", cta: { label: "Sign up", href: "/signup" } },
}

describe("block components render their own block variant", () => {
  for (const type of BLOCK_TYPES) {
    test(`${type} renders without throwing and produces non-empty markup`, async () => {
      const container = await AstroContainer.create()
      const html = await container.renderToString(blockRegistry[type], {
        props: { block: fixtures[type] },
      })
      expect(html.trim().length).toBeGreaterThan(0)
    })
  }

  test("richText strips a stored <script> tag rather than trusting it", async () => {
    const container = await AstroContainer.create()
    const html = await container.renderToString(blockRegistry.richText, {
      props: { block: fixtures.richText },
    })
    expect(html).not.toContain("<script")
    expect(html).toContain("world")
  })
})
