import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useAction, useMutation, useQuery } from "convex/react"
import { ConvexError } from "convex/values"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
// Every bound comes from `convex/content`, never from `convex/posts` or
// `convex/tags` — those two are deployment entry points, and importing one
// into the browser drags its whole `query`/`mutation` graph along with it
// ("Convex functions should not be imported in the browser… will throw an
// error in future versions of `convex`", logged once per function).
// `content.ts` imports only `convex/values` and declares no functions at
// all; the post and tag modules re-export these same constants for server
// callers.
import {
  MAX_CANONICAL_URL_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_GEO_ANSWER_LENGTH,
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
  MAX_GEO_QUESTION_LENGTH,
  MAX_GEO_SUMMARY_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "@astrotan/backend/convex/content"
import { describePageError } from "@/lib/pageErrors"
import { describeContentProblem, splitEntities } from "@/lib/contentGuards"
import { buildSeo } from "@/lib/buildSeo"
import type { SeoGeoDraft } from "@astrotan/backend/convex/lib/seoGeoDraft"
import { coverPatch } from "@/lib/coverPatch"
import { postEditorActions } from "@/lib/postEditorActions"
import { GenerateSeoGeoButton } from "@/components/generate-seo-geo-button"
import { PostCoachPanel } from "@/components/post-coach-panel"
import { CoverField } from "@/components/cover-field"
import { PageAnalytics } from "@/components/analytics-panel"
import { PublicationStatusBadge } from "@/components/PublicationStatusBadge"
import { RichTextEditor } from "@/components/rich-text-editor"
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
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/posts/$postId")({
  component: PostEditorPage,
})

type Profile = FunctionReturnType<typeof api.profiles.me>
type PostDoc = NonNullable<FunctionReturnType<typeof api.posts.get>> & {
  hasUnpublishedChanges?: boolean
}

// ---------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------

// `lib/pageErrors.ts` already maps every code the shared machinery throws
// (`FORBIDDEN`, `NOT_FOUND`, `FIELD_TOO_LONG`, …) and posts go through
// exactly that machinery. What it cannot know are the four codes only the
// post/tag/media families raise, plus one whose wording names the wrong
// noun for this screen ("une autre page"). Layering here rather than
// widening the shared dictionary keeps `pageErrors.ts` about pages —
// the same reason that file exists separately from `users.tsx`'s own map.
const POST_ERROR_MESSAGES: Record<string, string> = {
  SLUG_ALREADY_EXISTS: "Ce slug est déjà utilisé par un autre article.",
  UNKNOWN_MEDIA: "Cette image n'existe plus dans la médiathèque.",
}

function describePostError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string" && POST_ERROR_MESSAGES[code]) {
        return POST_ERROR_MESSAGES[code]
      }
    }
  }
  return describePageError(error)
}

// ---------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------

function PostEditorPage() {
  const { postId } = Route.useParams()
  const id = postId as Id<"posts">
  // Already subscribed by `AppShell`.
  const profile = useQuery(api.profiles.me)
  const post = useQuery(api.posts.get, { id })

  if (profile === undefined || post === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  if (post === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Article introuvable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Link to="/posts" className="underline">
            Retour à la liste des articles
          </Link>
        </CardContent>
      </Card>
    )
  }

  // The child seeds its form's `defaultValues` from `post` exactly once,
  // on its first render. `api.posts.get` is a live subscription, so
  // reseeding on every update would let a concurrent editor — or this
  // screen's own `update` resolving — wipe out a body being typed.
  return <PostEditor post={post} profile={profile} />
}

// ---------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------

// Flat rather than nested (`seo: { title }`): TanStack Form addresses
// nested values by dotted path just fine, but a flat shape keeps every
// field name a single identifier, and keeps this file readable next to
// `pages/$pageId.tsx`, whose `useState` variables it mirrors one for one.
type PostFormValues = {
  title: string
  slug: string
  excerpt: string
  body: string
  coverId: Id<"_storage"> | null
  targetKeyword: string
  seoTitle: string
  seoDescription: string
  seoCanonicalUrl: string
  seoNoindex: boolean
  geoSummary: string
  geoEntities: string
  geoFaq: { question: string; answer: string }[]
  geoNoai: boolean
}

