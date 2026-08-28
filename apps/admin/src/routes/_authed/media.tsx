import { createFileRoute } from "@tanstack/react-router"

// Stub route, claimed ahead of its screen so `app-sidebar.tsx` can link to
// it without breaking the typed router. The media library lands here.
export const Route = createFileRoute("/_authed/media")({
  component: () => (
    <p className="text-sm text-muted-foreground">Médiathèque — à venir.</p>
  ),
})
