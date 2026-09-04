import { createFileRoute, redirect } from "@tanstack/react-router"

// L'écran a fusionné avec Identité : le sélecteur (catalogue + URL)
// vit sous `/settings/identite`. Garder la route évite une 404 sur un
// favori ou un lien déjà partagé.
export const Route = createFileRoute("/_authed/settings/reseaux")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/identite" })
  },
})
