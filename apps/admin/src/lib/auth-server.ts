import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start"

// Server-only helpers backing the Better Auth <-> Convex bridge in this app:
//   - `handler`            proxied by `src/routes/api/auth/$.ts` so every
//                           Better Auth request/response (and its session
//                           cookie) stays same-origin on this app's own
//                           domain instead of the Convex deployment's
//                           `*.convex.site` origin. Removing that proxy
//                           makes the cookie cross-site and breaks the
//                           session — see the route file's own comment.
//   - `getToken`            used by the root route's `beforeLoad` to read
//                           the session cookie server-side (via TanStack
//                           Start's `getRequestHeaders()`) and mint the
//                           Convex-verifiable JWT for SSR.
//   - `fetchAuthQuery` / `fetchAuthMutation` / `fetchAuthAction`
//                           authenticated Convex calls from server code
//                           (loaders, server functions) — unused by this
//                           task's routes today, but part of the same
//                           bridge and cheap to export alongside the rest.
//
// `VITE_CONVEX_URL`/`VITE_CONVEX_SITE_URL` (not `CONVEX_URL`/`CONVEX_SITE_URL`,
// which is what `packages/backend/.env.local` sets for the Convex CLI):
// this is the TanStack Start app's own `.env.local`, and the `VITE_` prefix
// is what makes the value available to the browser bundle too — the client
// (`src/router.tsx`) constructs its own `ConvexReactClient` from the same
// `VITE_CONVEX_URL`.
export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
    convexUrl: process.env.VITE_CONVEX_URL!,
    convexSiteUrl: process.env.VITE_CONVEX_SITE_URL!,
  })
