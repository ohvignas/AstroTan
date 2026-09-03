import { useRef, useState, type FormEvent } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { ALLOWED_MIME_TYPES, MAX_CHAT_FILE_BYTES, MAX_LEAD_BODY_LENGTH } from "@astrotan/backend/convex/content"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export async function uploadLeadChatFile(
  generateUploadUrl: () => Promise<string>,
  file: File,
): Promise<Id<"_storage">> {
  const uploadUrl = await generateUploadUrl()
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  })
  if (!uploaded.ok) throw new Error("upload")
  const payload = (await uploaded.json()) as { storageId?: Id<"_storage"> }
  if (!payload.storageId) throw new Error("upload")
  return payload.storageId
}

const MAX_LABEL = `${MAX_CHAT_FILE_BYTES / (1024 * 1024)} Mo`

function fileError(file: File): string | null {
  if (file.size > MAX_CHAT_FILE_BYTES) return `Ce fichier dépasse ${MAX_LABEL}.`
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Ce type de fichier n'est pas accepté. Envoyez une image (PNG, JPEG, WebP, AVIF ou GIF)."
  }
  return null
}

export function LeadChatComposer({
  body,
  pending,
  erreur,
  onBodyChange,
  onSubmit,
}: {
  body: string
  pending: boolean
  erreur: string | null
  onBodyChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; preview: string } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  function onPick(list: FileList | null) {
    const file = list?.[0]
    setLocalError(null)
    if (!file) {
      setPicked(null)
      return
    }
    const error = fileError(file)
    if (error) {
      setPicked(null)
      setLocalError(error)
      if (inputRef.current) inputRef.current.value = ""
      return
    }
    setPicked({ name: file.name, preview: URL.createObjectURL(file) })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event)
    setPicked(null)
    setLocalError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  const alert = localError ?? erreur
  const canSend = !pending && (body.trim().length > 0 || picked !== null)

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="staff-reply">
        Répondre
      </label>
      {picked ? (
        <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
          <img src={picked.preview} alt="" className="size-10 rounded object-cover" />
          <span className="min-w-0 flex-1 truncate text-xs">{picked.name}</span>
          <button
            type="button"
            className="text-muted-foreground"
            aria-label="Retirer le fichier"
            onClick={() => {
              setPicked(null)
              if (inputRef.current) inputRef.current.value = ""
            }}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          name="media"
          accept="image/*"
          className="hidden"
          disabled={pending}
          onChange={(event) => onPick(event.target.files)}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={pending}
          aria-label="Ajouter une image"
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon />
        </Button>
        <Textarea
          id="staff-reply"
          value={body}
          maxLength={MAX_LEAD_BODY_LENGTH}
          disabled={pending}
          placeholder="Écrire au visiteur…"
          onChange={(event) => onBodyChange(event.target.value)}
        />
      </div>
      {alert ? (
        <p className="text-sm text-destructive" role="alert">
          {alert}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={!canSend}>
        Envoyer
      </Button>
    </form>
  )
}
