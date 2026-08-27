import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { createServerFn } from "@tanstack/react-start"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import type { ConvexReactClient } from "convex/react"

import { authClient } from "@/lib/auth-client"
import { getToken } from "@/lib/auth-server"
import appCss from "../styles.css?url"

// Wrapped in `createServerFn` (not called directly from `beforeLoad`):
// `getToken` reads the incoming request's cookies via
// `getRequestHeaders()`, which only exists in a server context.
// `beforeLoad` itself re-runs in the browser on client-side navigations,
// where that API isn't available — `createServerFn` forces this specific
// call back onto the server every time, via RPC when invoked from the
// client.
//
// Caught, not left to propagate: `getToken` does an HTTP round-trip to the
// Convex deployment, and a transient failure there (deployment restarting,
// network blip) is not the same fact as "this visitor has no session" — it
// should degrade to the same effect (`<AuthLoading>`/`<Unauthenticated>`
// take over once the browser's own Convex client tries to connect) rather
// than a raw 500 for every route, `/login` included.
const fetchAuthToken = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return (await getToken()) ?? null
  } catch {
    return null
  }
})

export const Route = createRootRouteWithContext<{
  convexClient: ConvexReactClient
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AstroTan — Administration" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  // Runs on every request (SSR) and every client navigation. On the server
  // it resolves the Better Auth session cookie into a Convex-verifiable
  // JWT; on the client `createServerFn` round-trips back to the server for
  // the same thing. The result becomes `initialToken` below, which is what
  // lets a full page reload land already-authenticated instead of flashing
  // the login redirect while Convex's own auth handshake catches up.
  beforeLoad: async () => {
    const token = await fetchAuthToken()
    return { token }
  },
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>Page introuvable.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { convexClient, token } = useRouteContext({ from: Route.id })
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexBetterAuthProvider client={convexClient} authClient={authClient} initialToken={token}>
          {children}
        </ConvexBetterAuthProvider>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
