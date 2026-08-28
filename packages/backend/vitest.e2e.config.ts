import { defineConfig } from "vitest/config"

// Task 9 (Lot 2) — the end-to-end publication-loop coverage. Deliberately
// a *separate* Vitest project from `vitest.config.ts`: these tests make
// real HTTP calls against a locally running Convex deployment (3210/3211)
// and the real Astro dev server (4321) — no `convex-test` mock, no
// stubbed `fetch`. `environment: "node"` (not `edge-runtime`, the default
// project's choice for `convex-test` compatibility): real `fetch`/timers
// against real sockets, nothing edge-runtime-specific is exercised here.
//
// Run with `pnpm test:e2e` (`package.json`). Requires, all already
// running per this project's own dev workflow (never started by this
// config or the test file itself):
//   - Convex on 3210/3211 (`npx convex dev`, run by a human/controller —
//     CLAUDE.md: agents never run this themselves)
//   - `apps/web` on 4321, started with `PREVIEW_SECRET`/`REVALIDATE_SECRET`
//     exported in its shell environment (Task 7's own documented wrinkle)
//   - The seeded local accounts documented in the test file itself
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
