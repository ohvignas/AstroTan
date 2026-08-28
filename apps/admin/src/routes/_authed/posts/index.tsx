import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { describePageError } from "@/lib/pageErrors"
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
import { PlusIcon } from "lucide-react"

export const Route = createFileRoute("/_authed/posts/")({
  component: PostsListPage,
})

type PostRow = FunctionReturnType<typeof api.posts.list>[number]
type TagRow = FunctionReturnType<typeof api.tags.list>[number]

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
  const tags = useQuery(api.tags.list)

  if (profile === undefined || posts === undefined || tags === undefined) {
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
            tags={tags}
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
  tags,
  selfAuthUserId,
  canPublish,
}: {
  posts: PostRow[]
  tags: TagRow[]
  selfAuthUserId: string
  canPublish: boolean
}) {
  const removePost = useMutation(api.posts.remove)
  const publishPost = useMutation(api.posts.publishPost)
  const unpublishPost = useMutation(api.posts.unpublishPost)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<Id<"posts"> | null>(null)

  // One pass over the tag list, not one `.find()` per tag per row.
  const tagsById = new Map(tags.map((tag) => [tag._id, tag]))

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
            <TableHead>Tags</TableHead>
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
                  {post.tagIds.length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {post.tagIds.map((tagId) => (
                        <Badge key={tagId} variant="secondary">
                          {/* A tag deleted out from under the post would
                              leave a dangling id — `tags.remove` refuses
                              that (`TAG_IN_USE`), so this fallback should
                              be unreachable. Rendering the raw id rather
                              than nothing is what makes it debuggable if
                              it ever happens anyway. */}
                          {tagsById.get(tagId)?.name ?? tagId}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {post.status === "published" && post.publishedAt
                    ? DATE_FORMAT.format(post.publishedAt)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <Link
                          to="/posts/$postId"
                          params={{ postId: post._id }}
                        />
                      }
                      nativeButton={false}
                    >
                      Éditer
                    </Button>
                    {canPublish &&
                      (post.status === "published" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            withPending(post._id, () =>
                              unpublishPost({ id: post._id })
                            )
                          }
                        >
                          Dépublier
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            withPending(post._id, () =>
                              publishPost({ id: post._id })
                            )
                          }
                        >
                          Publier
                        </Button>
                      ))}
                    {(canPublish || isOwn) && (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={pending}
                            />
                          }
                        >
                          Supprimer
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Supprimer « {post.title} » ?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {post.status === "published"
                                ? "Cet article est publié : il disparaîtra du blog une fois l'invalidation propagée. Cette action est irréversible."
                                : "Ce brouillon sera supprimé définitivement. Cette action est irréversible."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                withPending(post._id, () =>
                                  removePost({ id: post._id })
                                )
                              }
                            >
                              Supprimer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function CreatePostDialog() {
  const createPost = useMutation(api.posts.create)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTitle("")
      setSlug("")
      setError(null)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const id = await createPost({ title, slug })
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
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="post-slug">Slug</FieldLabel>
              <Input
                id="post-slug"
                autoComplete="off"
                required
                placeholder="mon-premier-article"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
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
              title.trim().length === 0 ||
              slug.trim().length === 0
            }
          >
            {submitting ? "Création…" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
