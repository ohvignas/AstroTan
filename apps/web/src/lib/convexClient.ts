import { ConvexHttpClient } from "convex/browser"

// The whole invariant this app exists to protect (CLAUDE.md #1, spec §6.3):
// `apps/web` has no session and no admin key. `ConvexHttpClient` is an
// unauthenticated, cookie-less HTTP client — there is no `.setAuth(...)`
// call anywhere in this app, and there must never be one. Every function
// this client calls has to be a public query (`getPublishedPage`,
// `listPublishedPages`, …) that filters `status === "published"` on the
// server, or the `previewPage` family gated by its own HMAC token — never
// anything that trusts a client-supplied role or id.
//
// Do not import `@convex-dev/better-auth` here, or anywhere else in this
// app. That dependency belongs to `apps/admin`, which owns the session.

let client: ConvexHttpClient | undefined

/**
 * Lazily builds (and memoizes) the single `ConvexHttpClient` this app uses
 * for every Convex call. Lazy so a missing `PUBLIC_CONVEX_URL` fails loudly
 * the first time a route actually needs Convex, rather than crashing the
 * whole server at import time — consistent with how the backend's own env
 * guards (`PREVIEW_SECRET`, `REVALIDATE_SECRET`) throw from inside the call
 * that needs them, not from module load.
 */
export function getConvexClient(): ConvexHttpClient {
  if (client) return client

  const url = import.meta.env.PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error(
      "PUBLIC_CONVEX_URL is not set. Copy .env.example to .env.local and fill it in.",
    )
  }

  client = new ConvexHttpClient(url)
  return client
}
