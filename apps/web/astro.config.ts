import { defineConfig, memoryCache } from "astro/config"
import node from "@astrojs/node"
import tailwindcss from "@tailwindcss/vite"
import { domainesAutorises } from "./src/lib/allowedDomains"

// `WEB_DOMAIN` est lue ICI, dans la configuration, et pas dans `src/` : elle
// est figée AU BUILD comme une `PUBLIC_*`, et une lecture dans `src/` la
// ferait passer pour une variable de runtime — celle que le conteneur lit au
// démarrage — qui est précisément la confusion que
// `scripts/check-env-wiring.mjs` existe pour attraper.
const allowedDomains = domainesAutorises(process.env.WEB_DOMAIN)
if (allowedDomains.length === 0) {
  // Pas une erreur : en développement il n'y a pas de proxy, et
  // `clientAddress` est déjà l'adresse réelle du visiteur. En revanche
  // l'image de production refuse de se construire sans cette variable
  // (`RUN test -n "$WEB_DOMAIN"`, docker/web.Dockerfile) — la panne qu'elle
  // cause ne se voit pas, elle doit donc s'annoncer.
  console.warn(
    "[astrotan] WEB_DOMAIN absente : `x-forwarded-for` sera ignoré et " +
      "`clientAddress` vaudra l'adresse du reverse proxy — donc la MÊME pour " +
      "tous les visiteurs. Sans conséquence en local, inacceptable derrière " +
      "Traefik (voir src/lib/allowedDomains.ts).",
  )
}

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

  // Les hôtes que ce déploiement reconnaît comme les siens. C'est la
  // condition — et la seule — pour qu'Astro honore `x-forwarded-for` et que
  // `clientAddress` soit l'adresse du VISITEUR plutôt que celle de Traefik.
  // Les deux limiteurs de débit du site (`/api/contact`, `/api/consent`) en
  // dépendent entièrement : le raisonnement complet est dans
  // `src/lib/allowedDomains.ts`.
  security: { allowedDomains },

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
