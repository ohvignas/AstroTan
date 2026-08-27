import { createAuthClient } from "better-auth/react"
import { convexClient } from "@convex-dev/better-auth/client/plugins"

// The only Better Auth client plugin wired in is `convexClient()` — it adds
// `authClient.convex.token()`, which is how `ConvexBetterAuthProvider`
// (root route) exchanges the Better Auth session for the Convex-verifiable
// JWT. No social/OAuth plugins: the backend only enables `emailAndPassword`
// (packages/backend/convex/auth.ts), and adding a client-side plugin here
// for a provider the server never accepts would just be a dead button.
export const authClient = createAuthClient({
  plugins: [convexClient()],
})
