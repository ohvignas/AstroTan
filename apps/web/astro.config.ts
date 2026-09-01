import { defineConfig, memoryCache } from "astro/config"
import node from "@astrojs/node"
import react from "@astrojs/react"
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
  integrations: [react()],

  // AUCUN `security.allowedDomains` ICI, ET C'EST LE POINT.
  //
  // Ce fichier est lu pendant `astro build` : tout ce qu'on y écrit est
  // figé dans l'image, comme une `PUBLIC_*`. Un domaine posé ici ne pouvait
  // donc changer qu'en RECONSTRUISANT — ce que l'écran `/settings/domaine`
  // ne peut pas faire, et c'est précisément ce qui l'empêchait d'exister.
  //
  // La reconnaissance de l'hôte n'a pas disparu pour autant : elle a
  // déménagé au runtime, dans `src/lib/allowedDomains.ts`, qui lit la même
  // query `routing.hotes` que le service `routeur`. Les deux limiteurs de
  // débit du site (`/api/contact`, `/api/consent`) passent par elle avant
  // d'imputer une requête à une adresse, et l'échec y est fermé : hôte
  // inconnu, ou hôtes illisibles, ⇒ `x-forwarded-for` n'est pas honoré.
  //
  // Ne pas la remettre par commodité : Astro déciderait alors AVANT nos
  // routes, et deux mécanismes de reconnaissance qui peuvent diverger
  // valent moins qu'un seul.

  // Astro's Cache API (stable as of Astro 7). `memoryCache()` is per-process
  // — the spec's assumed debt (§6.2/§7 "Rollback et migrations"): an
  // invalidation only reaches the instance that received the HTTP call, so
  // this lot runs a single `web` replica. Scaling to N replicas requires a
  // shared provider (e.g. Redis) before this line can stay as-is.
  cache: { provider: memoryCache() },

  // Cache *hints* per route pattern. These are read when a matching route
  // does not itself call `Astro.cache.set(...)` — they are not fetched or
  // applied to routes that must never be cached (`/api/revalidate`,
  // les routes d'aperçu (loadPage / loadPost quand ?t= est valide), Task 7). Those call `Astro.cache.set(false)` /
  // `context.cache.set(false)` in the route itself: the documented opt-out
  // is the explicit call, not an absence of a `routeRules` entry.
  // No `routeRules` entry: every page sets its own cache through
  // `loadPage` (`src/lib/loadPage.ts`), which is the documented opt-out
  // pattern and keeps the tag next to the slug it invalidates. The old
  // `/[...slug]` rule went with the catch-all route it described.
  // Les images de la médiathèque vivent dans Convex storage : ce sont des
  // URL *distantes*, servies au moment de la requête. `astro:assets`
  // n'optimise une image distante que si son domaine est explicitement
  // autorisé ici — sinon elle traverse le pipeline sans être touchée : pas
  // de `srcset`, pas d'AVIF/WebP, pas de redimensionnement, et rien qui le
  // signale. C'est le défaut silencieux que cette section existe pour
  // fermer.
  //
  // Le domaine est dérivé de `PUBLIC_CONVEX_URL` plutôt qu'écrit en dur :
  // il diffère entre le déploiement local (`127.0.0.1:3210`) et la
  // production (`*.convex.cloud`), et une valeur figée n'optimiserait
  // qu'un des deux.
  image: {
    remotePatterns: [
      { protocol: "https", hostname: "**.convex.cloud" },
      // Le déploiement local, pour que le comportement observé en
      // développement soit celui de la production.
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
    ],
  },

  vite: {
    plugins: [tailwindcss()],
  },
})
