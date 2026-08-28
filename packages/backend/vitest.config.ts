import { defineConfig } from "vitest/config"

// `e2e/**` is excluded from the default `vitest run` (this is what `pnpm
// test`/`turbo run test` invoke, and what CLAUDE.md's "keep the suite
// green" count is measured against). Those tests make real HTTP calls
// against a locally running Convex + Astro dev stack — they cannot run
// under `convex-test`'s mocked backend (`edge-runtime`, no real network),
// and they must not silently fail the whole suite in an environment where
// that stack isn't up. Run them explicitly with `pnpm test:e2e`
// (`vitest.e2e.config.ts`), against real running servers only.
// `testTimeout` is raised well above vitest's 5 s default, and the reason is
// measured rather than defensive. `auth.signInRateLimit.test.ts` drives the
// limiter to its bound by making real sign-in attempts, and each one runs a
// real password hash: the file takes ~10 s for 8 tests on an idle machine,
// so individual tests already sit close to 5 s. Under parallel load — the
// other 23 files, a Docker build, an agent installing packages — they cross
// it and vitest kills them. A killed test reports no assertion, which is why
// this looked for hours like a flaky rate limiter rather than a timeout.
//
// Raising it weakens nothing: every assertion, threshold and ordering is
// unchanged. It only stops the suite failing for being slow.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: ["e2e/**", "node_modules/**"],
    testTimeout: 30_000,
  },
})