function initialValues(post: PostDoc): PostFormValues {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? "",
    body: post.body,
    coverId: post.coverId ?? null,
    targetKeyword: post.targetKeyword ?? "",
    seoTitle: post.seo?.title ?? "",
    seoDescription: post.seo?.description ?? "",
    seoCanonicalUrl: post.seo?.canonicalUrl ?? "",
    seoNoindex: post.seo?.noindex ?? false,
    geoSummary: post.geo?.summary ?? "",
    // Held as one comma-separated string rather than an array of inputs:
    // entities are short single words, and a row of add/remove buttons for
    // each would be more chrome than content. Same call as the page editor.
    geoEntities: (post.geo?.entities ?? []).join(", "),
    geoFaq: post.geo?.faq ?? [],
    geoNoai: post.geo?.noai ?? false,
  }
}

/**
 * Ce qu'une sauvegarde automatique a le droit de réécrire.
 *
 * Tout sauf le slug. `posts.update` frappe une redirection 301 à chaque
 * renommage (`redirects.mintRenameRedirect`), et une écriture qui suivrait
 * la frappe laisserait derrière elle `/tar`, `/tari`, `/tarif` — des lignes
 * mortes que personne ne relierait à leur cause, et qui occuperaient
 * ensuite ces chemins pour de bon.
 */
function autoFieldsOf(
  values: PostFormValues,
  existing?: { ogImageId?: Id<"_storage"> },
) {
  return {
    title: values.title,
    body: values.body,
    excerpt: values.excerpt,
    ...coverPatch(values.coverId),
    targetKeyword: values.targetKeyword,
    seo: buildSeo({
      existing,
      fields: {
        title: values.seoTitle,
        description: values.seoDescription,
        canonicalUrl: values.seoCanonicalUrl,
        noindex: values.seoNoindex,
      },
    }),
    geo: {
      summary: values.geoSummary.trim() || undefined,
      // Drop rows the operator started and left blank rather than
      // sending them: an empty Q/A pair would be emitted as FAQPage
      // JSON-LD with nothing in it.
      faq: values.geoFaq.filter(
        (item) => item.question.trim() !== "" && item.answer.trim() !== ""
      ),
      entities: splitEntities(values.geoEntities),
      noai: values.geoNoai,
    },
  }
}

