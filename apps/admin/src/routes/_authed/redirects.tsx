import { createFileRoute } from "@tanstack/react-router"

// Stub route, claimed ahead of its screen so `app-sidebar.tsx` can link to
// it without breaking the typed router. The redirects screen lands here.
export const Route = createFileRoute("/_authed/redirects")({
  component: () => (
    <p className="text-sm text-muted-foreground">Redirections — à venir.</p>
  ),
})
