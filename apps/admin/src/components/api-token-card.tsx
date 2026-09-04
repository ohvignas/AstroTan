import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { mcpSnippet } from "@/lib/mcpSnippet"
import { CopyButton } from "@/components/copy-button"
import { SettingsGroup } from "@/components/settings-nav"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const API_TOKEN_HEX_LENGTH = 64

export function maskApiToken(last3: string | null | undefined): string {
  if (!last3) return "*".repeat(API_TOKEN_HEX_LENGTH)
  return "*".repeat(API_TOKEN_HEX_LENGTH - last3.length) + last3
}

export function ApiTokenCard({ canWrite }: { canWrite: boolean }) {
  const status = useQuery(api.apiTokens.status, canWrite ? {} : "skip")
  const generate = useMutation(api.apiTokens.generate)
  const revoke = useMutation(api.apiTokens.revoke)
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? ""
  const docsUrl = `${siteUrl.replace(/\/+$/, "")}/api/v1/docs`
  const snippet = mcpSnippet(siteUrl)

  async function onGenerate() {
    setBusy(true)
    try {
      const out = await generate({})
      setShown(out.token)
    } finally {
      setBusy(false)
    }
  }

  async function onRevoke() {
    setBusy(true)
    try {
      await revoke({})
      setShown(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup>
      <Field>
        <FieldLabel>Jeton d'API</FieldLabel>
        {shown ? (
          <Input
            readOnly
            value={shown}
            className="font-mono text-xs tabular-nums"
            aria-label="Jeton d'API"
          />
        ) : status?.configured ? (
          <Input
            readOnly
            value={maskApiToken(status.last3)}
            className="font-mono text-xs tabular-nums"
            aria-label="Jeton d'API (masqué)"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucun jeton. Générez-en un pour Make, n8n ou le MCP.
          </p>
        )}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void onGenerate()}>
              {status?.configured ? "Remplacer le jeton" : "Générer un jeton"}
            </Button>
            {status?.configured ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onRevoke()}
              >
                Révoquer
              </Button>
            ) : null}
          </div>
        ) : null}
        <FieldDescription>
          Montré une fois en entier. Ensuite, seuls les 3 derniers
          caractères restent visibles.{" "}
          <a href={docsUrl} className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Documentation OpenAPI / Swagger
          </a>
          .
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="mcp-snippet">Snippet MCP</FieldLabel>
        <div className="relative">
          <textarea
            id="mcp-snippet"
            readOnly
            rows={12}
            className="w-full rounded-md border border-input bg-muted/40 p-2 pr-8 font-mono text-xs"
            value={snippet}
          />
          <CopyButton
            value={snippet}
            label="Copier le snippet"
            className="absolute top-1.5 right-1.5 z-10 bg-muted/80"
            iconClassName="size-3.5"
            size="icon-xs"
          />
        </div>
        <FieldDescription>
          Collez-le dans la config MCP du client (Claude, ChatGPT, etc.).
          ASTROTAN_API_TOKEN se remplace par le jeton montré une fois —
          jamais commité.
        </FieldDescription>
      </Field>
    </SettingsGroup>
  )
}