function PostEditor({
  post,
  profile,
}: {
  post: PostDoc
  profile: Profile
}) {
  const generateSeoGeo = useAction(api.ai.generateSeoGeo)
  const generatePostCover = useAction(api.aiImage.generatePostCover)
  const updatePost = useMutation(api.posts.update)
  const removePost = useMutation(api.posts.remove)
  const publishPost = useMutation(api.posts.publishPost)
  const unpublishPost = useMutation(api.posts.unpublishPost)
  const discardWorkingCopy = useMutation(api.posts.discardWorkingCopy)
  const mintPreviewToken = useMutation(api.posts.mintPostPreviewToken)
  const retryPropagation = useMutation(api.posts.retryPropagation)
  const publicationStatus = useQuery(api.posts.publicationStatus, {
    id: post._id,
  })

  // Everything the *form* owns lives in the form. What is left in
  // `useState` is deliberately not form state: the outcome of the three
  // mutations that are not a save (publish, preview, delete), and the one
  // error line the whole screen shares.
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingCover, setGeneratingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // First use of TanStack Form in this repo — the shape every later admin
  // form should copy. Three things it buys over the ten `useState` calls
  // the page editor uses: `defaultValues` seeded once from the document,
  // per-field subscriptions (typing in a 200 000-character body no longer
  // re-renders the SEO and GEO cards), and `isDirty`/`isSubmitting` as
  // derived state rather than two more flags to keep in sync by hand.
  // Un seul point d'écriture, appelé avec ou sans le slug.
  //
  // `posts.update` déclare tous ses arguments optionnels : omettre `slug`
  // laisse littéralement la valeur enregistrée intacte, et n'atteint donc
  // jamais `mintRenameRedirect`. C'est ce qui permet à la sauvegarde
  // automatique de suivre la frappe sans semer une 301 par lettre tapée
  // dans le champ « Slug ».
  async function persist(
    values: PostFormValues,
    options: { withSlug: boolean }
  ) {
    await updatePost({
      id: post._id,
      ...(options.withSlug ? { slug: values.slug } : {}),
      ...autoFieldsOf(values, { ogImageId: post.seo?.ogImageId }),
    })
  }

  // Première utilisation de TanStack Form dans ce dépôt — la forme que
  // devraient copier les formulaires suivants. Ce qu'elle apporte ici :
  // `defaultValues` semé une seule fois depuis le document, et des
  // abonnements par champ (taper dans un corps de 200 000 caractères ne
  // re-rend plus les cartes SEO et GEO).
  //
  // Pas de `onSubmit` : l'enregistrement appartient désormais à
  // `useAutoSave`, qui doit distinguer deux charges utiles (avec ou sans
  // slug) là où `handleSubmit` n'en connaît qu'une. Pas de `form.reset`
  // après un enregistrement non plus — il réécrirait les champs avec la
  // photo envoyée, effaçant ce qui aurait été tapé pendant l'appel. La
  // référence de propreté est tenue par `useAutoSave`.
  const form = useForm({
    defaultValues: initialValues(post),
  })

  // Le bouton « Enregistrer » vit dans un enfant (il s'abonne aux valeurs
  // du formulaire, ce que ce composant-ci évite justement de faire). La
  // soumission native du `<form>` — la touche Entrée dans un champ — doit
  // pourtant déclencher le même geste ; cette référence est le fil entre
  // les deux.
  const requestSave = useRef<(() => void) | null>(null)


  // The property this whole screen upholds, verbatim from the pages
  // editor: "hiding a button is a courtesy to the operator, never the
  // enforcement." `posts.update`/`remove` re-check `requireOwnDocument`
  // and `posts.publishPost`/`unpublishPost` re-check
  // `requireRole(["owner","admin"])` themselves, unconditionally.
  const isOwn = post.createdBy === profile.authUserId
  // Narrower than the pages editor on purpose: `posts.update` gates on
  // ownership alone. It does *not* carry pages'
  // `requirePublishedPageWritable` rule, so an editor keeps writing their
  // own article after it goes live. Mirroring the page editor's stricter
  // flag here would grey out a form the server would happily accept.
  const canWrite = profile.role !== "editor" || isOwn
  const canPublish = profile.role === "owner" || profile.role === "admin"
  const canRetryPropagation = canPublish || isOwn
  const hasUnpublishedChanges = post.hasUnpublishedChanges === true
  const actions = postEditorActions({
    status: post.status,
    hasUnpublishedChanges,
    canPublish,
    canWrite,
  })

  async function runAction(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePublish() {
    await runAction(async () => {
      await publishPost({ id: post._id })
    })
  }

  async function handleUnpublish() {
    await runAction(async () => {
      await unpublishPost({ id: post._id })
    })
  }

  async function handleDiscard() {
    await runAction(async () => {
      const live = await discardWorkingCopy({ id: post._id })
      form.reset(initialValues(live))
    })
  }

  async function handlePreview() {
    setError(null)
    setBusy(true)
    try {
      const base = import.meta.env.VITE_WEB_SITE_URL as string | undefined
      if (!base) {
        setError("VITE_WEB_SITE_URL n'est pas configuré côté admin.")
        return
      }
      // The slug comes back from the mutation, read off the stored row —
      // never the one in this form, which may hold an unsaved rename the
      // token would not cover.
      const { token, slug } = await mintPreviewToken({ id: post._id })
      // The article's own URL, not a parallel preview route: what is
      // checked before publishing is literally the page that will go live.
      const url = `${base}/blog/${slug}?t=${encodeURIComponent(token)}`
      setPreviewUrl(url)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setBusy(false)
    }
  }

  function applyDraft(draft: SeoGeoDraft) {
    form.setFieldValue("seoTitle", draft.seo.title)
    form.setFieldValue("seoDescription", draft.seo.description)
    form.setFieldValue("geoSummary", draft.geo.summary)
    form.setFieldValue("geoEntities", draft.geo.entities.join(", "))
    form.setFieldValue("geoFaq", draft.geo.faq)
    form.setFieldValue("geoNoai", draft.geo.noai)
    if (draft.excerpt !== undefined && draft.excerpt.length > 0) {
      form.setFieldValue("excerpt", draft.excerpt)
    }
  }

  async function handleGenerateCover() {
    setError(null)
    setGeneratingCover(true)
    try {
      const result = await generatePostCover({ postId: post._id })
      form.setFieldValue("coverId", result.storageId)
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setGeneratingCover(false)
    }
  }

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      applyDraft(await generateSeoGeo({ postId: post._id }))
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setGenerating(false)
    }
  }

  const generateButton = (
    <GenerateSeoGeoButton
      disabled={!canWrite}
      busy={generating}
      onClick={() => void handleGenerate()}
    />
  )

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        requestSave.current?.()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/posts" />}
            nativeButton={false}
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-lg font-medium">{post.title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>/blog/{post.slug}</span>
              <PublicationStatusBadge
                status={publicationStatus}
                pageStatus={post.status}
                onRetry={
                  canRetryPropagation
                    ? () => retryPropagation({ id: post._id })
                    : undefined
                }
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handlePreview}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Prévisualiser
          </Button>
          {actions.showPublish && (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => void handlePublish()}
            >
              Publier
            </Button>
          )}
          {actions.showDiscard && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleDiscard()}
            >
              Annuler les modifications
            </Button>
          )}
          {actions.showUnpublish && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleUnpublish()}
            >
              Dépublier
            </Button>
          )}
          {(canPublish || isOwn) && (
            <DeletePostButton
              title={post.title}
              published={post.status === "published"}
              onConfirm={async () => {
                setError(null)
                setBusy(true)
                try {
                  await removePost({ id: post._id })
                  window.location.assign("/posts")
                } catch (err) {
                  setError(describePostError(err))
                  setBusy(false)
                }
              }}
            />
          )}
        </div>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Cet article appartient à un autre utilisateur : vous pouvez le
          consulter, pas le modifier.
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

      {/* Un article répond toujours sous `/blog/`, et sur son slug
          enregistré : c'est ce qui est en ligne qui a été mesuré. */}
      <PageAnalytics
        path={`/blog/${post.slug}`}
        kind="post"
        postId={post._id}
      />

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form.Field
            name="title"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Titre</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_PAGE_TITLE_LENGTH}
                  disabled={!canWrite}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          />
          <form.Field
            name="slug"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Slug</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_SLUG_LENGTH}
                  disabled={!canWrite}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldDescription>
                  Chemin public sous <code>/blog/</code> — sans slash de tête ni
                  de fin.
                </FieldDescription>
              </Field>
            )}
          />
          <form.Field
            name="excerpt"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Extrait</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_EXCERPT_LENGTH}
                  disabled={!canWrite}
                  rows={3}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldDescription>
                  Le résumé affiché sur les cartes de <code>/blog</code>. Laissé
                  vide, le début du corps est utilisé.{" "}
                  {field.state.value.length}/{MAX_EXCERPT_LENGTH}
                </FieldDescription>
              </Field>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contenu</CardTitle>
        </CardHeader>
        <CardContent className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
          <form.Field
            name="body"
            children={(field) => (
              <Field>
                {/* `FieldTitle` et non `FieldLabel` : la zone de saisie
                    de l'éditeur est un `div[contenteditable]`, pas un
                    contrôle de formulaire, et un `<label for>` qui pointe
                    dessus est du HTML invalide — le navigateur le signale
                    et le clic sur le libellé ne fait rien. Le nom
                    accessible est porté par l'`aria-label` de la zone
                    elle-même. */}
                <FieldTitle>Corps</FieldTitle>
                {/* `posts.body` contient du HTML — la sortie native de
                    Tiptap, sans conversion, donc sans perte. Le compteur
                    et la limite vivent dans l'éditeur : il mesure la
                    chaîne HTML, qui est exactement ce que `posts.update`
                    borne. */}
                <RichTextEditor
                  id={field.name}
                  value={field.state.value}
                  maxLength={MAX_POST_BODY_LENGTH}
                  disabled={!canWrite}
                  onChange={field.handleChange}
                />
                <FieldDescription>
                  Mise en forme par la barre d'outils. Le bouton{" "}
                  <code>&lt;/&gt;</code> montre le HTML tel qu'il est stocké, et
                  permet de le corriger à la main.
                </FieldDescription>
              </Field>
            )}
          />
          <form.Subscribe
            selector={(state) => ({
              title: state.values.title,
              excerpt: state.values.excerpt,
              body: state.values.body,
              targetKeyword: state.values.targetKeyword,
              seoTitle: state.values.seoTitle,
              seoDescription: state.values.seoDescription,
              slug: state.values.slug,
            })}
            children={(fields) => <PostCoachPanel fields={fields} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Couverture</CardTitle>
        </CardHeader>
        <CardContent>
          <form.Field
            name="coverId"
            children={(field) => (
              <CoverField
                value={field.state.value}
                disabled={!canWrite}
                generating={generatingCover}
                onChange={field.handleChange}
                onGenerate={() => void handleGenerateCover()}
              />
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEO</CardTitle>
          {canWrite ? <CardAction>{generateButton}</CardAction> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form.Field
            name="targetKeyword"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor="target-keyword">Mot-clé cible</FieldLabel>
                <Input
                  id="target-keyword"
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_TARGET_KEYWORD_LENGTH}
                  disabled={!canWrite}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          />
          <form.Field
            name="seoTitle"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Titre SEO</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_SEO_TITLE_LENGTH}
                  disabled={!canWrite}
                  placeholder={post.title}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          />
          <form.Field
            name="seoDescription"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_SEO_DESCRIPTION_LENGTH}
                  disabled={!canWrite}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          />
          <form.Field
            name="seoCanonicalUrl"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>URL canonique</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_CANONICAL_URL_LENGTH}
                  disabled={!canWrite}
                  placeholder="https://…"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          />
          <form.Field
            name="seoNoindex"
            children={(field) => (
              <Field orientation="horizontal">
                <Switch
                  id={field.name}
                  checked={field.state.value}
                  disabled={!canWrite}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                <FieldLabel htmlFor={field.name}>
                  Exclure des moteurs de recherche (noindex)
                </FieldLabel>
              </Field>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GEO — moteurs de réponse</CardTitle>
          {canWrite ? <CardAction>{generateButton}</CardAction> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form.Field
            name="geoSummary"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Résumé extractible</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_GEO_SUMMARY_LENGTH}
                  disabled={!canWrite}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldDescription>
                  Ce qu'un moteur de réponse citera tel quel. Deux ou trois
                  phrases factuelles, qui se suffisent hors contexte.
                </FieldDescription>
              </Field>
            )}
          />

          <form.Field
            name="geoEntities"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Entités</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  disabled={!canWrite}
                  maxLength={(MAX_GEO_ENTITY_LENGTH + 2) * MAX_GEO_ENTITIES}
                  placeholder="AstroTan, Convex, Astro"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldDescription>
                  Ce dont parle l'article, séparé par des virgules — de quoi
                  lever une ambiguïté de nom. {MAX_GEO_ENTITIES} au maximum.
                </FieldDescription>
              </Field>
            )}
          />

          <form.Field
            name="geoFaq"
            children={(field) => (
              <div className="flex flex-col gap-2">
                <FieldLabel>Questions / réponses</FieldLabel>
                <FieldDescription>
                  Émises en JSON-LD <code>FAQPage</code> — le format que les
                  moteurs de réponse citent le plus fidèlement.{" "}
                  {MAX_GEO_FAQ_ITEMS} au maximum.
                </FieldDescription>
                <RepeatableItems
                  items={field.state.value}
                  disabled={
                    !canWrite || field.state.value.length >= MAX_GEO_FAQ_ITEMS
                  }
                  addLabel="Ajouter une question"
                  emptyItem={{ question: "", answer: "" }}
                  fields={[
                    {
                      key: "question",
                      label: "Question",
                      max: MAX_GEO_QUESTION_LENGTH,
                    },
                    {
                      key: "answer",
                      label: "Réponse",
                      max: MAX_GEO_ANSWER_LENGTH,
                      multiline: true,
                    },
                  ]}
                  onChange={field.handleChange}
                />
              </div>
            )}
          />

          <form.Field
            name="geoNoai"
            children={(field) => (
              <Field orientation="horizontal">
                <Switch
                  id={field.name}
                  checked={field.state.value}
                  disabled={!canWrite}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                <FieldLabel htmlFor={field.name}>
                  Interdire la reprise par les IA génératives
                </FieldLabel>
              </Field>
            )}
          />
          <FieldDescription>
            Distinct de <code>noindex</code> : un article peut rester indexable
            par un moteur de recherche sans que son contenu soit repris par un
            moteur de réponse.
          </FieldDescription>
        </CardContent>
      </Card>

      {/* Ni barre ni sauvegarde automatique pour qui ne peut pas écrire :
          `posts.update` refuserait de toute façon (`requireOwnDocument`) —
          c'est lui l'application de la règle, ceci n'est que la courtoisie.

          Abonné aux valeurs entières, et c'est pour cela que la barre est
          un composant à part : le rendu déclenché par chaque frappe reste
          confiné à ces quelques nœuds, au lieu de re-rendre les cartes SEO
          et GEO à chaque caractère du corps. */}
      {canWrite && (
        <form.Subscribe
          selector={(state) => state.values}
          children={(values) => (
            <PostSaveBar
              values={values}
              persist={persist}
              onRequestSave={requestSave}
            />
          )}
        />
      )}
    </form>
  )
}

