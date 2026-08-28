import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { describeMediaError, formatFileSize } from "@/lib/media"
import {
  EditMediaDialog,
  MediaThumbnail,
  UploadMediaDialog,
} from "@/components/media-picker"
import type { MediaItem } from "@/components/media-picker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  LayoutGridIcon,
  ListIcon,
  UploadIcon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/media")({
  component: MediaLibraryPage,
})

// ---------------------------------------------------------------------
// The list view's table
//
// TanStack Table's first use in this dashboard, and the one CLAUDE.md
// earmarked for it: the pages and users lists are hand-written `<table>`s
// with no sorting, which is tolerable at their size and stops being so for
// a media library that grows one file at a time and is searched by "the
// big one I added last week".
//
// Only the sorting feature is registered. v9 has no global feature set —
// state and methods exist because a feature was named here — so an unused
// feature costs nothing and an unregistered one is a type error rather
// than a silent no-op. `sortFns` registers just the two built-ins the
// columns resolve to, which is what keeps the other four out of the
// bundle.
// ---------------------------------------------------------------------

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

const columnHelper = createColumnHelper<typeof features, MediaItem>()

const columns = columnHelper.columns([
  columnHelper.display({
    id: "preview",
    header: () => <span className="sr-only">Aperçu</span>,
    cell: ({ row }) => (
      <MediaThumbnail item={row.original} className="aspect-square w-12" />
    ),
  }),
  columnHelper.accessor("filename", {
    header: "Fichier",
    sortFn: "alphanumeric",
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>()}</span>
    ),
  }),
  columnHelper.accessor("alt", {
    header: "Texte alternatif",
    sortFn: "alphanumeric",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>()}</span>
    ),
  }),
  columnHelper.accessor("mime", {
    header: "Type",
    sortFn: "alphanumeric",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>()}</span>
    ),
  }),
  columnHelper.accessor("size", {
    header: "Taille",
    sortFn: "basic",
    // Sorted on the raw byte count, displayed formatted: sorting the
    // rendered string would put "9,9 ko" after "10 Mo".
    cell: ({ getValue }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatFileSize(getValue<number>())}
      </span>
    ),
  }),
  columnHelper.display({
    id: "dimensions",
    header: "Dimensions",
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {row.original.width !== undefined && row.original.height !== undefined
          ? `${row.original.width} × ${row.original.height}`
          : "—"}
      </span>
    ),
  }),
  columnHelper.accessor("_creationTime", {
    header: "Ajouté le",
    sortFn: "basic",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {new Date(getValue<number>()).toLocaleDateString("fr-FR")}
      </span>
    ),
  }),
  columnHelper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    // The cell renders a component that reads the profile itself rather
    // than closing over one. That keeps this whole column array at module
    // scope — a fresh `columns` array on every render invalidates the row models
    // built from it — and `api.profiles.me` is already subscribed by
    // `AppShell`, so the extra `useQuery` costs nothing.
    cell: ({ row }) => <MediaActions item={row.original} align="end" />,
  }),
])

// ---------------------------------------------------------------------

function MediaLibraryPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as `routes/_authed/pages/index.tsx`.
  const profile = useQuery(api.profiles.me)
  const media = useQuery(api.media.list)
  const [view, setView] = useState<"grid" | "list">("grid")
  const [uploadOpen, setUploadOpen] = useState(false)

  if (profile === undefined || media === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Médiathèque</h1>
          <p className="text-sm text-muted-foreground">
            {profile.role === "editor"
              ? "Vous voyez tous les fichiers, mais ne supprimez que ceux que vous avez téléversés."
              : "Les images du site : couvertures d'articles et images de partage."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Vue grille"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGridIcon />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Vue liste"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <ListIcon />
            </Button>
          </div>
          <Button onClick={() => setUploadOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            Téléverser
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {media.length === 0
              ? "Aucun fichier"
              : `${media.length} fichier${media.length > 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              La médiathèque est vide. Téléversez une première image — son texte
              alternatif est demandé dans le même formulaire.
            </p>
          ) : view === "grid" ? (
            <MediaGrid items={media} />
          ) : (
            <MediaTable items={media} />
          )}
        </CardContent>
      </Card>

      <UploadMediaDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}

function MediaGrid({ items }: { items: MediaItem[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <li
          key={item._id}
          className="flex flex-col gap-2 rounded-lg border border-border p-2"
        >
          <MediaThumbnail item={item} />
          <div className="flex flex-col gap-0.5 px-0.5">
            <span className="truncate text-sm font-medium" title={item.filename}>
              {item.filename}
            </span>
            <span
              className="truncate text-xs text-muted-foreground"
              title={item.alt}
            >
              {item.alt}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatFileSize(item.size)} · {item.mime}
              {item.width !== undefined && item.height !== undefined
                ? ` · ${item.width} × ${item.height}`
                : ""}
            </span>
          </div>
          <MediaActions item={item} align="start" />
        </li>
      ))}
    </ul>
  )
}

function MediaTable({ items }: { items: MediaItem[] }) {
  // `items` is passed straight through, deliberately: it is the array
  // `useQuery(api.media.list)` returned, and convex/react keeps that
  // reference stable between renders. Wrapping it in a fallback (`items ??
  // []`) or a `useMemo` would either be dead code or hand the table a new
  // array on every render, which invalidates the sorted row model built
  // from it.
  const table = useTable({ features, columns, data: items })

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ChevronsUpDownIcon className="size-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * The per-file controls, shared by both views.
 *
 * The delete button is hidden for a file an editor did not upload, and so
 * is the edit dialog's "replace the image" field. That is a courtesy and
 * nothing more: `media.remove` and `media.replaceFile` both call
 * `requireOwnDocument` and refuse the same call regardless of what
 * rendered.
 */
function MediaActions({
  item,
  align,
}: {
  item: MediaItem
  align: "start" | "end"
}) {
  const profile = useQuery(api.profiles.me)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // The same ownership question answers both: `media.remove` and
  // `media.replaceFile` each call `requireOwnDocument`, while
  // `media.update` (name and alt) is open to all three roles. So an editor
  // always gets the Modifier button, and only sees the "replace the image"
  // field inside it for a file they uploaded.
  const ownsOrOutranks =
    profile !== undefined &&
    (profile.role === "owner" ||
      profile.role === "admin" ||
      item.createdBy === profile.authUserId)

  return (
    <div
      className={`flex gap-2 ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        Modifier
      </Button>
      {ownsOrOutranks && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteOpen(true)}
        >
          Supprimer
        </Button>
      )}

      <EditMediaDialog
        item={item}
        open={editOpen}
        onOpenChange={setEditOpen}
        canReplaceFile={ownsOrOutranks}
      />
      <DeleteMediaDialog
        item={item}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}

/**
 * Confirm a deletion, and stay open when the server refuses it.
 *
 * `media.remove` throws `MEDIA_IN_USE` when a page's `seo.ogImageId` or a
 * post's `coverId` still points at the file. That refusal is the most
 * useful thing this dialog ever says, so the confirm button is a plain
 * `<Button>` rather than an `AlertDialogAction`: the latter closes the
 * dialog on click, which would take the message down with it and leave the
 * operator watching a file that simply did not disappear.
 */
function DeleteMediaDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MediaItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const removeMedia = useMutation(api.media.remove)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  async function handleDelete() {
    setError(null)
    setSubmitting(true)
    try {
      await removeMedia({ id: item._id })
      handleOpenChange(false)
    } catch (err) {
      setError(describeMediaError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {item.filename} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            Le fichier et sa fiche sont supprimés définitivement. La suppression
            est refusée s'il est encore utilisé par une page ou un article.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={handleDelete}
          >
            {submitting ? "Suppression…" : "Supprimer"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
