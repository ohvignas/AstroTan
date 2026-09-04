import { createFileRoute } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import { describeSettingsError } from "@/lib/settingsErrors"
import { SeoPixelPage } from "@/components/settings-seo-pixel"
import { useAutoSave } from "@/components/save-bar"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/mesure")({
  component: MesureRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type DataForSeo = FunctionReturnType<typeof api.dataforseo.identifiants>
type Secrets = NonNullable<ReturnType<typeof useSecretsAccess>["secrets"]>

function MesureRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  const settings = useQuery(api.settings.getPrivate)
  // Réservée à owner/admin, comme `secrets.status` : `"skip"` pour un
  // editor, sans quoi la query refuserait et ferait échouer la page.
  const dataForSeo = useQuery(api.dataforseo.identifiants, canWrite ? {} : "skip")

  // `dataForSeo` est attendu comme `secrets`, et seulement quand il va
  // vraiment arriver : le formulaire lit son état initial dans ses props,
  // et se monter avant la query l'aurait fait naître vide puis remonter.
  // Un editor est en `"skip"` — l'attendre bloquerait sa page pour de bon.
  if (loading || settings === undefined || secrets === undefined) {
    return <SettingsLoading />
  }
  if (canWrite && dataForSeo === undefined) return <SettingsLoading />

  return (
    <MesureForm
      canWrite={canWrite}
      secrets={secrets}
      settings={settings}
      dataForSeo={dataForSeo}
    />
  )
}

// ---------------------------------------------------------------------
// Même chrome qu'Identité / Envoi des emails : en-tête + barre fixe.
//
// RIEN ne passe par la barre. DataForSEO a son propre « Enregistrer »
// (essai de connexion + Connecté) — le dupliquer ici ferait deux boutons
// pour le même geste. Les pixels et le lieu SERP s'écrivent chacun à
// leur clic ou au changement, comme la clé Resend et les modèles IA.
// `auto: {}` : `snapshotChanged` reste faux, la barre affiche « Aucun
// enregistrement depuis l'ouverture de cet écran ».
// ---------------------------------------------------------------------

function MesureForm({
  canWrite,
  secrets,
  settings,
  dataForSeo,
}: {
  canWrite: boolean
  secrets: Secrets
  settings: Settings
  dataForSeo: DataForSeo | undefined
}) {
  const update = useMutation(api.settings.update)
  const enregistrerDataForSeo = useAction(api.dataforseo.enregistrer)

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: {},
    manual: {},
    saveAuto: async () => {
      throw new Error(
        "SEO & Pixel n'a aucun champ à sauvegarde automatique : cet appel ne devrait pas exister."
      )
    },
    saveAll: async () => {
      throw new Error(
        "SEO & Pixel n'a aucun champ à enregistrer depuis la barre : cet appel ne devrait pas exister."
      )
    },
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/mesure"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Les identifiants DataForSEO, les pixels ou le lieu SERP"
    >
      <SeoPixelPage
        canWrite={canWrite}
        secrets={secrets}
        dataForSeo={dataForSeo}
        metaPixelId={settings?.metaPixelId ?? null}
        googleTagId={settings?.googleTagId ?? null}
        googleConversionLabel={settings?.googleConversionLabel ?? null}
        serpLocationCode={settings?.serpLocationCode ?? null}
        serpLanguageCode={settings?.serpLanguageCode ?? null}
        onSaveDataForSeo={(login, password) =>
          enregistrerDataForSeo({ login, password })
        }
        onClearSecret={secrets.onClear}
        onSavePixel={(patch) => update(patch)}
        onSaveSerp={(patch) => update(patch)}
      />
    </SettingsFormShell>
  )
}
