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
