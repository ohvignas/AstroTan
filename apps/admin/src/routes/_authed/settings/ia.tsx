import { createFileRoute, redirect } from "@tanstack/react-router"

// Signet : la clé OpenRouter et les modèles vivent sur /settings/agent
// (Agent IA & Modèle IA). La route reste pour ne pas 404 un bookmark.
export const Route = createFileRoute("/_authed/settings/ia")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/agent", search: {} })
  },
})
