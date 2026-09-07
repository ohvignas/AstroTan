import { createFileRoute } from "@tanstack/react-router"
import { SiteDashboardPanel } from "@/components/site-dashboard"

export const Route = createFileRoute("/_authed/statistiques")({
  component: StatistiquesPage,
})

// Même carte d'audience que l'accueil, sans les tuiles de contenu.
// Ce n'est plus un relais SSO : ouvrir le dashboard Umami prêtait un
// compte partagé et sortait de l'admin. Les chiffres se lisent ici.
function StatistiquesPage() {
  return <SiteDashboardPanel />
}
