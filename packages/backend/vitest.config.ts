import { defineConfig } from "vitest/config"

// `passWithNoTests` also governs an empty `describe` block, not just an
// empty test *file* — `packages/backend/convex/lib/authz.test.ts`'s
// "matrice de permissions" suite loops over `MUTATION_REGISTRY`, which is
// deliberately empty until Task 7 adds its first entry. Without this flag,
// Vitest 4's runner fails that suite with "No test found in suite", even
// though an empty registry producing zero permission tests is the intended
// Task 5 state (see `_registry.ts`'s own comment).
export default defineConfig({
  test: { environment: "edge-runtime", passWithNoTests: true },
})
