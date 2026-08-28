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
  routeRules: {
    "/[...slug]": { maxAge: 300, swr: 600, tags: ["pages"] },
  },

  // Tailwind v4 has no PostCSS/Astro integration package of its own — the
  // Vite plugin is the supported path, same as `apps/admin`. Class usage is
  // discovered from the whole Vite module graph, so no `content` globs are
  // needed here even though the theme lives in `packages/tokens`.
  vite: {
    plugins: [tailwindcss()],
  },
})
