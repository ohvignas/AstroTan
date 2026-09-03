import { useState } from "react"
import { PlugIcon, Trash2Icon } from "lucide-react"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
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
        <div
          key={server._id}
          className="group relative flex min-h-11 items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-foreground/10"
        >
          <McpMark url={server.url} name={server.name} />
          <p className="max-w-36 truncate font-medium">{server.name}</p>
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute -top-1.5 -right-1.5 size-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              aria-label={`Retirer ${server.name}`}
              onClick={() => onRemove(server._id)}
            >
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      ))}
    </>
  )
}
