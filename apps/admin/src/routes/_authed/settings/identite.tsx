import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
// Depuis `convex/content.ts`, jamais depuis `convex/settings.ts` :
// `content` est un module pur, là où `settings` atteint
// `_generated/server`, `_registry` et `lib/authz` → `auth.ts`. Importer le
// second depuis une route traîne le serveur dans le bundle du navigateur,
// ce que le client Convex signale une fois par fonction trouvée.
import { MAX_SITE_NAME_LENGTH } from "@astrotan/backend/convex/content"
import { describeSettingsError } from "@/lib/settingsErrors"
import defaultIcon from "@/assets/icon_astrotan.png"
import defaultLogo from "@/assets/logo_astrotan.png"
import { MediaPicker } from "@/components/media-picker"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ImageIcon } from "lucide-react"

export const Route = createFileRoute("/_authed/settings/identite")({
  component: IdentiteRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type PageRow = FunctionReturnType<typeof api.pages.list>[number]

// La valeur de `<Select>` qui veut dire « aucune page d'accueil ». Un slug
// stocké ne peut jamais entrer en collision avec elle : `normalizeSlug`
// retire les barres de tête et de queue, donc `"/"` se normalise en chaîne
// vide, que `pages.create`/`update` refusent avec `INVALID_SLUG`. Une
// sentinelle du genre `"__none__"` n'aurait PAS été sûre — un slug de page
// conserve ce que l'opérateur a tapé.
const NO_HOME_PAGE = "/"

function IdentiteRoute() {
  const { loading, canWrite } = useSettingsAccess()
  // `null` est une réponse ordinaire, jamais une erreur : un template
  // fraîchement cloné n'a jamais été configuré, et le premier
  // enregistrement crée la ligne (`settings.update` fait un upsert). Seul
  // `undefined` veut dire « en cours de chargement ».
  //
  // `getPrivate` et non `get` : `get` est la projection publique,
  // appelable sans session par n'importe qui, et elle ne porte donc aucun
  // secret. Le dashboard, lui, a une session.
  const settings = useQuery(api.settings.getPrivate)
  const pages = useQuery(api.pages.list)

  if (loading || settings === undefined || pages === undefined) {
    return <SettingsLoading />
  }
  // Semé depuis `settings` une seule fois, au premier rendu — même
  // convention que l'éditeur de pages. `getPrivate` est un abonnement
  // vivant : re-semer à chaque notification effacerait ce qui est en train
  // d'être saisi.
  return <IdentiteForm settings={settings} pages={pages} canWrite={canWrite} />
}

function IdentiteForm({
  settings,
  pages,
  canWrite,
}: {
  settings: Settings
  pages: PageRow[]
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [siteName, setSiteName] = useState(settings?.siteName ?? "")
  const [logoId, setLogoId] = useState<Id<"_storage"> | null>(
    settings?.logoId ?? null
  )
  const [iconId, setIconId] = useState<Id<"_storage"> | null>(
    settings?.iconId ?? null
  )

  const trimmedSiteName = siteName.trim()

  const autoFields = {
    siteName,
    // `undefined` veut dire « laisse tel quel » pour `settings.update` :
    // un logo n'est donc jamais retiré depuis cet écran, seulement écrit.
    ...(logoId === null ? {} : { logoId }),
    ...(iconId === null ? {} : { iconId }),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: autoFields,
    // Rien à effet de bord sur cette page : aucun de ces trois champs
    // n'écrit ailleurs que dans sa propre ligne.
    manual: {},
    saveAuto: async (auto) => {
      await updateSettings(auto)
    },
    saveAll: async ({ auto }) => {
      await updateSettings(auto)
    },
    // `settings.update` refuse un nom de site vide (`INVALID_SITE_NAME`).
    // L'envoyer quand même ferait échouer la sauvegarde automatique à
    // chaque pause de frappe, le temps que le champ soit vidé puis
    // réécrit.
    validate: ({ auto }) =>
      auto.siteName.trim().length === 0
        ? "Le nom du site ne peut pas être vide."
        : null,
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/identite"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Le nom ou les images du site"
      blocked={trimmedSiteName.length === 0}
    >
      <SettingsGroup title="Nom et images">
        <Field data-invalid={canWrite && trimmedSiteName.length === 0}>
          <FieldLabel htmlFor="site-name">Nom du site</FieldLabel>
          <Input
            id="site-name"
            autoComplete="off"
            value={siteName}
            maxLength={MAX_SITE_NAME_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setSiteName(event.target.value)}
          />
          {canWrite && trimmedSiteName.length === 0 ? (
            <FieldError>
              Le nom du site ne peut pas être vide — le serveur refuse
              l'enregistrement.
            </FieldError>
          ) : (
            <FieldDescription>
              {trimmedSiteName.length}/{MAX_SITE_NAME_LENGTH}
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel>Logo</FieldLabel>
          <FieldDescription>
            Large, avec le nom écrit. C'est lui dans la barre de menu du
            site.
          </FieldDescription>
          <ImageField
            value={logoId}
            disabled={!canWrite}
            onChange={setLogoId}
            noun="logo"
          />
        </Field>

        <Field>
          <FieldLabel>Icône</FieldLabel>
          <FieldDescription>
            Carrée. Elle sert de favicon, dans l'onglet du navigateur et
            partout où la place est contrainte — un logo large y serait
            illisible.
          </FieldDescription>
          <ImageField
            value={iconId}
            disabled={!canWrite}
            onChange={setIconId}
            noun="icône"
          />
        </Field>
      </SettingsGroup>

      <SettingsGroup
        title="Page d'accueil"
        description="Enregistrée dès le choix, sans passer par la barre en bas d'écran : c'est une autre mutation, et pointer la racine du site n'est pas le même acte que renommer le site."
      >
        <HomePageField
          homePageSlug={settings?.homePageSlug ?? null}
          pages={pages}
          canWrite={canWrite}
        />
      </SettingsGroup>
    </SettingsFormShell>
  )
}

// ---------------------------------------------------------------------
// Page d'accueil
//
// Sa propre mutation, appliquée au moment du choix plutôt qu'à
// « Enregistrer » : c'est une décision unique à valeur unique, et
// `settings.setHomePage` existe séparément précisément parce que pointer
// `/` quelque part n'est pas le même acte qu'éditer les métadonnées du
// site. Le `<Select>` lit directement la query vivante plutôt qu'un état
// local, si bien qu'un appel refusé le laisse afficher ce qui est
// réellement stocké.
// ---------------------------------------------------------------------

function HomePageField({
  homePageSlug,
  pages,
  canWrite,
}: {
  homePageSlug: string | null
  pages: PageRow[]
  canWrite: boolean
}) {
  const setHomePage = useMutation(api.settings.setHomePage)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Passé en `items` au `<Select>` pour que `<SelectValue>` affiche le
  // titre de la page et non son slug brut — le `Select.Value` de Base UI,
  // contrairement à celui de Radix, ne suit l'étiquette d'un élément
  // sélectionné que si la racine reçoit `items` (voir `users.tsx`).
  const items: Record<string, string> = {
    [NO_HOME_PAGE]: "Aucune",
    ...Object.fromEntries(
      pages.map((page) => [page.slug, `${page.title} — /${page.slug}`])
    ),
  }

  // Un slug peut ne pointer sur rien si la ligne a été écrite avant que la
  // page ne soit supprimée. Signalé plutôt que ramené en silence à
  // « Aucune » : `/` répond 404 en ce moment même, et l'écran n'en
  // montrerait autrement aucun signe.
  const danglingSlug =
    homePageSlug !== null && !pages.some((page) => page.slug === homePageSlug)
      ? homePageSlug
      : null
  if (danglingSlug !== null) {
    items[danglingSlug] = `${danglingSlug} — page introuvable`
  }

  const selected = pages.find((page) => page.slug === homePageSlug) ?? null

  async function handleChange(value: string) {
    setError(null)
    setPending(true)
    try {
      await setHomePage({ slug: value === NO_HOME_PAGE ? null : value })
    } catch (err) {
      setError(describeSettingsError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="home-page">Page servie à la racine (/)</FieldLabel>
        <Select
          items={items}
          value={homePageSlug ?? NO_HOME_PAGE}
          disabled={!canWrite || pending}
          onValueChange={(value) => handleChange(value as string)}
        >
          <SelectTrigger id="home-page" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_HOME_PAGE}>Aucune</SelectItem>
            {danglingSlug !== null && (
              <SelectItem value={danglingSlug}>
                {danglingSlug} — page introuvable
              </SelectItem>
            )}
            {pages.map((page) => (
              <SelectItem key={page._id} value={page.slug}>
                {page.title} — /{page.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {danglingSlug !== null
            ? `Aucune page ne porte le slug « ${danglingSlug} » : la racine du site répond 404. Choisissez-en une autre.`
            : selected === null
              ? "Aucune page d'accueil : la racine du site répond 404."
              : selected.status !== "published"
                ? "Cette page est encore un brouillon : la racine répondra 404 tant qu'elle n'est pas publiée."
                : ""}
        </FieldDescription>
      </Field>
    </>
  )
}

function ImageField({
  value,
  disabled,
  onChange,
  noun,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage">) => void
  /** « logo » ou « icône » — au singulier, sans article. */
  noun: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // `api.media.list` plutôt qu'une recherche par identifiant de stockage :
  // seule la liste résout une URL côté serveur, et une vignette sans URL
  // n'est qu'un nom de fichier. Souscrite seulement quand une image est
  // réellement posée — même raisonnement que le champ de couverture de
  // l'éditeur d'articles.
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <div className="flex items-center gap-3">
          {/* Montrer le fichier du dépôt, et pas seulement écrire
              « aucun » : il y a bien une image en ligne sur le site, et un
              écran qui l'ignore laisse croire à un réglage cassé. */}
          <img
            src={noun === "icône" ? defaultIcon : defaultLogo}
            alt=""
            className="h-10 w-auto max-w-32 rounded border border-border bg-muted object-contain p-1"
          />
          <p className="text-sm text-muted-foreground">
            Aucun{noun === "icône" ? "e" : ""} {noun} téléversé
            {noun === "icône" ? "e" : ""} — le fichier du dépôt est utilisé.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
            {selected?.url ? (
              <img
                src={selected.url}
                alt={selected.alt}
                className="size-full object-contain"
              />
            ) : (
              <ImageIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">
              {selected?.filename ?? "Fichier hors médiathèque"}
            </p>
            <p className="truncate text-muted-foreground">
              {/* Un `storageId` peut exister sans ligne `media` — un
                  fichier téléversé hors de la médiathèque. `media.ts`
                  appelle cela une réponse ordinaire, pas un échec. */}
              {selected?.alt ?? "Texte alternatif inconnu"}
            </p>
          </div>
        </div>
      )}
      {!disabled && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            {value === null
              ? `Choisir un${noun === "icône" ? "e" : ""} ${noun}`
              : `Changer d${noun === "icône" ? "’" : "e "}${noun}`}
          </Button>
        </div>
      )}
      {/* Pas de bouton « retirer », et l'omission est délibérée :
          `settings.update` déclare `logoId` en `v.optional(v.id(...))`, et
          Convex retire les champs `undefined` sur le fil — il n'existe
          donc aucune valeur que cet écran puisse envoyer pour dire
          « efface-le ». Un bouton qui ne ferait rien en silence serait
          pire que son absence. */}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title={noun === "icône" ? "Icône du site" : "Logo du site"}
        description="Repris sur chaque page du site public."
      />
    </div>
  )
}
