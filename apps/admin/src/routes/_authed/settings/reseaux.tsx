import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import {
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
} from "@astrotan/backend/convex/content"
import { describeSettingsError } from "@/lib/settingsErrors"
import { RepeatableItems } from "@/components/repeatable-items"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import { FieldDescription } from "@/components/ui/field"

export const Route = createFileRoute("/_authed/settings/reseaux")({
  component: ReseauxRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type Social = { label: string; url: string }

function ReseauxRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || settings === undefined) return <SettingsLoading />
  return <ReseauxForm settings={settings} canWrite={canWrite} />
}

function ReseauxForm({
  settings,
  canWrite,
}: {
  settings: Settings
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [socials, setSocials] = useState<Social[]>(settings?.socials ?? [])

  const autoFields = {
    // Les lignes commencées puis laissées à moitié sont écartées plutôt
    // qu'envoyées : un lien social sans URL s'afficherait dans le pied de
    // page comme un lien vers nulle part.
    socials: socials.filter(
      (social) => social.label.trim() !== "" && social.url.trim() !== ""
    ),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: autoFields,
    manual: {},
    saveAuto: async (auto) => {
      await updateSettings(auto)
    },
    saveAll: async ({ auto }) => {
      await updateSettings(auto)
    },
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/reseaux"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="La liste des réseaux sociaux"
    >
      <SettingsGroup>
        <FieldDescription>
          {MAX_SOCIALS} liens au maximum. Une ligne dont le libellé ou l'URL
          est vide n'est pas enregistrée.
        </FieldDescription>
        <RepeatableItems
          items={socials}
          disabled={!canWrite || socials.length >= MAX_SOCIALS}
          addLabel="Ajouter un lien"
          emptyItem={{ label: "", url: "" }}
          fields={[
            { key: "label", label: "Libellé", max: MAX_SOCIAL_LABEL_LENGTH },
            { key: "url", label: "URL", max: MAX_SOCIAL_URL_LENGTH },
          ]}
          onChange={setSocials}
        />
      </SettingsGroup>
    </SettingsFormShell>
  )
}
