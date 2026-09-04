import { Link } from "@tanstack/react-router"
import { PublicationStatusBadge } from "@/components/PublicationStatusBadge"
import { Button } from "@/components/ui/button"
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
import { ArrowLeftIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react"

export function PostEditorHeader({
  title,
  slug,
  status,
  publicationStatus,
  actions,
  busy,
  canDelete,
  canRetryPropagation,
  onPreview,
  onPublish,
  onDiscard,
  onUnpublish,
  onRetry,
  onDelete,
}: {
  title: string
  slug: string
  status: "draft" | "published"
  publicationStatus: Parameters<typeof PublicationStatusBadge>[0]["status"]
  actions: {
    showPublish: boolean
    showDiscard: boolean
    showUnpublish: boolean
  }
  busy: boolean
  canDelete: boolean
  canRetryPropagation: boolean
  onPreview: () => void
  onPublish: () => void
  onDiscard: () => void
  onUnpublish: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  return (
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
          <h1 className="text-lg font-medium">{title}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>/blog/{slug}</span>
            <PublicationStatusBadge
              status={publicationStatus}
              pageStatus={status}
              onRetry={canRetryPropagation ? onRetry : undefined}
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
          onClick={onPreview}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Prévisualiser
        </Button>
        {actions.showPublish && (
          <Button type="button" size="sm" disabled={busy} onClick={onPublish}>
            Publier
          </Button>
        )}
        {actions.showDiscard && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onDiscard}
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
            onClick={onUnpublish}
          >
            Dépublier
          </Button>
        )}
        {canDelete && (
          <DeletePostButton
            title={title}
            published={status === "published"}
            onConfirm={onDelete}
          />
        )}
      </div>
    </div>
  )
}

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
