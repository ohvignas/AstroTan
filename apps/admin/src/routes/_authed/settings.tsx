import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ConvexError } from "convex/values"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
// From `convex/content.ts`, never from `convex/settings.ts`: `content` is a
// pure module (one `convex/values` import, no function definitions), while
// `settings` reaches `_generated/server`, `_registry` and `lib/authz` →
// `auth.ts`. Importing the latter from a route drags the server into the
// browser bundle, which the Convex client reports once per function it
// finds — "Convex functions should not be imported in the browser. This
// will throw an error in future versions of `convex`." `settings.ts`
// re-exports these four, so nothing on the server side had to move with
// them.
import {
  MAX_CANONICAL_URL_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SITE_NAME_LENGTH,
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
} from "@astrotan/backend/convex/content"
import defaultIcon from "@/assets/icon_astrotan.png"
import defaultLogo from "@/assets/logo_astrotan.png"
import { MediaPicker } from "@/components/media-picker"
import { RepeatableItems } from "@/components/repeatable-items"
import { SaveBar, useAutoSave } from "@/components/save-bar"
import {
  AiSection,
  DomainSection,
  EmailsSection,
  MeasurementSection,
} from "@/components/settings-environment"
import {
  SettingsNav,
  SettingsSection,
  useCurrentSection,
} from "@/components/settings-nav"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ImageIcon } from "lucide-react"

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type Environment = FunctionReturnType<typeof api.settings.environment>
type PageRow = FunctionReturnType<typeof api.pages.list>[number]
type Social = { label: string; url: string }

// The `<Select>` value that means "no home page". A stored slug can never
// collide with it: `normalizeSlug` strips leading and trailing slashes, so
// `"/"` normalises to the empty string and `pages.create`/`update` refuse
// that with `INVALID_SLUG`. A sentinel like `"__none__"` would *not* have
// been safe — a page slug preserves whatever the operator typed.
const NO_HOME_PAGE = "/"

// Every code `api.settings.update`/`setHomePage` can throw, mapped to
// operator-facing French — same shape as `lib/pageErrors.ts` and
// `lib/media.ts`, kept local to this file rather than promoted to `lib/`
// because those two live there for a stated reason this one does not
// share: they are each read by two screens that call the same mutations,
// and two copies of the dictionary would drift. Settings has exactly one
// screen.
const SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : les réglages du site sont réservés au propriétaire et aux administrateurs.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND: "Introuvable — a peut-être déjà été modifié ailleurs.",
  INVALID_SITE_NAME: "Le nom du site ne peut pas être vide.",
}

function describeSettingsError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const payload = data as Record<string, unknown>
      const code = payload.code
      // `FIELD_TOO_LONG`/`FIELD_TOO_MANY` carry which field tripped and
      // what the limit is; a generic "trop long" would leave an operator
      // guessing which of a dozen inputs on this screen it meant.
      if (code === "FIELD_TOO_LONG") {
        const field = typeof payload.field === "string" ? payload.field : "Un champ"
        const max =
          typeof payload.max === "number"
            ? ` (maximum ${payload.max} caractères)`
            : ""
        return `${field} dépasse la limite autorisée${max}.`
      }
      if (code === "FIELD_TOO_MANY") {
        const field = typeof payload.field === "string" ? payload.field : "Une liste"
        const max =
          typeof payload.max === "number" ? ` (maximum ${payload.max})` : ""
        return `${field} contient trop d'éléments${max}.`
      }
      // The one refusal an operator can actually cause here by racing
      // themselves: choosing a page in this list that another session
      // renamed or deleted in between.
      if (code === "UNKNOWN_PAGE") {
        const slug = typeof payload.slug === "string" ? ` « ${payload.slug} »` : ""
        return `Aucune page ne porte le slug${slug} — elle a peut-être été renommée ou supprimée. Rechargez la liste.`
      }
      if (typeof code === "string" && SETTINGS_ERROR_MESSAGES[code]) {
        return SETTINGS_ERROR_MESSAGES[code]
      }
    }
  }
  return "Une erreur inattendue est survenue."
}

function SettingsPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as `routes/_authed/pages/index.tsx`.
  const profile = useQuery(api.profiles.me)
  // `null` is an ordinary answer, never an error: a freshly cloned
  // template has never been configured, and the first save creates the row
  // (`settings.update` upserts). Only `undefined` means "still loading".
  // `getPrivate` et non `get` : `get` est la projection publique, appelable
  // sans session par n'importe qui, et elle ne porte donc aucun secret. Le
  // dashboard, lui, a une session et a besoin de la ligne entière.
  const settings = useQuery(api.settings.getPrivate)
  const pages = useQuery(api.pages.list)
  // L'état des variables d'environnement — des booléens, jamais des
  // valeurs. Les quatre dernières sections de l'écran décrivent ce que
  // `convex env set` a reçu ; sans cette query elles n'auraient rien à
  // dire, et une clé posée ou non se vérifierait dans un terminal.
  const environment = useQuery(api.settings.environment)

  if (
    profile === undefined ||
    settings === undefined ||
    pages === undefined ||
    environment === undefined
  ) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // `settings.update` and `settings.setHomePage` both call
  // `requireRole(["owner", "admin"])` and refuse an editor regardless of
  // this flag. It only decides what renders — an editor gets the values
  // read-only and a sentence saying why, rather than a form whose every
  // control comes back refused.
  const canWrite = profile.role === "owner" || profile.role === "admin"

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Réglages</h1>
        <p className="text-sm text-muted-foreground">
          Ce qui appartient au site entier plutôt qu'à une page. Les
          quatre premières sections s'enregistrent ici ; les quatre
          dernières décrivent l'environnement du déploiement, qui se règle
          en ligne de commande.
        </p>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Ces réglages s'appliquent à toutes les pages à la fois : seuls le
          propriétaire et les administrateurs peuvent les modifier. Vous
          pouvez les consulter.
        </p>
      )}

      {/* Seeded from `settings` exactly once, on its first render — the
          same convention as the page editor. `api.settings.getPrivate` is a live
          subscription, so re-seeding on every update (a concurrent
          administrator, or this screen's own save resolving) would wipe
          whatever is being typed. */}
      <SettingsForm
        settings={settings}
        pages={pages}
        environment={environment}
        canWrite={canWrite}
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Page d'accueil
//
// Its own mutation, applied the moment the choice is made rather than
// waiting on the form's "Enregistrer": it is a single decision with a
// single value, and `settings.setHomePage` is a separate mutation
// precisely because pointing `/` somewhere is not the same act as editing
// the site's metadata. The `<Select>` reads straight from the live query
// rather than from local state, so a refused call leaves it showing what
// is actually stored.
//
// Plus de carte à elle, en revanche : elle vit désormais DANS la section
// « Site », et la barre de sauvegarde ne la concerne toujours pas. Un
// champ qui s'enregistre au choix, à côté de champs qui attendent la
// barre, demande de le dire — c'est ce que fait sa description.
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

  // Passed as `items` to `<Select>` so `<SelectValue>` renders the page's
  // title instead of the raw slug — Base UI's `Select.Value`, unlike
  // Radix's, only tracks a selected item's label when the root is given
  // `items` (see `routes/_authed/users.tsx`).
  const items: Record<string, string> = {
    [NO_HOME_PAGE]: "Aucune",
    ...Object.fromEntries(
      pages.map((page) => [page.slug, `${page.title} — /${page.slug}`])
    ),
  }

  // A slug can point at nothing if the row was written before the page was
  // deleted. Surfaced rather than silently coerced to "Aucune": `/` is
  // answering 404 right now and the screen would otherwise show no sign of
  // it.
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
                : canWrite
                  ? "Enregistré dès le choix, sans passer par la barre en bas d'écran — c'est une autre mutation."
                  : ""}
        </FieldDescription>
      </Field>
    </>
  )
}

