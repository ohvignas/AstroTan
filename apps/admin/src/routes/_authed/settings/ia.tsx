import { createFileRoute } from "@tanstack/react-router"
import { AiPage } from "@/components/settings-environment"
import {
  SettingsLoading,
  SettingsPageShell,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/ia")({
  component: IaRoute,
})

function IaRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  if (loading || secrets === undefined) return <SettingsLoading />

  return (
    <SettingsPageShell to="/settings/ia" canWrite={canWrite}>
      <AiPage secrets={secrets} />
    </SettingsPageShell>
  )
}
