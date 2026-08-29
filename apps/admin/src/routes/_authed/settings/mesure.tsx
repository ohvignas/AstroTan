import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { MeasurementPage } from "@/components/settings-environment"
import {
  SettingsLoading,
  SettingsPageShell,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/mesure")({
  component: MesureRoute,
})

function MesureRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  // Deux sources, et elles ne disent pas la même chose :
  // `settings.environment` rapporte ce que l'ENVIRONNEMENT du déploiement
  // porte, `secrets.status` ce qui est rangé EN BASE. C'est la comparaison
  // des deux qui permet à l'écran d'annoncer laquelle sert.
  const environment = useQuery(api.settings.environment)
  if (loading || environment === undefined || secrets === undefined) {
    return <SettingsLoading />
  }

  return (
    <SettingsPageShell to="/settings/mesure" canWrite={canWrite}>
      <MeasurementPage umamiApi={environment.umamiApi} secrets={secrets} />
    </SettingsPageShell>
  )
}