// ---------------------------------------------------------------------
// Les huit sections, et l'unique état qui les traverse
//
// One form and one "Enregistrer" for the lot, because they are one
// mutation: `settings.update` patches whatever it is given, and splitting
// them into a button per section would be autant d'allers-retours pour
// écrire une seule ligne — et autant de barres collées en bas de l'écran,
// qui ne sauraient plus laquelle parle.
//
// Le découpage en sections est donc une affaire de MISE EN PAGE, pas de
// modèle : les champs restent un seul état local, une seule photo `auto`,
// une seule photo `manual`, une seule barre. C'est aussi ce qui fait
// qu'une modification dans « SEO par défaut » et une autre dans
// « Réseaux sociaux » partent ensemble, au lieu de se marcher dessus.
// ---------------------------------------------------------------------

function SettingsForm({
  settings,
  pages,
  environment,
  canWrite,
}: {
  settings: Settings
  pages: PageRow[]
  environment: Environment
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)

  const [siteName, setSiteName] = useState(settings?.siteName ?? "")
  const [webhookUrl, setWebhookUrl] = useState(settings?.leadWebhookUrl ?? "")
  const [webhookSecret, setWebhookSecret] = useState(settings?.leadWebhookSecret ?? "")
  const [iconId, setIconId] = useState<Id<"_storage"> | null>(
    settings?.iconId ?? null,
  )
  const [logoId, setLogoId] = useState<Id<"_storage"> | null>(
    settings?.logoId ?? null
  )
  const [socials, setSocials] = useState<Social[]>(settings?.socials ?? [])
  const [seoTitle, setSeoTitle] = useState(settings?.defaultSeo?.title ?? "")
  const [seoDescription, setSeoDescription] = useState(
    settings?.defaultSeo?.description ?? ""
  )
  const [seoCanonicalUrl, setSeoCanonicalUrl] = useState(
    settings?.defaultSeo?.canonicalUrl ?? ""
  )
  const [seoNoindex, setSeoNoindex] = useState(
    settings?.defaultSeo?.noindex ?? false
  )

  const trimmedSiteName = siteName.trim()

  // Ce que la sauvegarde automatique a le droit de réécrire : des valeurs
  // qui ne touchent que cette ligne.
  const autoFields = {
    siteName,
    // `undefined` means "leave alone" to `settings.update`, so a logo
    // is only ever written, never unset from here.
    ...(logoId === null ? {} : { logoId }),
    ...(iconId === null ? {} : { iconId }),
    // Rows an operator started and left half-filled are dropped rather
    // than sent: a social link with no URL would render in the footer
    // as a link to nowhere.
    socials: socials.filter(
      (social) => social.label.trim() !== "" && social.url.trim() !== ""
    ),
    defaultSeo: {
      title: seoTitle.trim() || undefined,
      description: seoDescription.trim() || undefined,
      canonicalUrl: seoCanonicalUrl.trim() || undefined,
      noindex: seoNoindex,
      // Carried through untouched. `settings.update` replaces
      // `defaultSeo` whole, and this screen has no control for the
      // default OG image — omitting it here would delete it on every
      // save.
      ...(settings?.defaultSeo?.ogImageId === undefined
        ? {}
        : { ogImageId: settings.defaultSeo.ogImageId }),
    },
  }

  // Le webhook est à cet écran ce que le slug est à l'éditeur de pages :
  // un champ dont l'écriture a un effet au-delà de sa propre ligne, donc
  // jamais automatique.
  //
  // Deux raisons, pas une. `settings.update` frappe un secret HMAC
  // aléatoire dès qu'une URL est posée sans secret — une frappe par
  // caractère en poserait un par valeur intermédiaire. Et surtout,
  // `https://exemple.co` est une URL parfaitement valide en route vers
  // `https://exemple.com` : enregistrée ne serait-ce qu'une seconde, tout
  // lead reçu pendant cette seconde part chez l'hôte de passage. Ceci
  // attend le clic.
  //
  // Chaîne vide = « débrancher » : `null` efface le réglage côté serveur,
  // là où `undefined` le laisserait tel quel. Sans cette distinction, un
  // webhook posé une fois ne pourrait plus être retiré.
  const manualFields = {
    leadWebhookUrl: webhookUrl.trim() === "" ? null : webhookUrl.trim(),
    leadWebhookSecret:
      webhookSecret.trim() === "" ? null : webhookSecret.trim(),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: autoFields,
    manual: manualFields,
    saveAuto: async (auto) => {
      await updateSettings(auto)
    },
    saveAll: async ({ auto, manual }) => {
      await updateSettings({ ...auto, ...manual })
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

  // Le menu suit le défilement. Le hook est appelé ici et non dans
  // `SettingsNav` : il observe les `<section>` rendues juste en dessous,
  // et un composant qui se dit lui-même quelle ancre est courante serait
  // un composant qui dépend de ce qui l'entoure sans le déclarer.
  const current = useCurrentSection()

  return (
    <>
      {/* Deux colonnes à partir de `lg`, une seule en dessous — où le
          menu redevient une bande de pastilles horizontale (voir
          `SettingsNav`). `items-start` est ce qui permet au menu de
          rester collé pendant que la colonne de droite défile : étiré sur
          toute la hauteur, `position: sticky` n'a plus de course. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <SettingsNav current={current} />

        {/* `min-w-0` : sans lui, un bloc de commande large (les `<pre>`
            des sections d'environnement) impose sa largeur à la colonne
            flex et pousse le menu hors de l'écran. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SettingsSection id="site">
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

            <HomePageField
              homePageSlug={settings?.homePageSlug ?? null}
              pages={pages}
              canWrite={canWrite}
            />
          </SettingsSection>

          <SettingsSection id="seo">
            <Field>
              <FieldLabel htmlFor="default-seo-title">Titre SEO</FieldLabel>
              <Input
                id="default-seo-title"
                value={seoTitle}
                maxLength={MAX_SEO_TITLE_LENGTH}
                disabled={!canWrite}
                placeholder={trimmedSiteName || "Nom du site"}
                onChange={(event) => setSeoTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="default-seo-description">
                Description
              </FieldLabel>
              <Textarea
                id="default-seo-description"
                value={seoDescription}
                maxLength={MAX_SEO_DESCRIPTION_LENGTH}
                disabled={!canWrite}
                onChange={(event) => setSeoDescription(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="default-seo-canonical">
                URL canonique
              </FieldLabel>
              <Input
                id="default-seo-canonical"
                value={seoCanonicalUrl}
                maxLength={MAX_CANONICAL_URL_LENGTH}
                disabled={!canWrite}
                placeholder="https://…"
                onChange={(event) => setSeoCanonicalUrl(event.target.value)}
              />
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="default-seo-noindex"
                checked={seoNoindex}
                disabled={!canWrite}
                onCheckedChange={(checked) => setSeoNoindex(checked === true)}
              />
              <FieldLabel htmlFor="default-seo-noindex">
                Exclure des moteurs de recherche (noindex)
              </FieldLabel>
            </Field>
            <FieldDescription>
              Activé ici, c'est le site entier qui sort de l'index — à réserver
              à une mise en ligne qui n'est pas encore publique.
            </FieldDescription>
          </SettingsSection>

          <SettingsSection id="reseaux">
            <FieldDescription>
              {MAX_SOCIALS} liens au maximum.
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
          </SettingsSection>

          <SettingsSection id="leads">
            <Field>
              <FieldLabel htmlFor="webhook-url">Adresse du webhook</FieldLabel>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://hook.eu2.make.com/…"
                value={webhookUrl}
                disabled={!canWrite}
                onChange={(event) => setWebhookUrl(event.target.value)}
              />
              <FieldDescription>
                En `https` uniquement, et jamais une adresse interne : un champ
                d'URL qui déclenche un appel sortant est refusé sur
                `localhost`, les plages privées et l'adresse de métadonnées de
                l'hébergeur. Vider le champ débranche le webhook.{" "}
                <strong>
                  Ce champ n'est jamais enregistré automatiquement : il
                  attend le bouton.
                </strong>{" "}
                `https://exemple.co` est une adresse valide en route vers
                `https://exemple.com`, et sauvegardée une seconde elle
                enverrait à un inconnu les leads reçus pendant cette
                seconde.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="webhook-secret">Secret de signature</FieldLabel>
              <Input
                id="webhook-secret"
                type="text"
                placeholder="une longue chaîne aléatoire"
                value={webhookSecret}
                disabled={!canWrite}
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
              <FieldDescription>
                Chaque envoi porte un en-tête `x-astrotan-signature`,
                HMAC-SHA256 du corps avec ce secret. Il permet à votre scénario
                de vérifier que l'appel vient bien de vous — une URL de webhook
                traverse des journaux et des captures d'écran, elle n'est pas
                un secret.
              </FieldDescription>
            </Field>

            {settings?.leadWebhookLastStatus && (
              <p className="text-sm text-muted-foreground">
                {/* L'état du dernier envoi, visible ici plutôt que dans des
                    journaux : un webhook muet depuis trois semaines est le
                    défaut le plus courant de ce genre d'intégration. */}
                Dernier envoi : {settings.leadWebhookLastStatus}
                {settings.leadWebhookLastAt &&
                  ` — ${new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(settings.leadWebhookLastAt))}`}
              </p>
            )}
          </SettingsSection>

          {/* Les quatre dernières sections ne portent aucun champ : elles
              décrivent l'environnement du déploiement. Voir l'en-tête de
              `settings-environment.tsx` pour ce qui interdit à chacune
              d'être un formulaire. */}
          <AiSection configured={environment.openRouter.configured} />
          <EmailsSection resend={environment.resend} adminUrl={environment.adminUrl} />
          <DomainSection adminUrl={environment.adminUrl} webUrl={environment.webUrl} />
          <MeasurementSection umamiApi={environment.umamiApi} />
        </div>
      </div>

      {/* La barre reste hors des deux colonnes, enfant direct du
          conteneur de la page : ses marges négatives (`-mx-4`) sont
          calculées contre le `p-4` d'`AppShell`, et l'imbriquer dans la
          colonne de droite la rétrécirait à sa largeur.

          Ni barre ni sauvegarde automatique pour un editor : la mutation
          refuse de toute façon (`requireRole(["owner","admin"])`). */}
      {canWrite && (
        <SaveBar
          status={autoSave.status}
          lastSavedAt={autoSave.lastSavedAt}
          error={autoSave.error}
          canSave={autoSave.canSave && trimmedSiteName.length > 0}
          onSave={autoSave.saveNow}
        />
      )}
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
  // `api.media.list` rather than a lookup by storage id: only the list
  // resolves a storage URL server-side, and a thumbnail without one is
  // just a filename. Subscribed only while a logo is actually set — same
  // reasoning as the post editor's cover field.
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <div className="flex items-center gap-3">
          {/* Montrer le fichier du dépôt, et pas seulement écrire « aucun » :
              il y a bien une image en ligne sur le site, et un écran qui
              l'ignore laisse croire à un réglage cassé. */}
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
              {/* A `storageId` can exist with no `media` row — a file
                  uploaded outside the library. `media.ts` calls that an
                  ordinary answer, not a failure. */}
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
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            {value === null ? `Choisir un${noun === "icône" ? "e" : ""} ${noun}` : `Changer d${noun === "icône" ? "\u2019" : "e "}${noun}`}
          </Button>
        </div>
      )}
      {/* No "remove the logo" control, and the omission is deliberate
          rather than an oversight: `settings.update` declares `logoId` as
          `v.optional(v.id("_storage"))`, and Convex drops `undefined`
          argument fields on the wire, so there is no value this screen can
          send that means "unset it". A button that silently did nothing
          would be worse than its absence. Clearing needs the mutation to
          accept `v.null()` the way `setHomePage` already does. */}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Logo du site"
        description="Repris sur chaque page du site public."
      />
    </div>
  )
}
