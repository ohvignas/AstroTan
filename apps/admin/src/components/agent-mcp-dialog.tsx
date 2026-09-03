import { useState } from "react"
import { useAction, useMutation } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { MAX_MCP_AUTHORIZE_URL, MAX_MCP_SERVER_NAME, MAX_MCP_SERVER_URL } from "@astrotan/backend/convex/content"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  inferMcpTransport,
  listenMcpOAuthPopup,
  needsMcpOAuth,
  openMcpAuthorizePopup,
  resolveAuthorizeUrl,
} from "@/lib/mcpAuthorize"

const OAUTH_REFUSED =
  "L'autorisation a été refusée. Réessayez « Ouvrir la connexion »."

export function AgentMcpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useMutation(api.mcpServers.create)
  const setHeaders = useAction(api.mcpServers.setHeaders)
  const beginAuthorize = useAction(api.mcpOAuth.beginAuthorize)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [authorizeUrl, setAuthorizeUrl] = useState("")
  const [bearer, setBearer] = useState("")
  const [draftId, setDraftId] = useState<Id<"mcpServers"> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName("")
    setUrl("")
    setAuthorizeUrl("")
    setBearer("")
    setDraftId(null)
    setBusy(false)
    setError(null)
  }

  async function ensureServer(): Promise<Id<"mcpServers">> {
    if (draftId) return draftId
    const id = await create({
      name,
      transport: inferMcpTransport(url),
      url,
      authorizeUrl: authorizeUrl.trim() || undefined,
    })
    setDraftId(id)
    return id
  }

  function launchAuthorize(target: string) {
    const popup = openMcpAuthorizePopup(target)
    if (popup === null) {
      window.location.assign(target)
      return
    }
    const stop = listenMcpOAuthPopup((ok) => {
      stop()
      if (ok) {
        onOpenChange(false)
        reset()
      } else {
        setError(OAUTH_REFUSED)
      }
    })
  }

  async function handleOpenConnect() {
    setError(null)
    if (!needsMcpOAuth(url, authorizeUrl)) {
      const target = resolveAuthorizeUrl(url, authorizeUrl)
      if (target) openMcpAuthorizePopup(target)
      return
    }
    if (name.trim().length === 0 || url.trim().length === 0) {
      setError("Indiquez un nom et l'URL du serveur avant d'ouvrir la connexion.")
      return
    }
    setBusy(true)
    try {
      const { url: target } = await beginAuthorize({ id: await ensureServer() })
      launchAuthorize(target)
    } catch {
      setError(OAUTH_REFUSED)
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd() {
    setError(null)
    setBusy(true)
    try {
      const id = await ensureServer()
      if (bearer.trim()) {
        await setHeaders({
          id,
          headersJson: JSON.stringify({ Authorization: `Bearer ${bearer.trim()}` }),
        })
      }
      onOpenChange(false)
      reset()
    } catch {
      setError("Ce serveur a été refusé. Utilisez une URL https, ou http://localhost.")
      setBusy(false)
    }
  }

  const oauth = needsMcpOAuth(url, authorizeUrl)
  const canOpen = oauth
    ? name.trim().length > 0 && url.trim().length > 0
    : resolveAuthorizeUrl(url, authorizeUrl) !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un connecteur</DialogTitle>
          <DialogDescription>Serveur MCP distant.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="mcp-name">Nom</FieldLabel>
            <Input id="mcp-name" value={name} maxLength={MAX_MCP_SERVER_NAME} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-url">URL du serveur</FieldLabel>
            <Input id="mcp-url" value={url} maxLength={MAX_MCP_SERVER_URL} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-authorize">URL d'autorisation (optionnel)</FieldLabel>
            <Input id="mcp-authorize" value={authorizeUrl} maxLength={MAX_MCP_AUTHORIZE_URL} onChange={(e) => setAuthorizeUrl(e.target.value)} />
            <p className="text-muted-foreground text-sm">
              Si vide, l'autorisation OAuth est découverte depuis l'URL du serveur.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy || !canOpen}
              onClick={() => void handleOpenConnect()}
            >
              Ouvrir la connexion
            </Button>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-bearer">Jeton Bearer (optionnel, chiffré, jamais relu)</FieldLabel>
            <Input
              id="mcp-bearer"
              type="password"
              autoComplete="off"
              value={bearer}
              onChange={(event) => setBearer(event.target.value)}
            />
          </Field>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="min-h-11" />}>
            Annuler
          </DialogClose>
          <Button
            type="button"
            className="min-h-11"
            disabled={busy || name.trim().length === 0 || url.trim().length === 0}
            aria-busy={busy}
            onClick={() => void handleAdd()}
          >
            {busy ? "Ajout…" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