// ---------------------------------------------------------------------
// Barre d'enregistrement
// ---------------------------------------------------------------------

/**
 * La barre collante de cet écran.
 *
 * Elle n'est montée que lorsque l'opérateur peut écrire, d'où `enabled:
 * true` — le composant parent porte déjà la condition.
 */
function PostSaveBar({
  values,
  persist,
  onRequestSave,
}: {
  values: PostFormValues
  persist: (
    values: PostFormValues,
    options: { withSlug: boolean }
  ) => Promise<void>
  onRequestSave: { current: (() => void) | null }
}) {
  const autoSave = useAutoSave({
    enabled: true,
    auto: autoFieldsOf(values),
    manual: { slug: values.slug },
    // `values` est celui du rendu courant, et `useAutoSave` lit toujours la
    // dernière version de ces deux fermetures : ce qui part est bien la
    // photo comparée juste au-dessus.
    saveAuto: async () => {
      await persist(values, { withSlug: false })
    },
    saveAll: async () => {
      await persist(values, { withSlug: true })
    },
    validate: ({ auto }) =>
      describeContentProblem({
        title: auto.title,
        entities: auto.geo.entities,
        faq: auto.geo.faq,
      }),
    describeError: describePostError,
  })

  // La soumission native du `<form>` (touche Entrée) passe par ici.
  useEffect(() => {
    onRequestSave.current = autoSave.saveNow
    return () => {
      onRequestSave.current = null
    }
  }, [onRequestSave, autoSave.saveNow])

  return (
    <SaveBar
      status={autoSave.status}
      lastSavedAt={autoSave.lastSavedAt}
      error={autoSave.error}
      canSave={autoSave.canSave}
      onSave={autoSave.saveNow}
    />
  )
}

