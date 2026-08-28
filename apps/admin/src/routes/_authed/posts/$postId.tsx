import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
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
  MAX_TAG_NAME_LENGTH,
} from "@astrotan/backend/convex/content"
import { describePageError } from "@/lib/pageErrors"
import { MediaPicker } from "@/components/media-picker"
import { PublicationStatusBadge } from "@/components/PublicationStatusBadge"
import { RichTextEditor } from "@/components/rich-text-editor"
import { Badge } from "@/components/ui/badge"
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  ImageIcon,
  PlusIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/posts/$postId")({
  component: PostEditorPage,
})

type Profile = FunctionReturnType<typeof api.profiles.me>
type PostDoc = NonNullable<FunctionReturnType<typeof api.posts.get>>
type TagRow = FunctionReturnType<typeof api.tags.list>[number]

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
  // Both of these are unreachable through this screen — tags are picked
  // from `tags.list` and toggled in a set, so an id is always known and
  // never repeated. They are mapped anyway: the mutation is the
  // enforcement, and an unmapped code would surface as "erreur
  // inattendue" if some future control ever reintroduced the case.
  DUPLICATE_TAG: "Le même tag a été ajouté deux fois.",
  UNKNOWN_TAG: "Ce tag n'existe plus — retirez-le et enregistrez à nouveau.",
  UNKNOWN_MEDIA: "Cette image n'existe plus dans la médiathèque.",
  SLUG_TAKEN: "Un tag portant ce nom existe déjà.",
  INVALID_NAME: "Ce nom de tag est invalide — il doit contenir des lettres.",
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
  const tags = useQuery(api.tags.list)

  if (profile === undefined || post === undefined || tags === undefined) {
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
  return <PostEditor post={post} profile={profile} tags={tags} />
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
  tagIds: Id<"tags">[]
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
    tagIds: post.tagIds,
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

function PostEditor({
  post,
  profile,
  tags,
}: {
  post: PostDoc
  profile: Profile
  tags: TagRow[]
}) {
  const updatePost = useMutation(api.posts.update)
  const removePost = useMutation(api.posts.remove)
  const publishPost = useMutation(api.posts.publishPost)
  const unpublishPost = useMutation(api.posts.unpublishPost)
  const mintPreviewToken = useMutation(api.posts.mintPostPreviewToken)
  const publicationStatus = useQuery(api.posts.publicationStatus, {
    id: post._id,
  })

  // Everything the *form* owns lives in the form. What is left in
  // `useState` is deliberately not form state: the outcome of the three
  // mutations that are not a save (publish, preview, delete), and the one
  // error line the whole screen shares.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // First use of TanStack Form in this repo — the shape every later admin
  // form should copy. Three things it buys over the ten `useState` calls
  // the page editor uses: `defaultValues` seeded once from the document,
  // per-field subscriptions (typing in a 200 000-character body no longer
  // re-renders the SEO and GEO cards), and `isDirty`/`isSubmitting` as
  // derived state rather than two more flags to keep in sync by hand.
  const form = useForm({
    defaultValues: initialValues(post),
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        await updatePost({
          id: post._id,
          title: value.title,
          slug: value.slug,
          body: value.body,
          excerpt: value.excerpt,
          // `undefined` means "leave alone" to `posts.update`, so a cover
          // is only ever sent when one is actually selected. Clearing a
          // cover back to none is therefore not expressible against the
          // current mutation — reported rather than faked here.
          ...(value.coverId === null ? {} : { coverId: value.coverId }),
          tagIds: value.tagIds,
          seo: {
            title: value.seoTitle.trim() || undefined,
            description: value.seoDescription.trim() || undefined,
            canonicalUrl: value.seoCanonicalUrl.trim() || undefined,
            noindex: value.seoNoindex,
          },
          geo: {
            summary: value.geoSummary.trim() || undefined,
            // Drop rows the operator started and left blank rather than
            // sending them: an empty Q/A pair would be emitted as FAQPage
            // JSON-LD with nothing in it.
            faq: value.geoFaq.filter(
              (item) => item.question.trim() !== "" && item.answer.trim() !== ""
            ),
            entities: value.geoEntities
              .split(",")
              .map((entity) => entity.trim())
              .filter((entity) => entity !== ""),
            noai: value.geoNoai,
          },
        })
        // Re-baseline so `isDirty` goes back to false on what was just
        // saved, rather than staying true until the component remounts.
        form.reset(value)
      } catch (err) {
        // Caught here rather than left to propagate: a rejection out of
        // `handleSubmit` is an unhandled promise rejection in the console
        // and nothing at all on screen. `isSubmitting` still resolves
        // correctly because the handler itself completes.
        setError(describePostError(err))
      }
    },
  })

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

  async function handlePublishToggle() {
    setError(null)
    setBusy(true)
    try {
      if (post.status === "published") {
        await unpublishPost({ id: post._id })
      } else {
        await publishPost({ id: post._id })
      }
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setBusy(false)
    }
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

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
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
          {canPublish && (
            <Button
              type="button"
              variant={post.status === "published" ? "outline" : "default"}
              size="sm"
              disabled={busy}
              onClick={handlePublishToggle}
            >
              {post.status === "published" ? "Dépublier" : "Publier"}
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
        <CardContent>
          <form.Field
            name="body"
            children={(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Corps</FieldLabel>
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
                onChange={field.handleChange}
              />
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <form.Field
            name="tagIds"
            children={(field) => (
              <TagsField
                tags={tags}
                value={field.state.value}
                disabled={!canWrite}
                onChange={field.handleChange}
                onError={setError}
              />
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEO</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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

      {canWrite && (
        <form.Subscribe
          selector={(state) => ({
            isDirty: state.isDirty,
            isSubmitting: state.isSubmitting,
          })}
          children={({ isDirty, isSubmitting }) => (
            <div className="flex items-center justify-end gap-3">
              {isDirty && !isSubmitting && (
                <span className="text-sm text-muted-foreground">
                  Modifications non enregistrées.
                </span>
              )}
              <Button type="submit" disabled={isSubmitting || !isDirty}>
                {isSubmitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          )}
        />
      )}
    </form>
  )
}

// ---------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------

function CoverField({
  value,
  disabled,
  onChange,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage"> | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // `api.media.list` rather than `api.media.byStorageId`: only the list
  // resolves a storage URL server-side, and a thumbnail without one is
  // just a filename. Subscribed only while a cover is actually set.
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <p className="text-sm text-muted-foreground">
          Aucune image de couverture.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
            {selected?.url ? (
              <img
                src={selected.url}
                alt={selected.alt}
                className="size-full object-cover"
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
                  ordinary answer, not a failure, so it reads as a missing
                  alt rather than an error. */}
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
            {value === null ? "Choisir une image" : "Changer d'image"}
          </Button>
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Image de couverture"
        description="Elle illustre la carte de l'article sur /blog et son partage social."
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------

function TagsField({
  tags,
  value,
  disabled,
  onChange,
  onError,
}: {
  tags: TagRow[]
  value: Id<"tags">[]
  disabled: boolean
  onChange: (value: Id<"tags">[]) => void
  onError: (message: string | null) => void
}) {
  const createTag = useMutation(api.tags.create)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  const tagsById = new Map(tags.map((tag) => [tag._id, tag]))
  const selected = new Set(value)

  // `posts.update` refuses a repeated id (`DUPLICATE_TAG`) and an id no
  // tag holds (`UNKNOWN_TAG`). Neither is reachable from here by
  // construction: every id comes out of `tags.list`, and membership is
  // toggled in a set, so it is present at most once.
  function toggle(tagId: Id<"tags">) {
    onError(null)
    onChange(
      selected.has(tagId)
        ? value.filter((id) => id !== tagId)
        : [...value, tagId]
    )
  }

  // Guards `tags.create`'s `SLUG_TAKEN` before the round trip, on the case
  // an operator actually hits: retyping a name already in the list. It is
  // not the same check the server makes — that one compares *slugs*, so
  // "Astro" and "astro !" collide here without matching — which is why the
  // error is still mapped and displayed rather than assumed away.
  const trimmedName = newName.trim()
  const alreadyExists = tags.some(
    (tag) =>
      tag.name.localeCompare(trimmedName, "fr", {
        sensitivity: "base",
      }) === 0
  )

  async function handleCreate() {
    if (trimmedName.length === 0) return
    onError(null)
    setCreating(true)
    try {
      const tagId = await createTag({ name: trimmedName })
      onChange([...value, tagId])
      setNewName("")
    } catch (err) {
      onError(describePostError(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun tag.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tagId) => (
            <Badge key={tagId} variant="secondary" className="gap-1 pr-1">
              {tagsById.get(tagId)?.name ?? tagId}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Retirer le tag ${tagsById.get(tagId)?.name ?? tagId}`}
                  className="rounded-sm opacity-60 hover:opacity-100"
                  onClick={() => toggle(tagId)}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" size="sm" />}
            >
              <TagIcon data-icon="inline-start" />
              Choisir des tags
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-y-auto">
              {tags.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Aucun tag — créez-en un ci-contre.
                </p>
              ) : (
                tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={tag._id}
                    checked={selected.has(tag._id)}
                    closeOnClick={false}
                    onCheckedChange={() => toggle(tag._id)}
                  >
                    {tag.name}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Input
            aria-label="Nouveau tag"
            className="h-7 w-48 text-[0.8rem]"
            placeholder="Nouveau tag"
            autoComplete="off"
            maxLength={MAX_TAG_NAME_LENGTH}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              // Enter inside a nested control would otherwise submit the
              // whole editor form — creating a tag is its own action.
              if (event.key === "Enter") {
                event.preventDefault()
                if (!creating && trimmedName.length > 0 && !alreadyExists) {
                  void handleCreate()
                }
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={creating || trimmedName.length === 0 || alreadyExists}
            onClick={handleCreate}
          >
            <PlusIcon data-icon="inline-start" />
            {creating ? "Création…" : "Créer"}
          </Button>
          {alreadyExists && (
            <span className="text-xs text-muted-foreground">
              Ce tag existe déjà — choisissez-le dans la liste.
            </span>
          )}
        </div>
      )}
    </div>
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
