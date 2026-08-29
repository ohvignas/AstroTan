import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import {
  MAX_CANONICAL_URL_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
} from "@astrotan/backend/convex/content"
import { describeSettingsError } from "@/lib/settingsErrors"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/_authed/settings/referencement")({
  component: ReferencementRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

function ReferencementRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || settings === undefined) return <SettingsLoading />
  return <ReferencementForm settings={settings} canWrite={canWrite} />
}

function ReferencementForm({
  settings,
  canWrite,
}: {
  settings: Settings
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [siteName] = useState(settings?.siteName ?? "")
  const [title, setTitle] = useState(settings?.defaultSeo?.title ?? "")
  const [description, setDescription] = useState(
    settings?.defaultSeo?.description ?? ""
  )
  const [canonicalUrl, setCanonicalUrl] = useState(
    settings?.defaultSeo?.canonicalUrl ?? ""
  )
  const [noindex, setNoindex] = useState(settings?.defaultSeo?.noindex ?? false)

  const autoFields = {
    defaultSeo: {
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      canonicalUrl: canonicalUrl.trim() || undefined,
      noindex,
      // Reconduit tel quel. `settings.update` remplace `defaultSeo` en
      // entier, et cet écran n'a pas de contrôle pour l'image OG par
      // défaut — l'omettre ici la supprimerait à chaque enregistrement.
      ...(settings?.defaultSeo?.ogImageId === undefined
        ? {}
        : { ogImageId: settings.defaultSeo.ogImageId }),
    },
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
      to="/settings/referencement"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Le référencement par défaut"
    >
      {/* Un seul groupe de champs : pas de `h2`, il répéterait le `h1`. */}
      <SettingsGroup>
        <Field>
          <FieldLabel htmlFor="default-seo-title">Titre</FieldLabel>
          <Input
            id="default-seo-title"
            value={title}
            maxLength={MAX_SEO_TITLE_LENGTH}
            disabled={!canWrite}
            placeholder={siteName.trim() || "Nom du site"}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldDescription>
            Vide, une page sans titre SEO propre retombe sur le nom du site.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="default-seo-description">Description</FieldLabel>
          <Textarea
            id="default-seo-description"
            value={description}
            maxLength={MAX_SEO_DESCRIPTION_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="default-seo-canonical">URL canonique</FieldLabel>
          <Input
            id="default-seo-canonical"
            value={canonicalUrl}
            maxLength={MAX_CANONICAL_URL_LENGTH}
            disabled={!canWrite}
            placeholder="https://…"
            onChange={(event) => setCanonicalUrl(event.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="default-seo-noindex"
            checked={noindex}
            disabled={!canWrite}
            onCheckedChange={(checked) => setNoindex(checked === true)}
          />
          <FieldLabel htmlFor="default-seo-noindex">
            Exclure des moteurs de recherche (noindex)
          </FieldLabel>
        </Field>
        <FieldDescription>
          Activé ici, c'est le site entier qui sort de l'index — à réserver à
          une mise en ligne qui n'est pas encore publique.
        </FieldDescription>
      </SettingsGroup>
    </SettingsFormShell>
  )
}
