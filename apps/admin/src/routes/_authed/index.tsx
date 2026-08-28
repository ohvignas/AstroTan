import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SiteDashboardPanel } from "@/components/site-dashboard"

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
})

function DashboardPage() {
  // `undefined` pendant le chargement, `null` si Umami n'est pas configuré.
  const umamiUrl = useQuery(api.analytics.umamiUrl)

  // L'accueil ne répond qu'à une question : comment va le site. L'identité
  // de la session et le rôle sont déjà dans la barre latérale — les répéter
  // ici occupait la première place de l'écran sans rien apprendre.
  return <SiteDashboardPanel umamiUrl={umamiUrl} />
}
