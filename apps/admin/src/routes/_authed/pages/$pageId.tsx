import { useState } from "react"
import type { ReactNode } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import { publicPath, publicUrl } from "@astrotan/backend/convex/lib/publicPath"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  MAX_CANONICAL_URL_LENGTH,
  MAX_GEO_ANSWER_LENGTH,
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
  MAX_GEO_QUESTION_LENGTH,
  MAX_GEO_SUMMARY_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "@astrotan/backend/convex/content"
import { describePageError } from "@/lib/pageErrors"
import { describeContentProblem, splitEntities } from "@/lib/contentGuards"
import { buildSeo } from "@/lib/buildSeo"
import type { SeoGeoDraft } from "@astrotan/backend/convex/lib/seoGeoDraft"
import { GenerateSeoGeoButton } from "@/components/generate-seo-geo-button"
import { OgImageField } from "@/components/OgImageField"
import { PageAnalytics } from "@/components/analytics-panel"
import { PublicationStatusBadge } from "@/components/PublicationStatusBadge"
// Lived in this file until the settings screen needed the same widget for
// its social links — see that component's header.
import { RepeatableItems } from "@/components/repeatable-items"
import { SaveBar, useAutoSave } from "@/components/save-bar"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeftIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react"

export const Route = createFileRoute("/_authed/pages/$pageId")({
  component: PageEditorPage,
})

type Profile = FunctionReturnType<typeof api.profiles.me>
type PageDoc = NonNullable<FunctionReturnType<typeof api.pages.get>>

function PageEditorPage() {
  const { pageId } = Route.useParams()
  const id = pageId as Id<"pages">
  // Already subscribed by `AppShell`.
  const profile = useQuery(api.profiles.me)
  const page = useQuery(api.pages.get, { id })

  if (profile === undefined || page === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  if (page === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Page introuvable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Link to="/pages" className="underline">
            Retour à la liste des pages
          </Link>
        </CardContent>
      </Card>
    )
  }

  // `key={page._id}` isn't needed here (the route only ever mounts one
  // page at a time), but the child's own local state (below) is seeded
  // exactly once from `page` on its first render — reactive updates to
  // `page` afterwards (a concurrent editor, or this screen's own `update`
  // call resolving) never blow away in-progress local edits.
  return <PageEditor page={page} profile={profile} />
}

