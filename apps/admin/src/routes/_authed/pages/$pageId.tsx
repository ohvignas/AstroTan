import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
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
} from "@astrotan/backend/convex/content"
import { describePageError } from "@/lib/pageErrors"
import { describeContentProblem, splitEntities } from "@/lib/contentGuards"
import { PageAnalytics } from "@/components/analytics-panel"
import { PublicationStatusBadge } from "@/components/PublicationStatusBadge"
// Lived in this file until the settings screen needed the same widget for
// its social links — see that component's header.
import { RepeatableItems } from "@/components/repeatable-items"
import { SaveBar, useAutoSave } from "@/components/save-bar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const updatePage = useMutation(api.pages.update)
  const removePage = useMutation(api.pages.remove)
  const publishPage = useMutation(api.pages.publishPage)
  const unpublish = useMutation(api.pages.unpublish)
  const mintPreviewToken = useMutation(api.pages.mintPreviewToken)
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


  // Tout ce qui peut être réécrit sans effet de bord hors de cette ligne.
  // Le slug n'y est pas, et c'est le point entier de ce découpage :
  // `pages.update` frappe une 301 à chaque renommage
  // (`redirects.mintRenameRedirect`), donc une sauvegarde qui suivrait la
  // frappe laisserait derrière elle `/tar`, `/tari`, `/tarif`…
  const autoFields = {
    title,
    seo: {
      title: seoTitle.trim() || undefined,
      description: seoDescription.trim() || undefined,
      canonicalUrl: seoCanonicalUrl.trim() || undefined,
      noindex: seoNoindex,
    },
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
      const url = `${base}/${slug}?t=${encodeURIComponent(token)}`
      setPreviewUrl(url)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setBusy(false)
    }
  }

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
              <span>/{page.slug}</span>
              <PublicationStatusBadge
                status={publicationStatus}
                pageStatus={page.status}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
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
            ? "Cette page est publiée : un editor ne peut plus la modifier une fois en ligne. Dépubliez-la (ou demandez à un owner/admin) pour reprendre l'édition."
            : "Cette page appartient à un autre utilisateur : vous pouvez la consulter, pas la modifier."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {previewUrl && (
        <p className="text-xs text-muted-foreground">
          Le lien de prévisualisation expire dans 15 minutes.{" "}
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
          qui est en ligne. */}
      <PageAnalytics
        path={homePageSlug === page.slug ? "/" : `/${page.slug}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
            <FieldDescription>
              Chemin public — sans slash de tête ni de fin.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEO</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="seo-title">Titre SEO</FieldLabel>
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
              Exclure des moteurs de recherche (noindex)
            </FieldLabel>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GEO — moteurs de réponse</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="geo-summary">Résumé extractible</FieldLabel>
            <Textarea
              id="geo-summary"
              value={geoSummary}
              maxLength={MAX_GEO_SUMMARY_LENGTH}
              disabled={!canWrite}
              onChange={(event) => setGeoSummary(event.target.value)}
            />
            <FieldDescription>
              Ce qu'un moteur de réponse citera tel quel. Deux ou trois
              phrases factuelles, qui se suffisent hors contexte.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="geo-entities">Entités</FieldLabel>
            <Input
              id="geo-entities"
              value={geoEntities}
              disabled={!canWrite}
              maxLength={(MAX_GEO_ENTITY_LENGTH + 2) * MAX_GEO_ENTITIES}
              placeholder="AstroTan, Convex, Astro"
              onChange={(event) => setGeoEntities(event.target.value)}
            />
            <FieldDescription>
              Ce dont parle la page, séparé par des virgules — de quoi lever
              une ambiguïté de nom. {MAX_GEO_ENTITIES} au maximum.
            </FieldDescription>
          </Field>

          <div className="flex flex-col gap-2">
            <FieldLabel>Questions / réponses</FieldLabel>
            <FieldDescription>
              Émises en JSON-LD <code>FAQPage</code> — le format que les
              moteurs de réponse citent le plus fidèlement.{" "}
              {MAX_GEO_FAQ_ITEMS} au maximum.
            </FieldDescription>
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
          <FieldDescription>
            Distinct de <code>noindex</code> : une page peut rester indexable
            par un moteur de recherche sans que son contenu soit repris par un
            moteur de réponse.
          </FieldDescription>
        </CardContent>
      </Card>

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
