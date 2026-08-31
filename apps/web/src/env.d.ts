/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Public Convex deployment URL (`https://*.convex.cloud` in production,
   * `http://127.0.0.1:3210` for the local backend). Read by
   * `src/lib/convexClient.ts` to build the `ConvexHttpClient`.
   *
   * `PUBLIC_` is Astro/Vite's convention for env vars that are safe to ship
   * to the browser — appropriate here, since this value carries no secret:
   * `apps/web` never holds a session or an admin key (CLAUDE.md invariant
   * #1), so exposing the deployment URL itself leaks nothing a draft-page
   * request couldn't already infer.
   */
  readonly PUBLIC_CONVEX_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare namespace App {
  interface Locals {
    /**
     * Le nonce de la CSP pour CETTE requête, posé par `src/middleware.ts`.
     *
     * Le contrat tient en une phrase : le middleware le pose, les composants
     * le lisent par `Astro.locals.nonce` et l'écrivent sur leurs `<script>`
     * en ligne. Sans lui, un `<script is:inline>` ne s'exécute pas — la CSP
     * n'autorise aucun script en ligne autrement.
     *
     * Optionnel parce qu'il l'est réellement : un composant peut être rendu
     * hors du pipeline HTTP (un test, un rendu de composant isolé), et
     * `nonce={undefined}` n'écrit simplement pas l'attribut.
     */
    nonce?: string
    /**
     * `true` quand `loadPage` / `loadPost` ont accepté un jeton d'aperçu.
     * Le bandeau vit une seule fois, dans `BaseLayout`.
     */
    preview?: boolean
  }
}