function PageEditor({ page, profile }: { page: PageDoc; profile: Profile }) {
  const generateSeoGeo = useAction(api.ai.generateSeoGeo)
  const generatePageOg = useAction(api.aiImage.generatePageOg)
  const updatePage = useMutation(api.pages.update)
  const removePage = useMutation(api.pages.remove)
  const publishPage = useMutation(api.pages.publishPage)
  const unpublish = useMutation(api.pages.unpublish)
  const mintPreviewToken = useMutation(api.pages.mintPreviewToken)
  const retryPropagation = useMutation(api.pages.retryPropagation)
  const publicationStatus = useQuery(api.pages.publicationStatus, {
    id: page._id,
  })
  // Publique et sans session : `apps/web` la lit aussi pour savoir quelle
  // page rendre sur `/`.
  const homePageSlug = useQuery(api.settings.homePageSlug)

  const [title, setTitle] = useState(page.title)
  const [slug, setSlug] = useState(page.slug)
  const [seoTitle, setSeoTitle] = useState(page.seo?.title ?? "")
  const [seoDescription, setSeoDescription] = useState(
    page.seo?.description ?? ""
  )
  const [seoCanonicalUrl, setSeoCanonicalUrl] = useState(
    page.seo?.canonicalUrl ?? ""
  )
  const [seoNoindex, setSeoNoindex] = useState(page.seo?.noindex ?? false)
  const [seoOgImageId, setSeoOgImageId] = useState<Id<"_storage"> | null>(
    page.seo?.ogImageId ?? null
  )
  const [targetKeyword, setTargetKeyword] = useState(page.targetKeyword ?? "")

  const [geoSummary, setGeoSummary] = useState(page.geo?.summary ?? "")
  const [geoFaq, setGeoFaq] = useState<{ question: string; answer: string }[]>(
    page.geo?.faq ?? []
  )
  // Held as one comma-separated string rather than an array of inputs:
  // entities are short single words, and a row of add/remove buttons for
  // each would be more chrome than content.
  const [geoEntities, setGeoEntities] = useState(
    (page.geo?.entities ?? []).join(", ")
  )
  const [geoNoai, setGeoNoai] = useState(page.geo?.noai ?? false)

  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingCover, setGeneratingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // The property this whole screen must uphold, verbatim: "hiding a
  // button is a courtesy to the operator, never the enforcement." Every
  // flag below only controls what *renders* — `pages.update`/`remove`
  // (`requireOwnDocument`) and `pages.publishPage`/`unpublish`
  // (`requireRole(["owner","admin"])`) re-check the exact same boundary
  // themselves, unconditionally, on the server.
  const isOwn = page.createdBy === profile.authUserId
  // Closing-fixes review: `pages.update`/`pages.remove` now also refuse an
  // editor once the page is `published` (`requirePublishedPageWritable`,
  // `lib/authz.ts`) — this flag has to know that rule too, or an editor
  // opening their own published page sees an enabled form and only
  // discovers the refusal on save. The server enforcement is what's
  // correct either way; this is only the courtesy that used to mislead.
  const canWrite = profile.role !== "editor" || (isOwn && page.status !== "published")
  const canPublish = profile.role === "owner" || profile.role === "admin"
  const canRetryPropagation = canPublish || isOwn


  // Tout ce qui peut être réécrit sans effet de bord hors de cette ligne.
  // Le slug n'y est pas, et c'est le point entier de ce découpage :
  // `pages.update` frappe une 301 à chaque renommage
  // (`redirects.mintRenameRedirect`), donc une sauvegarde qui suivrait la
  // frappe laisserait derrière elle `/tar`, `/tari`, `/tarif`…
  const autoFields = {
    title,
    targetKeyword,
    seo: buildSeo({
      existing: page.seo,
      fields: {
        title: seoTitle,
        description: seoDescription,
        canonicalUrl: seoCanonicalUrl,
        noindex: seoNoindex,
        ogImageId: seoOgImageId,
      },
    }),
    geo: {
      summary: geoSummary.trim() || undefined,
      // Drop rows the operator started and left blank rather than
      // sending them: an empty Q/A pair would be emitted as FAQPage
      // JSON-LD with nothing in it.
      faq: geoFaq.filter(
        (item) => item.question.trim() !== "" && item.answer.trim() !== ""
      ),
      entities: splitEntities(geoEntities),
      noai: geoNoai,
    },
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: autoFields,
    manual: { slug },
    // `slug` absent de l'appel : `pages.update` déclare tous ses arguments
    // optionnels, et un argument omis laisse la valeur enregistrée telle
    // quelle. Aucune redirection n'est donc frappée par ce chemin.
    saveAuto: async (auto) => {
      await updatePage({ id: page._id, ...auto })
    },
    saveAll: async ({ auto, manual }) => {
      await updatePage({ id: page._id, slug: manual.slug, ...auto })
    },
    validate: ({ auto }) =>
      describeContentProblem({
        title: auto.title,
        entities: auto.geo.entities,
        faq: auto.geo.faq,
      }),
    describeError: describePageError,
  })

  async function handlePublishToggle() {
    setError(null)
    setBusy(true)
    try {
      if (page.status === "published") {
        await unpublish({ id: page._id })
      } else {
        await publishPage({ id: page._id })
      }
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePreview() {
    setError(null)
    setBusy(true)
    try {
      const { token } = await mintPreviewToken({ id: page._id })
      const base = import.meta.env.VITE_WEB_SITE_URL as string | undefined
      if (!base) {
        setError("VITE_WEB_SITE_URL n'est pas configuré côté admin.")
        return
      }
      // The page's own URL, not a parallel preview route: what is checked
      // before publishing is literally the page that will go live.
      //
      // `page.slug`, pas le `slug` en cours d'édition : le jeton est signé
      // pour la ligne ENREGISTRÉE, et une adresse construite sur un slug
      // non encore sauvegardé ouvrait une page qui n'existe pas, avec un
      // jeton qui ne correspond à rien.
      //
      // `publicUrl` et non une concaténation : la page d'accueil répond à
      // `/`, et `${base}/${page.slug}` ouvrait `/accueil?t=…`, une route
      // inexistante — l'aperçu montrait une 404 au lieu de la page qu'on
      // s'apprêtait à publier. Voir `convex/lib/publicPath.ts`, qui porte
      // l'exception et son test.
      const url = `${publicUrl(base, page.slug, homePageSlug)}?t=${encodeURIComponent(token)}`
      setPreviewUrl(url)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setBusy(false)
    }
  }

  function applyDraft(draft: SeoGeoDraft) {
    setSeoTitle(draft.seo.title)
    setSeoDescription(draft.seo.description)
    setGeoSummary(draft.geo.summary)
    setGeoFaq(draft.geo.faq)
    setGeoEntities(draft.geo.entities.join(", "))
    setGeoNoai(draft.geo.noai)
  }

  async function handleGenerate(extraInstructions?: string) {
    setError(null)
    setGenerating(true)
    try {
      applyDraft(await generateSeoGeo({ pageId: page._id, extraInstructions }))
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateCover(extraInstructions?: string) {
    setError(null)
    setGeneratingCover(true)
    try {
      const result = await generatePageOg({
        pageId: page._id,
        extraInstructions,
      })
      setSeoOgImageId(result.storageId)
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setGeneratingCover(false)
    }
  }

  const generateButton = (
    <GenerateSeoGeoButton
      disabled={!canWrite}
      busy={generating}
      onGenerate={(extra) => void handleGenerate(extra)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/pages" />}
            nativeButton={false}
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-lg font-medium">{page.title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {/* Le chemin RÉELLEMENT servi, jamais `/{slug}` : l'accueil
                  répond à `/` et non à `/accueil`, et cet en-tête affichait
                  donc une adresse qui rend 404 pour la page la plus visitée
                  du site. Même exception que `PageAnalytics` plus bas et que
                  `pages.list`. Rien tant que les réglages ne sont pas là :
                  `publicPath` répond « ce n'est pas l'accueil » sur
                  `undefined`, ce qui rouvrirait le défaut le temps du
                  chargement. */}
              {homePageSlug !== undefined && (
                <span>{publicPath(page.slug, homePageSlug)}</span>
              )}
              <PublicationStatusBadge
                status={publicationStatus}
                pageStatus={page.status}
                onRetry={
                  canRetryPropagation
                    ? () => retryPropagation({ id: page._id })
                    : undefined
                }
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Désactivé tant que les réglages ne sont pas chargés.
              `homePageSlug` vaut `undefined` pendant ce temps, et
              `publicPath` répond alors « cette page n'est pas l'accueil » —
              ce qui est faux pour l'accueil et rouvrirait exactement le
              bug qu'on vient de fermer, dans une fenêtre de quelques
              centaines de millisecondes que personne ne reproduirait. */}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || homePageSlug === undefined}
            onClick={handlePreview}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Prévisualiser
          </Button>
          {canPublish && (
            <Button
              variant={page.status === "published" ? "outline" : "default"}
              size="sm"
              disabled={busy}
              onClick={handlePublishToggle}
            >
              {page.status === "published" ? "Dépublier" : "Publier"}
            </Button>
          )}
          {(canPublish || isOwn) && (
            <DeletePageButton
              title={page.title}
              published={page.status === "published"}
              onConfirm={async () => {
                setError(null)
                setBusy(true)
                try {
                  await removePage({ id: page._id })
                  window.location.assign("/pages")
                } catch (err) {
                  setError(describePageError(err))
                  setBusy(false)
                }
              }}
            />
          )}
        </div>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {isOwn
            ? "Publiée : un editor ne la modifie plus. Dépubliez-la pour reprendre."
            : "Page d'un autre utilisateur : lecture seule."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {previewUrl && (
        <p className="text-xs text-muted-foreground">
          Aperçu valable 15 minutes.{" "}
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Rouvrir
          </a>
        </p>
      )}

      {/* Le chemin mesuré est celui qui est réellement servi, pas le slug :
          la page d'accueil répond sur `/` et non sur `/accueil`, et
          interroger le mauvais chemin rendrait zéro sans le dire. Le slug
          enregistré, pas celui en cours d'édition — la mesure porte sur ce
          qui est en ligne.

          `undefined` n'est pas `null` ici : tant que le réglage n'est pas
          arrivé, on ne sait pas encore si CETTE page est l'accueil, et
          `publicPath` répondrait `/accueil` — l'adresse que la note en tête
          de `convex/lib/publicPath.ts` compte parmi ses quatre oublis. Le
          panneau attend plutôt que de mesurer une adresse qui n'existe
          pas. */}
      <PageAnalytics
        path={homePageSlug === undefined ? null : publicPath(page.slug, homePageSlug)}
        kind="page"
        pageId={page._id}
      />

      {/* --------------------------------------------------------------
          Trois sections, trois questions — et l'ordre est celui dans
          lequel on se les pose devant cet écran :

            1. comment on l'appelle, et où elle vit ;
            2. qui la trouve en cherchant ;
            3. qui la cite en répondant.

          « Est-elle en ligne » est la quatrième, et elle n'a pas de
          section : elle est en haut, à côté du titre, parce que c'est un
          état et deux actions — pas des champs à remplir.

          Ce que ce découpage NE fait pas : refléter les colonnes de la
          table. `seo` et `geo` sont deux objets en base, mais ce n'est pas
          ce qui les sépare ici — ce sont deux publics. Et aucune section ne
          porte le CONTENU de la page : il vit dans son fichier `.astro`
          (CLAUDE.md, invariant 5). Cet écran décide qui doit trouver la
          page, jamais ce qu'elle raconte.
          -------------------------------------------------------------- */}

      <Section title="Nom et adresse">
        <Field>
          <FieldLabel htmlFor="edit-title">Titre</FieldLabel>
          <Input
            id="edit-title"
            value={title}
            maxLength={MAX_PAGE_TITLE_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-slug">Slug</FieldLabel>
          <Input
            id="edit-slug"
            value={slug}
            maxLength={MAX_SLUG_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setSlug(event.target.value)}
          />
          {/* « Chemin public — sans slash de tête ni de fin. » est parti :
              `normalizeSlug` retire ces slashs de toute façon, et le chemin
              servi est écrit en haut de l'écran. La phrase décrivait un
              refus qui n'existe pas. */}
        </Field>
      </Section>

      <Section
        title="Dans les résultats de recherche"
        action={canWrite ? generateButton : undefined}
      >
        <Field>
          <FieldLabel htmlFor="target-keyword">Mot-clé cible</FieldLabel>
          <Input
            id="target-keyword"
            value={targetKeyword}
            maxLength={MAX_TARGET_KEYWORD_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setTargetKeyword(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="seo-title">Titre affiché</FieldLabel>
          <Input
            id="seo-title"
            value={seoTitle}
            maxLength={MAX_SEO_TITLE_LENGTH}
            disabled={!canWrite}
            placeholder={page.title}
            onChange={(event) => setSeoTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="seo-description">Description</FieldLabel>
          <Textarea
            id="seo-description"
            value={seoDescription}
            maxLength={MAX_SEO_DESCRIPTION_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setSeoDescription(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="seo-canonical">URL canonique</FieldLabel>
          <Input
            id="seo-canonical"
            value={seoCanonicalUrl}
            maxLength={MAX_CANONICAL_URL_LENGTH}
            disabled={!canWrite}
            placeholder="https://…"
            onChange={(event) => setSeoCanonicalUrl(event.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="seo-noindex"
            checked={seoNoindex}
            disabled={!canWrite}
            onCheckedChange={(checked) => setSeoNoindex(checked === true)}
          />
          <FieldLabel htmlFor="seo-noindex">
            Exclure des moteurs de recherche
          </FieldLabel>
        </Field>
        <OgImageField
          value={seoOgImageId}
          disabled={!canWrite}
          generating={generatingCover}
          onChange={setSeoOgImageId}
          onGenerate={(extra) => void handleGenerateCover(extra)}
        />
      </Section>

      <Section
        title="Dans les moteurs de réponse"
        action={canWrite ? generateButton : undefined}
      >
        <Field>
          {/* Ce que l'étiquette dit maintenant, dix-huit mots l'expliquaient
              en dessous. « Extractible » ne se lisait pas ; « cité tel
              quel » dit le même contrat et change ce qu'on tape. */}
          <FieldLabel htmlFor="geo-summary">Résumé cité tel quel</FieldLabel>
          <Textarea
            id="geo-summary"
            value={geoSummary}
            maxLength={MAX_GEO_SUMMARY_LENGTH}
            disabled={!canWrite}
            onChange={(event) => setGeoSummary(event.target.value)}
          />
        </Field>

        <Field>
          <Compteur
            label={
              <FieldLabel htmlFor="geo-entities">
                Entités, séparées par des virgules
              </FieldLabel>
            }
            valeur={splitEntities(geoEntities).length}
            max={MAX_GEO_ENTITIES}
          />
          <Input
            id="geo-entities"
            value={geoEntities}
            disabled={!canWrite}
            maxLength={(MAX_GEO_ENTITY_LENGTH + 2) * MAX_GEO_ENTITIES}
            placeholder="AstroTan, Convex, Astro"
            onChange={(event) => setGeoEntities(event.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Compteur
            label={<FieldLabel>Questions / réponses</FieldLabel>}
            valeur={geoFaq.length}
            max={MAX_GEO_FAQ_ITEMS}
          />
          <RepeatableItems
            items={geoFaq}
            disabled={!canWrite || geoFaq.length >= MAX_GEO_FAQ_ITEMS}
            addLabel="Ajouter une question"
            emptyItem={{ question: "", answer: "" }}
            fields={[
              { key: "question", label: "Question", max: MAX_GEO_QUESTION_LENGTH },
              {
                key: "answer",
                label: "Réponse",
                max: MAX_GEO_ANSWER_LENGTH,
                multiline: true,
              },
            ]}
            onChange={setGeoFaq}
          />
        </div>

        {/* Les vingt-quatre mots qui distinguaient ceci de `noindex` sont
            partis avec le mot `noindex` lui-même : les deux interrupteurs
            vivent désormais dans deux sections qui nomment chacune son
            public, et la distinction se lit dans le plan de l'écran plutôt
            que dans un paragraphe sous l'un des deux. */}
        <Field orientation="horizontal">
          <Switch
            id="geo-noai"
            checked={geoNoai}
            disabled={!canWrite}
            onCheckedChange={(checked) => setGeoNoai(checked === true)}
          />
          <FieldLabel htmlFor="geo-noai">
            Interdire la reprise par les IA génératives
          </FieldLabel>
        </Field>
      </Section>

      {/* Pas de barre du tout en lecture seule : ni bouton à cliquer, ni
          sauvegarde automatique à déclencher. `pages.update` refuserait de
          toute façon — c'est lui l'application de la règle, ceci n'est que
          la courtoisie. */}
      {canWrite && (
        <SaveBar
          status={autoSave.status}
          lastSavedAt={autoSave.lastSavedAt}
          error={autoSave.error}
          canSave={autoSave.canSave}
          onSave={autoSave.saveNow}
        />
      )}
    </div>
  )
}

/**
 * Une section de l'écran : son cadre et son `h2`.
 *
 * `CardTitle` rend un `div` — trois sections titrées par des `div` ne font
 * pas un plan, elles font trois textes en gras. Le `h1` au-dessus est le
 * titre de la page ; ces trois-là sont ses sous-titres, et c'est ce qui
 * permet d'atteindre « Dans les moteurs de réponse » directement, sans
 * parcourir les champs qui précèdent.
 */
/**
 * Une étiquette et son décompte, sur la même ligne.
 *
 * Remplace deux phrases qui disaient « 20 au maximum » : elles se lisaient
 * une fois puis ne servaient plus, alors que le décompte répond à la seule
 * question qui se pose ensuite — combien il en reste. La limite est là
 * aussi, mais à côté d'un nombre qui bouge.
 */
function Compteur({
  label,
  valeur,
  max,
}: {
  label: ReactNode
  valeur: number
  max: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      {label}
      <FieldDescription className="tabular-nums">
        {valeur} / {max}
      </FieldDescription>
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">
          {title}
        </h2>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

function DeletePageButton({
  title,
  published,
  onConfirm,
}: {
  title: string
  published: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2Icon data-icon="inline-start" />
        Supprimer
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {title} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            {published
              ? "Cette page est publiée : elle disparaîtra du site public une fois l'invalidation propagée. Cette action est irréversible."
              : "Ce brouillon sera supprimé définitivement. Cette action est irréversible."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
