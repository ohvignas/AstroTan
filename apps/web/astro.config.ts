import { defineConfig, memoryCache } from "astro/config"
import node from "@astrojs/node"
import tailwindcss from "@tailwindcss/vite"

// Spec §6.1 — the exact configuration the publication loop (Task 6/7) depends
// on. `output: 'static'` prerenders everything by default; individual CMS
// routes opt out with `export const prerender = false` in the route itself
// (Task 6), never through `routeRules` (see the comment on `routeRules`
// below). `adapter: node({ mode: 'standalone' })` serves the prerendered
// files *and* runs the on-demand routes from the same container — no
// separate static host.
export default defineConfig({
  output: "static",
  adapter: node({ mode: "standalone" }),

  // Astro's Cache API (stable as of Astro 7). `memoryCache()` is per-process
  // — the spec's assumed debt (§6.2/§7 "Rollback et migrations"): an
  // invalidation only reaches the instance that received the HTTP call, so
  // this lot runs a single `web` replica. Scaling to N replicas requires a
  // shared provider (e.g. Redis) before this line can stay as-is.
  cache: { provider: memoryCache() },

  // Cache *hints* per route pattern. These are read when a matching route
  // does not itself call `Astro.cache.set(...)` — they are not fetched or
  // applied to routes that must never be cached (`/api/revalidate`,
  // `/preview/[type]/[id]`, Task 7). Those call `Astro.cache.set(false)` /
  // `context.cache.set(false)` in the route itself: the documented opt-out
  // is the explicit call, not an absence of a `routeRules` entry.
  // No `routeRules` entry: every page sets its own cache through
  // `loadPage` (`src/lib/loadPage.ts`), which is the documented opt-out
  // pattern and keeps the tag next to the slug it invalidates. The old
  // `/[...slug]` rule went with the catch-all route it described.
  vite: {
    plugins: [tailwindcss()],
  },
})
