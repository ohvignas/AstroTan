import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { ConvexReactClient } from "convex/react"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) {
    throw new Error(
      "VITE_CONVEX_URL is not set. Copy .env.example to .env.local and fill it in.",
    )
  }

  // One client per router instance (not a module singleton): TanStack
  // Start creates a fresh router per SSR request, and a shared client would
  // leak auth state across requests/users on the server.
  const convexClient = new ConvexReactClient(convexUrl, {
    unsavedChangesWarning: false,
  })

  const router = createTanStackRouter({
    routeTree,
    context: { convexClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
