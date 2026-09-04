import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { describePageError } from "@/lib/pageErrors"
import { ETAT_SLUG_INITIAL, saisirSlug, saisirTitre } from "@/lib/slugSync"
import { RowActionButton, RowActionsMenu } from "@/components/row-actions"
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
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  EyeOffIcon,
  GlobeIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/posts/")({
  component: PostsListPage,
})

type PostRow = FunctionReturnType<typeof api.posts.list>[number]

// `Intl` rather than `toLocaleDateString` with an implicit locale: the
// dashboard is French regardless of the browser's own preference, and a
// list where half the dates read "8/28/2026" is the kind of thing nobody
// reports and everybody notices.
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

function PostsListPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as the pages list.
  const profile = useQuery(api.profiles.me)
  const posts = useQuery(api.posts.list)

  if (profile === undefined || posts === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // `posts.publishPost`/`unpublishPost` refuse an editor server-side
  // regardless of this flag — it only decides whether the button renders
  // at all. Hiding a control is a courtesy to the operator, never the
  // enforcement.
  const canPublish = profile.role === "owner" || profile.role === "admin"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Articles</h1>
          <p className="text-sm text-muted-foreground">
            {profile.role === "editor"
              ? "Vous voyez tous les articles, mais ne modifiez ou supprimez que les vôtres."
              : "Rédiger, prévisualiser et publier les articles du blog."}
          </p>
        </div>
        <CreatePostDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tous les articles</CardTitle>
        </CardHeader>
        <CardContent>
          <PostsTable
            posts={posts}
            selfAuthUserId={profile.authUserId}
            canPublish={canPublish}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function PostsTable({
  posts,
  selfAuthUserId,
  canPublish,
}: {
  posts: PostRow[]
  selfAuthUserId: string
  canPublish: boolean
}) {
  const removePost = useMutation(api.posts.remove)
  const publishPost = useMutation(api.posts.publishPost)
  const unpublishPost = useMutation(api.posts.unpublishPost)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<Id<"posts"> | null>(null)

  if (posts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun article pour le moment.
      </p>
    )
  }

  async function withPending(id: Id<"posts">, run: () => Promise<unknown>) {
    setError(null)
    setPendingId(id)
    try {
      await run()
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Titre</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Auteur</TableHead>
            <TableHead>Publié le</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((post) => {
            const isOwn = post.createdBy === selfAuthUserId
            const pending = pendingId === post._id
            return (
              <TableRow key={post._id}>
                <TableCell className="font-medium">
                  <Link
                    to="/posts/$postId"
                    params={{ postId: post._id }}
                    className="hover:underline"
                  >
                    {post.title}
                  </Link>
                  <span className="block text-xs font-normal text-muted-foreground">
                    /blog/{post.slug}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      post.status === "published" ? "default" : "outline"
                    }
                  >
                    {post.status === "published" ? "Publié" : "Brouillon"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span>{post.author?.displayName ?? "—"}</span>
                  {post.author?.email &&
                    post.author.email !== post.author.displayName && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {post.author.email}
                      </span>
                    )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {post.status === "published" && post.publishedAt
                    ? DATE_FORMAT.format(post.publishedAt)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <PostRowActions
                    post={post}
                    canPublish={canPublish}
                    isOwn={isOwn}
                    pending={pending}
                    onPublish={() =>
                      withPending(post._id, () => publishPost({ id: post._id }))
                    }
                    onUnpublish={() =>
                      withPending(post._id, () =>
                        unpublishPost({ id: post._id })
                      )
                    }
                    onDelete={() =>
                      withPending(post._id, () => removePost({ id: post._id }))
                    }
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Une action visible, le reste replié — même partage que la liste des
 * pages, et pour la même raison : rédiger est ce qu'on vient faire sur
 * cette ligne, supprimer est irréversible et ne doit pas être voisin du
 * geste courant.
 *
 * La confirmation est pilotée par état plutôt que par un
 * `AlertDialogTrigger` : le menu se ferme au clic sur une entrée, et
 * emporterait un déclencheur monté à l'intérieur avant qu'il n'ouvre quoi
 * que ce soit.
 */
function PostRowActions({
  post,
  canPublish,
  isOwn,
  pending,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  post: PostRow
  canPublish: boolean
  isOwn: boolean
  pending: boolean
  onPublish: () => void
  onUnpublish: () => void
  onDelete: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Un éditeur qui ne possède pas l'article n'a aucune entrée à voir : le
  // bouton trois points ne se rend alors pas du tout, plutôt que d'ouvrir
  // un menu vide. `canPublish` implique `canDelete`, d'où la seule
  // condition.
  const canDelete = canPublish || isOwn

  return (
    <div className="flex items-center justify-end gap-1">
      <RowActionButton
        label={`Éditer l'article ${post.title}`}
        tooltip="Éditer"
        render={<Link to="/posts/$postId" params={{ postId: post._id }} />}
        nativeButton={false}
      >
        <PencilIcon />
      </RowActionButton>

      {canDelete && (
        <RowActionsMenu label={`Autres actions pour l'article ${post.title}`}>
          {canPublish &&
            (post.status === "published" ? (
              <DropdownMenuItem disabled={pending} onClick={onUnpublish}>
                <EyeOffIcon />
                Dépublier
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={pending} onClick={onPublish}>
                <GlobeIcon />
                Publier
              </DropdownMenuItem>
            ))}
          {/* Le séparateur n'a de sens qu'au-dessus de quelque chose : pour
              un éditeur, « Supprimer » est la seule entrée du menu. */}
          {canPublish && <DropdownMenuSeparator />}
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
            Supprimer
          </DropdownMenuItem>
        </RowActionsMenu>
      )}

      {canDelete && (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer « {post.title} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                {post.status === "published"
                  ? "Cet article est publié : il disparaîtra du blog une fois l'invalidation propagée. Cette action est irréversible."
                  : "Ce brouillon sera supprimé définitivement. Cette action est irréversible."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function CreatePostDialog() {
  const createPost = useMutation(api.posts.create)
  const [open, setOpen] = useState(false)
  const [etat, setEtat] = useState(ETAT_SLUG_INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setEtat(ETAT_SLUG_INITIAL)
      setError(null)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const id = await createPost({ title: etat.titre, slug: etat.slug })
      handleOpenChange(false)
      // Straight into the editor: creating an article is only ever step
      // one of writing it. Same move as the pages list's own dialog.
      window.location.assign(`/posts/${id}`)
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        Nouvel article
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel article</DialogTitle>
          <DialogDescription>
            Créé comme brouillon — vous rédigez le corps et publiez ensuite.
          </DialogDescription>
        </DialogHeader>
        <form id="create-post-form" onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="post-title">Titre</FieldLabel>
              <Input
                id="post-title"
                autoComplete="off"
                required
                value={etat.titre}
                onChange={(event) =>
                  setEtat((courant) => saisirTitre(courant, event.target.value))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="post-slug">Slug</FieldLabel>
              <Input
                id="post-slug"
                autoComplete="off"
                required
                placeholder="mon-premier-article"
                value={etat.slug}
                onChange={(event) =>
                  setEtat((courant) => saisirSlug(courant, event.target.value))
                }
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Annuler
          </DialogClose>
          <Button
            type="submit"
            form="create-post-form"
            disabled={
              submitting ||
              etat.titre.trim().length === 0 ||
              etat.slug.trim().length === 0
            }
          >
            {submitting ? "Création…" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
