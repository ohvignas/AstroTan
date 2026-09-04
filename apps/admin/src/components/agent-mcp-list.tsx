import { useState } from "react"
import { PlugIcon } from "lucide-react"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { AgentConnectorCard } from "@/components/agent-connector-card"
import { Button } from "@/components/ui/button"
import { mcpConnectorSubtitle } from "@/lib/mcpAuthorize"
import { faviconCandidates } from "@/lib/mcpFavicon"

export type McpServerRow = {
  _id: Id<"mcpServers">
  name: string
  url: string
  authorizeUrl?: string | null
  enabled: boolean
  headersConfigured: boolean
}

function McpMark({ url, name }: { url: string; name: string }) {
  const candidates = faviconCandidates(url)
  const [step, setStep] = useState(0)
  const src = candidates[step]
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-foreground/10">
      {src ? (
        <img
          src={src}
          width={20}
          height={20}
          alt=""
          onError={() => setStep((current) => current + 1)}
        />
      ) : (
        <PlugIcon className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  )
}

export function AgentMcpList({
  canWrite,
  servers,
  onRemove,
}: {
  canWrite: boolean
  servers: McpServerRow[] | undefined
  onRemove: (id: Id<"mcpServers">) => void
}) {
  if (servers === undefined || servers.length === 0) return null
  return (
    <>
      {servers.map((server) => (
        <AgentConnectorCard
          key={server._id}
          mark={<McpMark url={server.url} name={server.name} />}
          title={server.name}
          subtitle={mcpConnectorSubtitle(server)}
          action={
            canWrite ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 shrink-0"
                onClick={() => onRemove(server._id)}
              >
                Déconnecter
              </Button>
            ) : null
          }
        />
      ))}
    </>
  )
}
