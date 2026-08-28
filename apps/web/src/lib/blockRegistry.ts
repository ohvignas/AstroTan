import type { AstroComponentFactory } from "astro/runtime/server/index.js"
import type { Block } from "@astrotan/backend/convex/blocks"

import Hero from "../components/blocks/Hero.astro"
import RichText from "../components/blocks/RichText.astro"
import Features from "../components/blocks/Features.astro"
import Gallery from "../components/blocks/Gallery.astro"
import Faq from "../components/blocks/Faq.astro"
import Cta from "../components/blocks/Cta.astro"

// Lot 2, Task 5; design spec §4 ("Blocs"): "le type se propage jusqu'au
// composant `.astro` via un registre `Record<Block["type"],
// AstroComponentFactory>` exhaustif — ajouter un type de bloc sans son
// composant devient une erreur TypeScript."
//
// That guarantee lives in the type annotation on `blockRegistry` itself,
// not in how it's built: `Record<Block["type"], AstroComponentFactory>`
// requires an entry for every literal in the `Block["type"]` union, so
// widening `blocks.ts`'s discriminated union with a 7th block type makes
// this object literal fail to typecheck (`astro check`, `tsc`) until a
// matching `.astro` component is imported and added below — a compile
// error, not a runtime surprise on a live page.
//
// `blockRegistry.test.ts` is the other half this comment (and the task
// brief) insists on: a *runtime* check, over `BLOCK_TYPES` — the same
// array `packages/backend/convex/blocks.ts` exports as the source of
// truth for "every block type" — that a compile-time-only guarantee can't
// give by itself. A direct type annotation like this one is sound on its
// own, but nothing stops a future edit from replacing it with something
// that bypasses excess/missing-property checking (an `as` cast, a
// `Partial<...>`, building the object dynamically) — at which point this
// comment's claim keeps reading as true while the registry silently stops
// enforcing it. The runtime test still catches that, because it doesn't
// trust this file's type annotation; it re-derives the expected key list
// from `BLOCK_TYPES` and checks the object actually has a component
// function under every one of them.
export const blockRegistry: Record<Block["type"], AstroComponentFactory> = {
  hero: Hero,
  richText: RichText,
  features: Features,
  gallery: Gallery,
  faq: Faq,
  cta: Cta,
}
