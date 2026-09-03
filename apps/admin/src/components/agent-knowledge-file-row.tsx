import { useRef, useState } from "react"
import { Check, Eye, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { knowledgeFileStatusModel } from "@/lib/knowledgeProgressPercent"
import { RowActionButton } from "@/components/row-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type KnowledgeFileRow = {
  _id: string
  filename: string
  extractedMarkdown: string
  extractError?: string
  indexStatus?: "pending" | "indexed" | "error"
  ocrPage?: number
  ocrTotal?: number
}

export function canViewKnowledgeMarkdown(file: KnowledgeFileRow): boolean {
  return file.extractedMarkdown.trim().length > 0
}

export function isKnowledgeOcrInProgress(file: KnowledgeFileRow): boolean {
  return (
    !file.extractError &&
    typeof file.ocrTotal === "number" &&
    file.ocrTotal > 0 &&
    (file.ocrPage ?? 0) < file.ocrTotal
  )
}

export function canReindexKnowledgeFile(file: KnowledgeFileRow): boolean {
  if (isKnowledgeOcrInProgress(file)) return false
  return Boolean(file.extractError) || file.extractedMarkdown.trim().length > 0
}

function KnowledgeFileStatus({ file }: { file: KnowledgeFileRow }) {
  const heldPercent = useRef<number | null>(null)
  const status = knowledgeFileStatusModel(file, heldPercent.current)
  heldPercent.current = status.nextHeld

  if (status.kind === "indexed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600">
        <Check className="size-3.5" aria-hidden />
        {status.label}
      </span>
    )
  }

  if (status.kind === "working") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {status.label}
      </span>
    )
  }

  return (
    <span className="shrink-0 text-xs text-muted-foreground">{status.label}</span>
  )
}

export function AgentKnowledgeFileRow({
  file,
  disabled,
  busy,
  onRemove,
  onReindex,
}: {
  file: KnowledgeFileRow
  disabled: boolean
  busy: boolean
  onRemove: () => void
  onReindex: () => void
}) {
  const [open, setOpen] = useState(false)
  const canView = canViewKnowledgeMarkdown(file)
  const canReindex = canReindexKnowledgeFile(file)

  return (
    <li className="grid gap-1 rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{file.filename}</span>
        <KnowledgeFileStatus file={file} />
        <div className="flex shrink-0 items-center gap-0.5">
          <RowActionButton
            type="button"
            className="size-11"
            label={`Voir le markdown de ${file.filename}`}
            tooltip={
              canView ? "Voir le markdown" : (file.extractError ?? "Extraction en cours")
            }
            disabled={!canView}
            onClick={() => setOpen(true)}
          >
            <Eye />
          </RowActionButton>
          <RowActionButton
            type="button"
            className="size-11"
            label={`Réindexer ${file.filename}`}
            tooltip="Réindexer"
            disabled={disabled || busy || !canReindex}
            onClick={onReindex}
          >
            <RefreshCw />
          </RowActionButton>
          <RowActionButton
            type="button"
            className="size-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
            label={`Supprimer ${file.filename}`}
            tooltip="Supprimer"
            disabled={disabled || busy}
            onClick={onRemove}
          >
            <Trash2 />
          </RowActionButton>
        </div>
      </div>
      {file.extractError ? (
        <p className="text-xs text-destructive">{file.extractError}</p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{file.filename}</DialogTitle>
            <DialogDescription>
              Texte extrait indexé pour l'agent.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {file.extractedMarkdown}
          </pre>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Fermer</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
