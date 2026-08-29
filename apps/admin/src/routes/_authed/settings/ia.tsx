import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { AiPage } from "@/components/settings-environment"
import {
  SettingsLoading,
  SettingsPageShell,
  useSettingsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/ia")({
  component: IaRoute,
})

function IaRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const environment = useQuery(api.settings.environment)
  if (loading || environment === undefined) return <SettingsLoading />

  return (
    <SettingsPageShell to="/settings/ia" canWrite={canWrite}>
      <AiPage configured={environment.openRouter.configured} />
    </SettingsPageShell>
  )
}
