import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { PAGE_ERROR_MESSAGES, describePageError } from "@/lib/pageErrors"
import {
  ETAT_SLUG_INITIAL,
  saisirSlug,
  saisirTitre,
  slugDejaPris,
} from "@/lib/slugSync"
import type { EtatSlug } from "@/lib/slugSync"
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
  HomeIcon,
  PencilIcon,
  PlusIcon,
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Pages</h1>
          <p className="text-sm text-muted-foreground">
            {profile.role === "editor"
              ? "Vous voyez toutes les pages, mais ne modifiez ou supprimez que les vôtres."
              : "Créer, éditer, prévisualiser et publier les pages du site."}
          </p>
        </div>
        {/* Les slugs déjà pris, depuis la liste que cet écran a déjà
            chargée : le dialogue signale la collision AVANT le clic sur
            « Créer », sans souscrire une seconde query pour cela. */}
        <CreatePageDialog slugsExistants={pages.map((page) => page.slug)} />
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
            const pending = pendingId === page._id
            return (
              <TableRow key={page._id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    <Link
                      to="/pages/$pageId"
                      params={{ pageId: page._id }}
                      className="hover:underline"
                    >
                      {page.title}
                    </Link>
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
                  <PageRowActions
                    page={page}
                    canPublish={canPublish}
                    isOwn={isOwn}
                    pending={pending}
                    onPublish={() =>
                      withPending(page._id, () => publishPage({ id: page._id }))
                    }
                    onUnpublish={() =>
                      withPending(page._id, () => unpublish({ id: page._id }))
                    }
                    onDelete={() =>
                      withPending(page._id, () => removePage({ id: page._id }))
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
  page: PageRow
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

function CreatePageDialog({
  slugsExistants,
}: {
  slugsExistants: readonly string[]
}) {
  const createPage = useMutation(api.pages.create)
  const [open, setOpen] = useState(false)
  // Un seul état pour le couple titre/slug : le slug suit le titre tant
  // qu'on n'y a pas touché, et c'est une propriété du COUPLE, pas de l'un
  // ou l'autre. Deux `useState` indépendants auraient obligé à porter le
  // « a-t-on déjà édité le slug » dans un troisième, à côté des deux
  // valeurs qu'il décrit. Les règles vivent dans `lib/slugSync.ts`, où
  // elles sont testables sans DOM.
  const [etat, setEtat] = useState<EtatSlug>(ETAT_SLUG_INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dejaPris = slugDejaPris(etat.slug, slugsExistants)

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
      const id = await createPage({ title: etat.titre, slug: etat.slug })
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
          {/* Ce que la phrase précédente ne disait pas assez fort : ce
              dialogue n'écrit RIEN dans `apps/web`. Elle annonçait « elle
              ne s'affichera que lorsque son fichier existera », ce qui est
              vrai et se lit comme une promesse que quelque chose va
              apparaître. Elle omettait aussi la publication, qui est
              l'autre condition. */}
          <DialogDescription>
            Crée la fiche, pas le fichier. La page s'affichera une fois
            publiée, si <code>{"src/pages/<slug>.astro"}</code> existe.
          </DialogDescription>
        </DialogHeader>
        <form id="create-page-form" onSubmit={handleSubmit} noValidate>
          <CorpsNouvellePage
            etat={etat}
            dejaPris={dejaPris}
            error={error}
            onTitre={(titre) => setEtat((actuel) => saisirTitre(actuel, titre))}
            onSlug={(slug) => setEtat((actuel) => saisirSlug(actuel, slug))}
          />
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
              etat.titre.trim().length === 0 ||
              etat.slug.trim().length === 0 ||
              dejaPris
            }
          >
            {submitting ? "Création…" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Les deux champs du dialogue, pilotés de l'extérieur.
 *
 * Séparé du dialogue pour être rendu seul dans un test : `vitest.config.ts`
 * est en `environment: "node"` et rend avec `renderToStaticMarkup`, sans
 * DOM ni interaction. Ce composant-ci est ce qui relie l'état calculé par
 * `lib/slugSync.ts` à ce que l'opérateur voit — le maillon qu'un test de
 * fonction pure ne couvre pas.
 */
export function CorpsNouvellePage({
  etat,
  dejaPris,
  error,
  onTitre,
  onSlug,
}: {
  etat: EtatSlug
  dejaPris: boolean
  error: string | null
  onTitre: (titre: string) => void
  onSlug: (slug: string) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="page-title">Titre</FieldLabel>
        <Input
          id="page-title"
          autoComplete="off"
          required
          value={etat.titre}
          onChange={(event) => onTitre(event.target.value)}
        />
      </Field>
      <Field data-invalid={dejaPris || undefined}>
        <FieldLabel htmlFor="page-slug">Slug</FieldLabel>
        <Input
          id="page-slug"
          autoComplete="off"
          required
          placeholder="a-propos"
          aria-invalid={dejaPris || undefined}
          value={etat.slug}
          onChange={(event) => onSlug(event.target.value)}
        />
        {/* Le refus que `pages.create` prononcerait, dit avant le clic :
            le champ se remplit désormais tout seul, ce qui rend deux pages
            « Contact » plus faciles à tenter qu'avant. Même phrase que le
            refus serveur, prise à la même source. */}
        {dejaPris && (
          <FieldError>{PAGE_ERROR_MESSAGES.SLUG_ALREADY_EXISTS}</FieldError>
        )}
      </Field>
      {error && <FieldError>{error}</FieldError>}
    </FieldGroup>
  )
}
