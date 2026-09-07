import { useEffect } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SiteDashboardPanel } from "@/components/site-dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authed/statistiques")({
  component: StatistiquesPage,
})

// Relais vers le share Umami (lecture seule, sans connexion). La barre
// pointe déjà cette adresse en externe dès qu'elle est connue ; cette
// route existe pour les favoris `/statistiques` et le court instant où
// `umamiLinks` n'a pas encore répondu.
//
// Sans partage configuré, on garde la carte in-app : un adoptant n'est
// jamais envoyé sur le login Umami. Le relais SSO n'a plus de lien —
// il prêtait un compte partagé.
function StatistiquesPage() {
  const umami = useQuery(api.analytics.umamiLinks)

  useEffect(() => {
    if (umami?.shared === true) {
      window.location.replace(umami.dashboard)
    }
  }, [umami])

  if (umami?.shared === true) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ouverture des statistiques…</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Redirection vers la vue Umami en lecture seule.
        </CardContent>
      </Card>
    )
  }

  return <SiteDashboardPanel />
}