// ---------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------

function DeletePostButton({
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
      <AlertDialogTrigger
        render={<Button type="button" variant="destructive" size="sm" />}
      >
        <Trash2Icon data-icon="inline-start" />
        Supprimer
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {title} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            {published
              ? "Cet article est publié : il disparaîtra du blog une fois l'invalidation propagée. Cette action est irréversible."
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

function LabeledInput({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        maxLength={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function LabeledTextarea({
  label,
  value,
  max,
  disabled,
  rows,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  rows?: number
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        value={value}
        maxLength={max}
        disabled={disabled}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

// The GEO FAQ repeater, same shape as the page editor's: a plain array of
// two bounded string fields.
function RepeatableItems<T extends Record<string, string>>({
  items,
  disabled,
  addLabel,
  emptyItem,
  fields,
  onChange,
}: {
  items: T[]
  disabled: boolean
  addLabel: string
  emptyItem: T
  fields: { key: keyof T; label: string; max: number; multiline?: boolean }[]
  onChange: (items: T[]) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun élément pour le moment.
        </p>
      )}
      {items.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-lg border border-dashed border-input p-2.5"
        >
          {fields.map((field) =>
            field.multiline ? (
              <LabeledTextarea
                key={String(field.key)}
                label={field.label}
                // `T extends Record<string, string>` guarantees every
                // value is a real string — `noUncheckedIndexedAccess`
                // still widens a *generic* key's indexed access to
                // `| undefined`, a known TS limitation around index
                // signatures rather than a real possibility here.
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            ) : (
              <LabeledInput
                key={String(field.key)}
                label={field.label}
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            )
          )}
          {!disabled && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2Icon data-icon="inline-start" />
                Retirer
              </Button>
            </div>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, emptyItem])}
        >
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
      )}
    </div>
  )
}
