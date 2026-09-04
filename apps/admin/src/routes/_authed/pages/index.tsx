import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { describePageError } from "@/lib/pageErrors"
import { RowActionButton, RowActionsMenu } from "@/components/row-actions"
import { Badge } from "@/components/ui/badge"
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
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
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
  HomeIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/pages/")({
  component: PagesListPage,
})

type PageRow = FunctionReturnType<typeof api.pages.list>[number]

function PagesListPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as `routes/_authed/users.tsx`.
  const profile = useQuery(api.profiles.me)
  const pages = useQuery(api.pages.list)
  // Read here only to *mark* the home page in the list. Choosing one lives
  // in `/settings` and nowhere else: it is a statement about the site, not
  // about a page, and two pages could otherwise both claim it.
  const homePageSlug = useQuery(api.settings.homePageSlug)

  if (
    profile === undefined ||
    pages === undefined ||
    homePageSlug === undefined
  ) {
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
      <div>
        <h1 className="text-lg font-medium">Pages</h1>
        <p className="text-sm text-muted-foreground">
          {profile.role === "editor"
            ? "Vous voyez toutes les pages du site, mais ne modifiez ou supprimez que les vôtres."
            : "Toutes les pages du site. Un agent écrit le fichier ; ici on publie et on règle le SEO."}
        </p>
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
            homePageSlug={homePageSlug}
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
  homePageSlug,
}: {
  pages: PageRow[]
  selfAuthUserId: string
  canPublish: boolean
  homePageSlug: string | null
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
            <TableHead>Chemin</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((page) => {
            const isOwn = page.createdBy === selfAuthUserId
            const pending = page._id !== null && pendingId === page._id
            return (
              <TableRow key={page._id ?? `missing:${page.slug}`}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {page._id === null ? (
                      <span>{page.title}</span>
                    ) : (
                    <Link
                      to="/pages/$pageId"
                      params={{ pageId: page._id }}
                      className="hover:underline"
                    >
                      {page.title}
                    </Link>
                    )}
                    {page.missingRow && (
                      <span
                        title="Le fichier existe, la fiche Convex n'a pas encore été créée. Un agent doit appeler pages.create avec ce slug."
                        className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                      >
                        <TriangleAlertIcon className="size-3" aria-hidden="true" />
                        Sans fiche
                      </span>
                    )}
                    {page.servedByRoute === false && (
                      <span
                        title="Aucun fichier de route ne sert ce chemin : la page rend 404 malgré son statut. Créez src/pages/<slug>.astro, ou supprimez cette ligne."
                        className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                      >
                        <TriangleAlertIcon className="size-3" aria-hidden="true" />
                        Sans fichier
                      </span>
                    )}
                    {page.slug === homePageSlug && (
                      <span
                        title="Page d'accueil : c'est elle que le site sert à /. Se change dans Réglages."
                        className="inline-flex text-muted-foreground"
                      >
                        <HomeIcon className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">
                          Page d'accueil, servie à /
                        </span>
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {page.path}
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
                  {page._id !== null && (
                  <PageRowActions
                    page={page}
                    canPublish={canPublish}
                    isOwn={isOwn}
                    pending={pending}
                    onPublish={() =>
                      withPending(page._id!, () => publishPage({ id: page._id! }))
                    }
                    onUnpublish={() =>
                      withPending(page._id!, () => unpublish({ id: page._id! }))
                    }
                    onDelete={() =>
                      withPending(page._id!, () => removePage({ id: page._id! }))
                    }
                  />
                  )}
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
 * Une action visible, le reste replié.
 *
 * Éditer est ce qu'on vient faire sur cette ligne, et reste donc à un
 * clic. Publier, dépublier et surtout supprimer passent derrière les trois
 * points : la suppression est irréversible et n'a rien à faire à côté du
 * geste courant.
 *
 * La confirmation est pilotée par état plutôt que par un
 * `AlertDialogTrigger` : le menu se ferme au clic sur une entrée, et
 * emporterait un déclencheur monté à l'intérieur avant qu'il n'ouvre quoi
 * que ce soit. Le dialogue est donc rendu en dehors du menu.
 */
function PageRowActions({
  page,
  canPublish,
  isOwn,
  pending,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  page: PageRow & { _id: NonNullable<PageRow["_id"]> }
  canPublish: boolean
  isOwn: boolean
  pending: boolean
  onPublish: () => void
  onUnpublish: () => void
  onDelete: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Un éditeur qui ne possède pas la page n'a aucune entrée à voir : le
  // bouton trois points ne se rend alors pas du tout, plutôt que d'ouvrir
  // un menu vide. `canPublish` implique `canDelete`, d'où la seule
  // condition.
  const canDelete = canPublish || isOwn

  return (
    <div className="flex items-center justify-end gap-1">
      <RowActionButton
        label={`Éditer la page ${page.title}`}
        tooltip="Éditer"
        render={<Link to="/pages/$pageId" params={{ pageId: page._id }} />}
        nativeButton={false}
      >
        <PencilIcon />
      </RowActionButton>

      {canDelete && (
        <RowActionsMenu label={`Autres actions pour la page ${page.title}`}>
          {canPublish &&
            (page.status === "published" ? (
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
              <AlertDialogTitle>Supprimer « {page.title} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                {page.status === "published"
                  ? "Cette page est publiée : elle disparaîtra du site public une fois l'invalidation propagée. Cette action est irréversible."
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
