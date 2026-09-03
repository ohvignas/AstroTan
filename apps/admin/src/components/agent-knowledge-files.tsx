import { useRef, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  ALLOWED_KNOWLEDGE_MIME_TYPES,
  MAX_MEDIA_SIZE_BYTES,
} from "@astrotan/backend/convex/content"
import { AgentKnowledgeFileRow } from "@/components/agent-knowledge-file-row"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"

const ACCEPT = [...ALLOWED_KNOWLEDGE_MIME_TYPES, ".md", ".txt", ".pdf", ".docx"].join(",")

function inferClientMime(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown"
  return "text/plain"
}

function isKnowledgeMedia(item: { filename: string; mime: string }): boolean {
  if ((ALLOWED_KNOWLEDGE_MIME_TYPES as readonly string[]).includes(item.mime)) return true
  return /\.(md|txt|markdown|pdf|docx)$/i.test(item.filename)
}

export function AgentKnowledgeFiles({ disabled }: { disabled: boolean }) {
  const files = useQuery(api.agentKnowledge.list, {})
  const media = useQuery(api.media.list, {})
  const generateUploadUrl = useMutation(api.agentKnowledge.generateUploadUrl)
  const attach = useMutation(api.agentKnowledge.attach)
  const remove = useMutation(api.agentKnowledge.remove)
  const reindexFile = useMutation(api.agentKnowledge.reindexFile)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPick(list: FileList | null) {
    const file = list?.[0]
    if (!file || disabled) return
    setError(null)
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      setError("Ce fichier est trop volumineux (maximum 10 Mo).")
      return
    }
    setBusy(true)
    try {
      const uploadUrl = await generateUploadUrl()
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      if (!response.ok) throw new Error("upload")
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> }
      await attach({
        storageId,
        filename: file.name,
        mimeType: file.type || inferClientMime(file.name),
        size: file.size,
      })
    } catch {
      setError("Impossible d'ajouter ce fichier.")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <Field>
      {files === undefined ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document pour l'instant.</p>
      ) : (
        <ul className="grid gap-2">
          {files.map((file) => (
            <AgentKnowledgeFileRow
              key={file._id}
              file={file}
              disabled={disabled}
              busy={busy}
              onRemove={() => void remove({ id: file._id })}
              onReindex={() => void reindexFile({ id: file._id })}
            />
          ))}
        </ul>
      )}
      {!disabled ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => void onPick(event.target.files)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "Téléversement…" : "Ajouter un fichier"}
            </Button>
          </div>
          {media
            ?.filter(
              (item) =>
                isKnowledgeMedia(item) && !files?.some((file) => file.storageId === item.storageId),
            )
            .map((item) => (
              <Button
                key={item._id}
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void attach({
                    storageId: item.storageId,
                    filename: item.filename,
                    mimeType: item.mime,
                    size: item.size,
                    mediaId: item._id,
                  })
                }
              >
                Lier {item.filename}
              </Button>
            ))}
        </>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </Field>
  )
}
