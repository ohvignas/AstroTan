import { createFileRoute } from "@tanstack/react-router"
import { handler } from "@/lib/auth-server"

// Proxies every Better Auth route (sign-in, sign-out, session, the convex
// plugin's /token, ...) through to Convex's own Better Auth HTTP routes
// (registered by `authComponent.registerRoutes` in
// packages/backend/convex/http.ts), instead of the browser calling
// `*.convex.site` directly.
//
// This is not a convenience shim — it is what keeps the session cookie
// same-origin. Better Auth's cookie is scoped to whatever origin answers
// these requests; proxied through here, that's this app's own origin
// (`admin.illith.com` in production, `localhost:3001` in dev). Delete this
// route and point the client straight at the Convex site URL instead, and
// the cookie becomes cross-site — rejected by default `SameSite=Lax`
// cookies on the very sign-in redirect that's supposed to set it.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
})
