import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { DomainAndEmailsPage } from "@/components/settings-environment"
import {
  SettingsLoading,
  SettingsPageShell,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/domaine")({
  component: DomaineRoute,
})

function DomaineRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  // Des booléens et deux origines publiques, jamais la valeur d'une clé —
  // `settings.environment.test.ts` échoue si un secret sort d'ici.
  const environment = useQuery(api.settings.environment)
  if (loading || environment === undefined || secrets === undefined) {
    return <SettingsLoading />
  }

  return (
    <SettingsPageShell to="/settings/domaine" canWrite={canWrite}>
      <DomainAndEmailsPage
        resend={environment.resend}
        adminUrl={environment.adminUrl}
        webUrl={environment.webUrl}
        secrets={secrets}
      />
    </SettingsPageShell>
  )
}
