import { MAX_LEAD_BODY_LENGTH } from "@astrotan/backend/convex/content"
import { ArrowUpIcon, PlusIcon, XIcon } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group"
import { chatFileClientError } from "./chatFile"

export function ChatComposer({
  body,
  bodyError,
  pending,
  disabled,
  onBodyChange,
  onSubmit,
}: {
  body: string
  bodyError: string | null
  pending: boolean
  disabled?: boolean
  onBodyChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; preview: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  function onPick(list: FileList | null) {
    const file = list?.[0]
    setFileError(null)
    if (!file) {
      setPicked(null)
      return
    }
    const error = chatFileClientError(file)
    if (error) {
      setPicked(null)
      setFileError(error)
      if (imageInputRef.current) imageInputRef.current.value = ""
      return
    }
    setPicked({ name: file.name, preview: URL.createObjectURL(file) })
  }

  function clearFile() {
    setPicked(null)
    setFileError(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event)
    setPicked(null)
    setFileError(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const alert = fileError ?? bodyError

  return (
    <form className="w-full" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="chat-widget-body">
        Votre message
      </label>
      {picked ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border px-2 py-1.5">
          <img src={picked.preview} alt="" className="size-10 rounded object-cover" />
          <span className="min-w-0 flex-1 truncate text-xs">{picked.name}</span>
          <button
            type="button"
            className="text-muted-foreground"
            aria-label="Retirer le fichier"
            onClick={clearFile}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ) : null}
      <InputGroup className="border-input bg-muted shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-[oklch(0.708_0_0)] has-[[data-slot=input-group-control]:focus-visible]:ring-[oklch(0.708_0_0)]/40">
        <div className="h-14 w-full px-3 py-2.5">
          <textarea
            id="chat-widget-body"
            name="body"
            data-slot="input-group-control"
            rows={2}
            maxLength={MAX_LEAD_BODY_LENGTH}
            value={body}
            disabled={disabled}
            aria-invalid={alert ? true : undefined}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="Votre message"
            className="size-full resize-none bg-transparent text-sm outline-none focus-visible:outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <InputGroupAddon align="block-end" className="pt-1">
          <input
            ref={imageInputRef}
            type="file"
            name="media"
            accept="image/*"
            className="hidden"
            tabIndex={-1}
            disabled={disabled}
            aria-hidden="true"
            onChange={(event) => onPick(event.target.files)}
          />
          <InputGroupButton
            aria-label="Ajouter une image"
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => imageInputRef.current?.click()}
          >
            <PlusIcon />
          </InputGroupButton>
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            data-slot="chat-send"
            disabled={pending || disabled}
            className="ml-auto rounded-full"
            aria-label={pending ? "Envoi…" : "Envoyer"}
          >
            <ArrowUpIcon />
            <span className="sr-only">Envoyer</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <div className="sr-only" aria-hidden="true">
        <label>
          Site web
          <input type="text" name="site_web" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {alert ? (
        <span className="text-sm text-destructive" role="alert">
          {alert}
        </span>
      ) : null}
    </form>
  )
}
