import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SiteDashboardPanel } from "@/components/site-dashboard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
})

const ROLE_LABELS = {
  owner: "Propriétaire",
  admin: "Administrateur",
  editor: "Éditeur",
} as const

function DashboardPage() {
  // Déjà souscrite par `AppShell` (même query, mêmes arguments) — ceci
  // réutilise cette souscription plutôt que d'en ouvrir une seconde.
  const profile = useQuery(api.profiles.me)
  const umamiUrl = useQuery(api.analytics.umamiUrl)

  return (
    <div className="flex flex-col gap-4">
      {/* L'audience d'abord : c'est la question qu'on se pose en ouvrant
          l'administration le matin. L'identité de la session vient après —
          elle est déjà dans la barre latérale. */}
      <SiteDashboardPanel umamiUrl={umamiUrl} />

      <Card>
        <CardHeader>
          <CardTitle>Votre session</CardTitle>
          <CardDescription>
            {profile ? `Connecté en tant que ${profile.displayName}` : "Chargement…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {profile && (
            <p>
              Rôle : <span className="font-medium text-foreground">{ROLE_LABELS[profile.role]}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
