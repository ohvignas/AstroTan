import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Doc, Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadStatus,
} from "@astrotan/backend/convex/content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2Icon } from "lucide-react"

export const Route = createFileRoute("/_authed/leads")({
  component: LeadsPage,
})

// Le suivi des personnes qui ont écrit depuis le site.
//
// Un tableau à colonnes, pas une liste : ces fiches ont un cycle de vie —
// on répond, on qualifie, on gagne ou on perd — et une liste triée par date
// n'a pas d'endroit où poser cet état. Chaque colonne se lit du plus récent
// au plus ancien, l'ordre dans lequel on répond.
//
// Le glisser-déposer utilise l'API native du navigateur — aucune
// bibliothèque, aucun octet de plus. Il ne marche ni au clavier ni au
// doigt : c'est une limite de l'API, pas un oubli. Le sélecteur de chaque
// carte reste donc, non comme un doublon mais comme LE chemin pour qui
// n'a pas de souris. Retirer l'un des deux rendrait le tableau
// inutilisable pour quelqu'un.

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms))
}

function LeadsPage() {
  const board = useQuery(api.leads.board)
  const profile = useQuery(api.profiles.me)
  const move = useMutation(api.leads.move)
  const remove = useMutation(api.leads.remove)
  const [openLead, setOpenLead] = useState<Doc<"leads"> | null>(null)
  // La colonne actuellement survolée pendant un glissement. Sans ce retour
  // visuel, on lâche à l'aveugle et on découvre le résultat après coup.
  const [survolee, setSurvolee] = useState<LeadStatus | null>(null)

  // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
  // visiteur a écrit. L'interface masque, et la mutation revérifie.
  const canDelete = profile?.role === "owner" || profile?.role === "admin"

  if (board === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Chargement…</CardContent>
      </Card>
    )
  }

  const total = LEAD_STATUSES.reduce((sum, status) => sum + board[status].length, 0)

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {/* Un écran vide doit dire qu'il est vide, et pourquoi — sinon il
              ressemble à un écran cassé. */}
          Personne n'a encore écrit depuis le formulaire de contact. Les
          messages arriveront ici, le plus récent en tête.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          {total} {total > 1 ? "personnes" : "personne"}
        </p>
      </div>

      {/* Défilement horizontal plutôt que colonnes rétrécies : cinq colonnes
          sur un écran étroit donnent cinq bandes illisibles. */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {LEAD_STATUSES.map((status) => (
          <section
            key={status}
            className={`flex w-72 shrink-0 flex-col gap-3 rounded-lg p-1 transition-colors ${
              survolee === status ? "bg-accent" : ""
            }`}
            // `preventDefault` sur `dragOver` est ce qui autorise le dépôt :
            // sans lui le navigateur refuse le lâcher, et rien n'indique
            // pourquoi.
            onDragOver={(event) => {
              event.preventDefault()
              setSurvolee(status)
            }}
            onDragLeave={() => setSurvolee((s) => (s === status ? null : s))}
            onDrop={(event) => {
              event.preventDefault()
              setSurvolee(null)
              const id = event.dataTransfer.getData("text/plain") as Id<"leads">
              const from = event.dataTransfer.getData("application/x-lead-status")
              // Lâcher une carte dans sa propre colonne ne doit pas écrire :
              // ce serait une mutation pour rien, et une ligne d'historique
              // qui ne raconte rien.
              if (id && from !== status) void move({ id, status })
            }}
          >
            <header className="flex items-center justify-between px-1">
              <h2 className="text-sm font-medium">{LEAD_STATUS_LABELS[status]}</h2>
              <Badge variant="secondary" className="tabular-nums">
                {board[status].length}
              </Badge>
            </header>

            <div className="flex flex-col gap-2">
              {board[status].map((lead) => (
                <article
                  key={lead._id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", lead._id)
                    // Le statut d'origine voyage avec la carte : c'est ce
                    // qui permet à la colonne d'ignorer un dépôt sur
                    // elle-même sans relire le tableau.
                    event.dataTransfer.setData("application/x-lead-status", lead.status)
                    event.dataTransfer.effectAllowed = "move"
                  }}
                  className="cursor-grab rounded-lg border bg-card p-3 text-sm shadow-xs active:cursor-grabbing"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setOpenLead(lead)}
                  >
                    <p className="font-medium">{lead.name}</p>
                    <p className="truncate text-muted-foreground">{lead.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formatDate(lead.lastMessageAt)}
                      {lead.messageCount > 1 && ` · ${lead.messageCount} messages`}
                    </p>
                  </button>

                  <div className="mt-3 flex items-center gap-2">
                    <Select
                      value={lead.status}
                      onValueChange={(next) =>
                        void move({ id: lead._id, status: next as LeadStatus })
                      }
                    >
                      <SelectTrigger size="sm" className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STATUSES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {LEAD_STATUS_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Supprimer la fiche de ${lead.name}`}
                        onClick={() => void remove({ id: lead._id })}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <LeadMessages lead={openLead} onClose={() => setOpenLead(null)} />
    </div>
  )
}

function LeadMessages({
  lead,
  onClose,
}: {
  lead: Doc<"leads"> | null
  onClose: () => void
}) {
  // `"skip"` tant qu'aucune fiche n'est ouverte : sans lui, cette query
  // s'abonnerait en permanence pour un panneau que personne ne regarde.
  const messages = useQuery(
    api.leads.messages,
    lead === null ? "skip" : { id: lead._id as Id<"leads"> },
  )

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead?.name}</DialogTitle>
          <DialogDescription>
            <a href={`mailto:${lead?.email}`} className="underline">
              {lead?.email}
            </a>
          </DialogDescription>
        </DialogHeader>

        {messages === undefined ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <li key={message._id} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(message._creationTime)}
                </p>
                {message.subject && (
                  <p className="mt-1 font-medium">{message.subject}</p>
                )}
                {/* `whitespace-pre-wrap` : ce que la personne a écrit, avec
                    ses retours à la ligne. Le rendre en HTML serait accepter
                    du balisage venu d'un formulaire public. */}
                <p className="mt-2 whitespace-pre-wrap">{message.body}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}
