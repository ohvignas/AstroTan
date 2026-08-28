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

export const Route = createFileRoute("/_authed/pages/")({
  component: PagesListPage,
})

type PageRow = FunctionReturnType<typeof api.pages.list>[number]

function PagesListPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as `routes/_authed/users.tsx`.
  const profile = useQuery(api.profiles.me)
  const pages = useQuery(api.pages.list)

  if (profile === undefined || pages === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // `pages.publishPage`/`pages.unpublish` refuse an editor server-side
  // regardless of this flag — this only controls whether the button
  // renders at all, the courtesy this task's own property statement
  // describes: "hiding a button is a courtesy to the operator, never the
  // enforcement."
  const canPublish = profile.role === "owner" || profile.role === "admin"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Pages</h1>
          <p className="text-sm text-muted-foreground">
            {profile.role === "editor"
              ? "Vous voyez toutes les pages, mais ne modifiez ou supprimez que les vôtres."
              : "Créer, éditer, prévisualiser et publier les pages du site."}
          </p>
        </div>
        <CreatePageDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Toutes les pages</CardTitle>
        </CardHeader>
        <CardContent>
          <PagesTable
            pages={pages}
            selfAuthUserId={profile.authUserId}
            canPublish={canPublish}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function PagesTable({
  pages,
  selfAuthUserId,
  canPublish,
}: {
  pages: PageRow[]
  selfAuthUserId: string
  canPublish: boolean
}) {
  const removePage = useMutation(api.pages.remove)
  const publishPage = useMutation(api.pages.publishPage)
  const unpublish = useMutation(api.pages.unpublish)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<Id<"pages"> | null>(null)

  if (pages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune page pour le moment.
      </p>
    )
  }

  async function withPending(id: Id<"pages">, run: () => Promise<unknown>) {
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
            <TableHead>Slug</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((page) => {
            const isOwn = page.createdBy === selfAuthUserId
            const pending = pendingId === page._id
            return (
              <TableRow key={page._id}>
                <TableCell className="font-medium">
                  <Link
                    to="/pages/$pageId"
                    params={{ pageId: page._id }}
                    className="hover:underline"
                  >
                    {page.title}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  /{page.slug}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      page.status === "published" ? "default" : "outline"
                    }
                  >
                    {page.status === "published" ? "Publiée" : "Brouillon"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <Link
                          to="/pages/$pageId"
                          params={{ pageId: page._id }}
                        />
                      }
                      nativeButton={false}
                    >
                      Éditer
                    </Button>
                    {canPublish &&
                      (page.status === "published" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            withPending(page._id, () =>
                              unpublish({ id: page._id })
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
                            withPending(page._id, () =>
                              publishPage({ id: page._id })
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
                              Supprimer « {page.title} » ?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {page.status === "published"
                                ? "Cette page est publiée : elle disparaîtra du site public une fois l'invalidation propagée. Cette action est irréversible."
                                : "Ce brouillon sera supprimé définitivement. Cette action est irréversible."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                withPending(page._id, () =>
                                  removePage({ id: page._id })
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

function CreatePageDialog() {
  const createPage = useMutation(api.pages.create)
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
      const id = await createPage({ title, slug })
      handleOpenChange(false)
      // Full navigation to the freshly-created page's own editor route,
      // rather than staying on this list — creating a page is only ever
      // step one of actually building it.
      window.location.assign(`/pages/${id}`)
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
        Nouvelle page
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle page</DialogTitle>
          <DialogDescription>
            Créée comme brouillon — vous rédigez le contenu et publiez ensuite.
          </DialogDescription>
        </DialogHeader>
        <form id="create-page-form" onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="page-title">Titre</FieldLabel>
              <Input
                id="page-title"
                autoComplete="off"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="page-slug">Slug</FieldLabel>
              <Input
                id="page-slug"
                autoComplete="off"
                required
                placeholder="a-propos"
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
            form="create-page-form"
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
