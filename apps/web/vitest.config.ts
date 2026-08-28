/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config"

// `blockRegistry.test.ts` imports `blockRegistry.ts`, which imports the six
// `.astro` block components — plain Vitest has no `.astro` file transform,
// so it can't even load that module graph. `getViteConfig` (Astro's own
// documented Vitest integration, `astro/config`) merges this app's own
// `astro.config.ts` — including the Astro Vite plugin that compiles
// `.astro` files — into the Vite config Vitest runs under, so importing a
// `.astro` component from a test file works exactly like it does from a
// route.
export default getViteConfig({
  test: {
    environment: "node",
  },
})
