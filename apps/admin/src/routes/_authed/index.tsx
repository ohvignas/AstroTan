import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
})

const ROLE_LABELS = {
  owner: "Propriétaire",
  admin: "Administrateur",
  editor: "Éditeur",
} as const

function Dashboard() {
  // Already subscribed by `AppShell` (same query, same args) — this reuses
  // that subscription rather than opening a second one.
  const profile = useQuery(api.profiles.me)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tableau de bord</CardTitle>
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
  )
}
