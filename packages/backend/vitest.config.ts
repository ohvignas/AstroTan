import { defineConfig } from "vitest/config"

// `e2e/**` is excluded from the default `vitest run` (this is what `pnpm
// test`/`turbo run test` invoke, and what CLAUDE.md's "keep the suite
// green" count is measured against). Those tests make real HTTP calls
// against a locally running Convex + Astro dev stack — they cannot run
// under `convex-test`'s mocked backend (`edge-runtime`, no real network),
// and they must not silently fail the whole suite in an environment where
// that stack isn't up. Run them explicitly with `pnpm test:e2e`
// (`vitest.e2e.config.ts`), against real running servers only.
export default defineConfig({ test: { environment: "edge-runtime", exclude: ["e2e/**", "node_modules/**"] } })
