import { createFileRoute } from "@tanstack/react-router"

// Stub route, claimed ahead of its screen so `app-sidebar.tsx` can link to
// it without breaking the typed router. Site settings land here.
export const Route = createFileRoute("/_authed/settings")({
  component: () => (
    <p className="text-sm text-muted-foreground">Réglages — à venir.</p>
  ),
})
