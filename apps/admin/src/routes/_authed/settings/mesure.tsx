import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SeoPixelPage } from "@/components/settings-seo-pixel"
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
  const settings = useQuery(api.settings.getPrivate)
  const update = useMutation(api.settings.update)

  if (loading || settings === undefined || secrets === undefined) {
    return <SettingsLoading />
  }

  return (
    <SettingsPageShell to="/settings/mesure" canWrite={canWrite}>
      <SeoPixelPage
        canWrite={canWrite}
        secrets={secrets}
        metaPixelId={settings?.metaPixelId ?? null}
        googleTagId={settings?.googleTagId ?? null}
        serpLocationCode={settings?.serpLocationCode ?? null}
        serpLanguageCode={settings?.serpLanguageCode ?? null}
        onSaveSecret={secrets.onSave}
        onClearSecret={secrets.onClear}
        onSavePixel={(patch) => update(patch)}
        onSaveSerp={(patch) => update(patch)}
      />
    </SettingsPageShell>
  )
}
