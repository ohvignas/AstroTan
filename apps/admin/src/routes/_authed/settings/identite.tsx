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

  // `null` est envoyé, et c'est le point : `settings.update` déclare ces
  // deux champs en `v.union(v.id("_storage"), v.null())` et traduit `null`
  // en `undefined` juste avant le patch, où il efface bien le champ. Les
  // omettre — ce que cet écran faisait — rendait le bouton « Retirer »
  // impossible, faute de valeur transmissible pour dire « efface-le ».
  //
  // Sans danger au montage : `useAutoSave` sème sa référence au premier
  // rendu et ne déclenche rien tant que la photo n'a pas changé, donc un
  // `logoId: null` déjà nul n'écrit jamais.
  const autoFields = { siteName, logoId, iconId }

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
          <ImageField
            value={logoId}
            disabled={!canWrite}
            onChange={setLogoId}
            onClear={() => setLogoId(null)}
            noun="logo"
          />
        </Field>

        <Field>
          <FieldLabel>Icône</FieldLabel>
          <ImageField
            value={iconId}
            disabled={!canWrite}
            onChange={setIconId}
            onClear={() => setIconId(null)}
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
  onClear,
  noun,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage">) => void
  onClear: () => void
  /** « logo » ou « icône » — au singulier, sans article. */
  noun: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const feminin = noun === "icône"
  // Deux sources, et il en fallait deux — c'est la cause exacte du logo qui
  // ne s'affichait pas.
  //
  // `media.list` donne le nom du fichier et son texte alternatif, mais
  // seulement pour les fichiers INSCRITS dans la médiathèque. Or
  // `settings.logoId` désigne un `_storage`, pas une ligne `media` : les
  // deux peuvent diverger, et sur ce déploiement ils ont divergé — le média
  // servant de logo a été supprimé à une époque où `media.remove` ne
  // vérifiait pas encore les réglages (corrigé depuis, `isReferenced`).
  // `settings.logoId` pointait donc sur un fichier disparu ; `list` ne le
  // trouvait pas, l'écran tombait sur son gabarit gris, et rien ne disait
  // pourquoi.
  //
  // `media.publicUrl` répond à la question que `list` ne pose pas : ce
  // `storageId` désigne-t-il encore un fichier ? Elle rend une URL, ou
  // `null` — et `null` est le seul signal fiable de « ce fichier n'existe
  // plus ». C'est le chemin qu'`apps/web` emprunte déjà pour afficher le
  // logo sur chaque page (`layout/Header.astro`).
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const url = useQuery(
    api.media.publicUrl,
    value === null ? "skip" : { storageId: value }
  )
  const selected = media?.find((item) => item.storageId === value) ?? null
  // `undefined` = en cours de chargement ; `null` = le fichier a disparu.
  // Confondre les deux ferait clignoter le message d'erreur à chaque
  // ouverture de la page.
  const introuvable = value !== null && url === null

  return (
    <div className="flex flex-col gap-3">
      {value === null || introuvable ? (
        <div className="flex items-center gap-3">
          {/* Une seule branche pour « aucun réglage » et « la référence a
              disparu » : depuis que les deux messages ont été retirés, elles
              rendaient exactement la même chose. Dans les deux cas le site
              sert le fichier du dépôt, et montrer ce fichier — plutôt que
              d'écrire « aucun » — évite de laisser croire qu'il n'y a plus
              d'image en ligne.

              Ce que l'écran ne distingue plus : un fichier supprimé du
              stockage ressemble maintenant à un réglage jamais posé. */}
          <img
            src={feminin ? defaultIcon : defaultLogo}
            alt=""
            className="h-10 w-auto max-w-32 rounded border border-border bg-muted object-contain p-1"
          />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
            {url ? (
              <img
                src={url}
                alt={selected?.alt ?? ""}
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
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            {value === null
              ? `Choisir un${feminin ? "e" : ""} ${noun}`
              : `Changer d${feminin ? "’" : "e "}${noun}`}
          </Button>
          {/* Le bouton manquait, et son absence était justifiée par un
              commentaire faux : `settings.update` déclare bien
              `logoId: v.optional(v.union(v.id("_storage"), v.null()))` et
              traduit `null` en effacement. C'est le formulaire qui ne
              transmettait jamais `null`. Il le fait maintenant — et sans
              cela, une référence cassée n'avait aucune sortie. */}
          {value !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={onClear}
            >
              Retirer
            </Button>
          )}
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title={feminin ? "Icône du site" : "Logo du site"}
        description="Repris sur chaque page du site public."
      />
    </div>
  )
}
