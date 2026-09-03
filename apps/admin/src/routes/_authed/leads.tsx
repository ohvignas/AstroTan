import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Doc, Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  LEAD_STATUSES,
  LEAD_STATUS_EMPTY,
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
import { ColumnsIcon, ListIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CopyButton } from "@/components/copy-button"
import { CopyLeadContact } from "@/components/copy-lead-contact"
import { LeadChatPanel } from "@/components/lead-chat-panel"
import { LeadNouveauPastille } from "@/components/lead-nouveau-pastille"
import { LeadOnlineDot } from "@/components/lead-online-dot"
import { LeadSourceIcon } from "@/components/lead-source-icon"
import { countryFlag, formatLeadLocation, leadHeadline } from "@/lib/leadLocation"
import { leadOrigin } from "@/lib/leadOrigin"
import { RowActionButton } from "@/components/row-actions"
import { describeLeadError } from "@/lib/leadErrors"

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
// Le glisser-déposer passe par dnd-kit et non par l'API native du
// navigateur. L'API native ne coûtait aucun octet, mais elle ne connaît que
// la souris : ni clavier, ni doigt — donc ni téléphone ni tablette. Elle
// fabriquait aussi son fantôme de glissement à partir de la SÉLECTION de
// texte en cours, d'où l'impression que toute la page se soulevait ; il
// avait fallu une rustine (`setDragImage`) que le calque de dnd-kit rend
// inutile.
//
// Un seul et même geste sert donc tout le monde, et le sélecteur de statut
// que chaque carte portait — le chemin de secours de qui n'a pas de souris
// — a disparu avec sa raison d'être.

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
  const marquerVu = useMutation(api.leads.marquerVu)
  const [openLead, setOpenLead] = useState<Doc<"leads"> | null>(null)
  // Le refus du serveur, montré à l'écran. Sans lui, un déplacement rejeté
  // est indiscernable d'un geste raté.
  const [erreur, setErreur] = useState<string | null>(null)
  // La recherche filtre les DEUX vues. Un filtre qui ne s'appliquerait qu'à
  // l'une donnerait deux comptes différents pour la même requête.
  const [recherche, setRecherche] = useState("")
  const [vue, setVue] = useState<"tableau" | "liste">("tableau")

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

  // Le filtre est appliqué ici, une fois, et les deux vues lisent son
  // résultat. Sur le nom ET l'email : on cherche une personne, et on se
  // souvient de l'un ou de l'autre.
  const requete = recherche.trim().toLowerCase()
  const filtre = (lead: Doc<"leads">) =>
    requete === "" ||
    lead.name.toLowerCase().includes(requete) ||
    (lead.email ?? "").toLowerCase().includes(requete) ||
    (lead.ip ?? "").toLowerCase().includes(requete) ||
    (lead.phone ?? "").toLowerCase().includes(requete)

  const colonnes = Object.fromEntries(
    LEAD_STATUSES.map((status) => [status, board[status].filter(filtre)]),
  ) as Record<LeadStatus, Doc<"leads">[]>

  // La liste, tous statuts confondus, du plus récent au plus ancien : c'est
  // l'ordre dans lequel on répond, et la seule raison d'ouvrir cette vue.
  const liste = LEAD_STATUSES.flatMap((status) => colonnes[status]).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  )

  const total = LEAD_STATUSES.reduce((sum, status) => sum + colonnes[status].length, 0)

  function ouvrirFiche(lead: Doc<"leads">) {
    // La fiche d'abord. Marquer vu est un à-côté : s'il échoue (timeout
    // d'auth, réseau), le dialogue reste ouvert. On n'affiche rien —
    // « déplacement » n'est pas ce geste, et un bandeau rouge ferait
    // croire que l'ouverture a échoué.
    setOpenLead(lead)
    void marquerVu({ id: lead._id }).catch(() => undefined)
  }

  /**
   * Le dépôt : une carte relâchée sur une colonne.
   *
   * Une seule fonction, appelée par la colonne qui a reçu le `drop`. Il n'y
   * a plus de capteurs, plus de détection de collision, plus d'état de
   * glissement à remettre à zéro — le navigateur tient tout ça, et il le
   * tient sans que nous ayons à le réparer.
   */
  function deposer(id: Id<"leads">, status: LeadStatus) {
    const lead = liste.find((l) => l._id === id)
    // Reposer une carte dans sa propre colonne n'écrit pas : ce serait une
    // mutation pour rien, et une ligne d'historique qui ne raconte rien.
    if (!lead || lead.status === status) return
    setErreur(null)
    move({ id, status }).catch((err: unknown) => setErreur(describeLeadError(err, "move")))
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          {total} {total > 1 ? "personnes" : "personne"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un nom, un email ou une IP"
            aria-label="Rechercher une fiche"
            className="pl-8"
          />
        </div>

        {/* Poussé à droite : la recherche prend la place disponible, la
            bascule reste où l'œil la cherche, contre le bord. */}
        {/* Deux boutons plutôt qu'un interrupteur : `aria-pressed` dit
            laquelle est active, et l'état se lit sans avoir à deviner ce
            que bascule un unique bouton. */}
        <div className="ml-auto flex gap-1 rounded-lg border p-1">
          {(["tableau", "liste"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={vue === v ? "secondary" : "ghost"}
              aria-pressed={vue === v}
              onClick={() => setVue(v)}
            >
              {v === "tableau" ? (
                <ColumnsIcon data-icon="inline-start" />
              ) : (
                <ListIcon data-icon="inline-start" />
              )}
              {v === "tableau" ? "Tableau" : "Liste"}
            </Button>
          ))}
        </div>
      </div>

      {erreur !== null && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {erreur}
        </p>
      )}

      {vue === "liste" ? (
        <ListeLeads
          leads={liste}
          canDelete={canDelete}
          onOpen={ouvrirFiche}
          onMove={(id, status) =>
            move({ id, status }).catch((err: unknown) => setErreur(describeLeadError(err, "move")))
          }
          onRemove={(id) =>
            remove({ id }).catch((err: unknown) => setErreur(describeLeadError(err, "remove")))
          }
        />
      ) : (
        // Défilement horizontal plutôt que colonnes rétrécies : cinq
        // colonnes sur un écran étroit donnent cinq bandes illisibles.
        <div className="flex gap-4 overflow-x-auto pb-2">
          {LEAD_STATUSES.map((status) => (
            <ColonneLeads
              key={status}
              status={status}
              leads={colonnes[status]}
              canDelete={canDelete}
              onOpen={ouvrirFiche}
              onDeposer={deposer}
              onRemove={(id) =>
                remove({ id }).catch((err: unknown) => setErreur(describeLeadError(err, "remove")))
              }
            />
          ))}
        </div>
      )}

      <LeadMessages
        lead={
          openLead === null
            ? null
            : (liste.find((item) => item._id === openLead._id) ?? openLead)
        }
        onClose={() => setOpenLead(null)}
      />
    </div>
  )
}

function ColonneLeads({
  status,
  leads,
  canDelete,
  onOpen,
  onRemove,
  onDeposer,
}: {
  status: LeadStatus
  leads: Doc<"leads">[]
  canDelete: boolean
  onOpen: (lead: Doc<"leads">) => void
  onRemove: (id: Id<"leads">) => void
  onDeposer: (id: Id<"leads">, status: LeadStatus) => void
}) {
  // Le survol est local à la colonne : pas d'état remonté, donc pas de
  // re-rendu du tableau entier à chaque mouvement de souris.
  const [survolee, setSurvolee] = useState(false)

  return (
    <section
      // `onDragOver` DOIT appeler `preventDefault`. Sans cet appel, la zone
      // n'est pas considérée comme une cible valide et `onDrop` n'est
      // JAMAIS émis — le navigateur ramène la carte à sa place. C'est
      // l'erreur numéro un de cette API, et elle ne produit aucun message.
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        if (!survolee) setSurvolee(true)
      }}
      // `relatedTarget` : sans ce test, passer au-dessus d'une carte ENFANT
      // émet un `dragleave` sur la colonne et le surlignage clignote.
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvolee(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setSurvolee(false)
        const id = e.dataTransfer.getData("text/plain")
        if (id) onDeposer(id as Id<"leads">, status)
      }}
      className={`flex w-72 shrink-0 flex-col gap-3 rounded-lg p-1 transition-colors ${
        survolee ? "bg-accent" : ""
      }`}
    >
      <header className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">{LEAD_STATUS_LABELS[status]}</h2>
        <Badge variant="secondary" className="tabular-nums">
          {leads.length}
        </Badge>
      </header>

      <div className="flex flex-col gap-2">
        {leads.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {LEAD_STATUS_EMPTY[status]}
          </p>
        ) : (
          leads.map((lead) => (
            <CarteLead
              key={lead._id}
              lead={lead}
              canDelete={canDelete}
              onOpen={() => onOpen(lead)}
              onRemove={() => onRemove(lead._id)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function CarteLead({
  lead,
  canDelete,
  onOpen,
  onRemove,
}: {
  lead: Doc<"leads">
  canDelete: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const [enVol, setEnVol] = useState(false)

  return (
    // Glisser-déposer natif du navigateur, après trois tentatives infructueuses
    // avec dnd-kit.
    //
    // Ce que la bibliothèque apportait — le clavier et le tactile — est
    // désormais porté par la vue Liste et son sélecteur de statut, qui
    // fonctionne à la souris, au clavier et au doigt. Le glissement n'a donc
    // plus qu'un seul public à servir, celui de la souris, et l'API native le
    // fait sans code d'orchestration, sans capteurs, sans détection de
    // collision et sans état à remettre à zéro. Toute une classe de défauts
    // disparaît avec ce code.
    //
    // `select-none` : sans lui, un glissement commencé sur du texte démarre
    // une sélection, et le navigateur emporte cette sélection comme image de
    // glissement au lieu de la carte.
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead._id)
        e.dataTransfer.effectAllowed = "move"
        // L'image par défaut serait la carte au moment du clic, curseur
        // compris. `setDragImage` sur la carte elle-même, avec le décalage
        // du point saisi, la fait suivre le curseur là où on l'a prise.
        const rect = e.currentTarget.getBoundingClientRect()
        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - rect.left, e.clientY - rect.top)
        setEnVol(true)
      }}
      onDragEnd={() => setEnVol(false)}
      className={`cursor-grab select-none rounded-lg border bg-card p-3 text-sm shadow-xs active:cursor-grabbing ${
        enVol ? "opacity-40" : ""
      }`}
    >
      <ContenuCarte lead={lead} canDelete={canDelete} onOpen={onOpen} onRemove={onRemove} />
    </article>
  )
}

function ContenuCarte({
  lead,
  canDelete,
  onOpen,
  onRemove,
}: {
  lead: Doc<"leads">
  canDelete: boolean
  onOpen?: () => void
  onRemove?: () => void
}) {
  const location = formatLeadLocation(lead)
  const origin = leadOrigin(lead)

  return (
    <div className="flex items-start gap-1">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={onOpen === undefined}
        onClick={onOpen}
      >
        <p className="flex items-center gap-1.5 font-medium">
          <LeadSourceIcon source={origin} />
          {origin === "chat" ? <LeadOnlineDot lastSeenAt={lead.visitorLastSeenAt} /> : null}
          {countryFlag(lead.country) ? (
            <span aria-hidden="true">{countryFlag(lead.country)}</span>
          ) : null}
          <span className="min-w-0 truncate">{leadHeadline(lead)}</span>
          <LeadNouveauPastille seenAt={lead.seenAt} />
        </p>
        {lead.email ? (
          <p className="truncate text-muted-foreground">{lead.email}</p>
        ) : null}
        {lead.phone && (
          <p className="truncate text-muted-foreground">{lead.phone}</p>
        )}
        {location && (
          <p className="truncate text-xs text-muted-foreground">{location}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {formatDate(lead.lastMessageAt)}
          {lead.messageCount > 1 && ` · ${lead.messageCount} messages`}
        </p>
      </button>

      <div className="flex shrink-0 items-start">
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Supprimer la fiche de ${leadHeadline(lead)}`}
            disabled={onRemove === undefined}
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * La vue liste — tous statuts confondus, du plus récent au plus ancien.
 *
 * Elle n'est pas un doublon du tableau : le tableau répond à « où en est
 * chaque demande ? », la liste à « qui a écrit en dernier ? ». Et surtout
 * elle offre un chemin pour changer de statut qui ne dépend pas du
 * glisser-déposer — un menu déroulant marche à la souris, au clavier et au
 * doigt, là où un glissement demande de la précision et échoue en silence
 * quand on relâche à côté.
 */
function ListeLeads({
  leads,
  canDelete,
  onOpen,
  onMove,
  onRemove,
}: {
  leads: Doc<"leads">[]
  canDelete: boolean
  onOpen: (lead: Doc<"leads">) => void
  onMove: (id: Id<"leads">, status: LeadStatus) => void
  onRemove: (id: Id<"leads">) => void
}) {
  if (leads.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Aucune fiche ne correspond.
        </CardContent>
      </Card>
    )
  }

  return (
    // Le tableau défile dans son propre cadre : la page, elle, ne défile
    // jamais horizontalement.
    <div className="min-w-0 overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Personne</TableHead>
            <TableHead className="w-44">Statut</TableHead>
            <TableHead className="w-24 text-right">Messages</TableHead>
            <TableHead className="w-44">Dernier message</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead._id}>
              <TableCell>
                {/* Le nom ouvre la fiche : la cible la plus large de la
                    ligne mène à l'action la plus courante. */}
                <button
                  type="button"
                  onClick={() => onOpen(lead)}
                  className="inline-flex items-center gap-1.5 text-left font-medium hover:underline"
                >
                  <LeadSourceIcon source={leadOrigin(lead)} />
                  {leadOrigin(lead) === "chat" ? (
                    <LeadOnlineDot lastSeenAt={lead.visitorLastSeenAt} />
                  ) : null}
                  {countryFlag(lead.country) ? (
                    <span aria-hidden="true">{countryFlag(lead.country)}</span>
                  ) : null}
                  {leadHeadline(lead)}
                  <LeadNouveauPastille seenAt={lead.seenAt} />
                </button>
                <div className="flex items-start gap-1">
                  <div className="min-w-0">
                    {lead.email ? (
                      <p className="text-xs text-muted-foreground">{lead.email}</p>
                    ) : null}
                    {lead.phone && (
                      <p className="text-xs text-muted-foreground">{lead.phone}</p>
                    )}
                    {formatLeadLocation(lead) && (
                      <p className="text-xs text-muted-foreground">{formatLeadLocation(lead)}</p>
                    )}
                  </div>
                  <CopyLeadContact email={lead.email} phone={lead.phone} />
                </div>
              </TableCell>
              <TableCell>
                {/* `items` n'est pas décoratif : le `Select.Value` de Base
                    UI, contrairement à celui de Radix, ne retient le
                    libellé de l'option choisie que si la racine reçoit
                    cette table. Sans elle il affiche la valeur stockée —
                    « new » au lieu de « Nouveau ». Le piège est déjà
                    documenté dans `users.tsx`, et je ne l'ai pas relu. */}
                <Select
                  items={LEAD_STATUS_LABELS}
                  value={lead.status}
                  onValueChange={(v) => onMove(lead._id, v as LeadStatus)}
                >
                  <SelectTrigger size="sm" aria-label={`Statut de ${leadHeadline(lead)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {LEAD_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              {/* `tabular-nums` : les chiffres s'alignent d'une ligne à
                  l'autre au lieu de danser. */}
              <TableCell className="text-right tabular-nums">{lead.messageCount}</TableCell>
              <TableCell className="text-sm text-muted-foreground tabular-nums">
                {formatDate(lead.lastMessageAt)}
              </TableCell>
              <TableCell className="text-right">
                {canDelete && (
                  <RowActionButton
                    label={`Supprimer la fiche de ${leadHeadline(lead)}`}
                    onClick={() => onRemove(lead._id)}
                  >
                    <Trash2Icon />
                  </RowActionButton>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  const timeline = useQuery(
    api.leads.timeline,
    lead === null ? "skip" : { id: lead._id },
  )

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {lead && <LeadSourceIcon source={leadOrigin(lead)} />}
            {lead && leadOrigin(lead) === "chat" ? (
              <LeadOnlineDot lastSeenAt={lead.visitorLastSeenAt} />
            ) : null}
            {lead && countryFlag(lead.country) ? (
              <span aria-hidden="true">{countryFlag(lead.country)}</span>
            ) : null}
            {lead ? leadHeadline(lead) : null}
          </DialogTitle>
          <DialogDescription>
            {lead?.email ? (
              <span className="flex items-center gap-1">
                <a href={`mailto:${lead.email}`} className="underline">
                  {lead.email}
                </a>
                <CopyButton
                  label="Copier l’e-mail"
                  value={lead.email}
                  iconClassName="size-4"
                />
              </span>
            ) : null}
            {lead?.phone?.trim() && (
              <span className="mt-1 flex items-center gap-1">
                <a href={`tel:${lead.phone}`} className="underline">
                  {lead.phone}
                </a>
                <CopyButton
                  label="Copier le téléphone"
                  value={lead.phone.trim()}
                  iconClassName="size-4"
                />
              </span>
            )}
            {lead && formatLeadLocation(lead) && (
              <span className="mt-1 block">{formatLeadLocation(lead)}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {timeline === undefined ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <>
            {/* Dit franchement ce qui manque plutôt que de laisser une fiche
                ancienne passer pour une fiche sans histoire. On ne fabrique
                surtout pas d'événements rétroactifs : ils auraient l'air
                vrais. */}
            {lead?.threadId ? (
              <LeadChatPanel leadId={lead._id} threadId={lead.threadId} />
            ) : null}

            {!timeline.complete && (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                Cette fiche est antérieure au suivi des événements. Ses
                messages sont là ; les changements de colonne d'avant ne sont
                enregistrés nulle part.
              </p>
            )}

            <ol className="relative flex flex-col gap-5 border-l pl-6">
              {timeline.entries.map((entry, index) => (
                <li key={`${entry.kind}-${entry.at}-${index}`} className="relative">
                  {/* La pastille sur le filet vertical. `-left-[1.6875rem]`
                      la recentre sur la bordure du `<ol>` : le filet fait
                      1 px, la pastille 9, et le padding 24. */}
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.6875rem] top-1.5 size-2.5 rounded-full border-2 border-background bg-border"
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(entry.at)}
                  </p>

                  {entry.kind === "created" && (
                    <p className="mt-1 text-sm">Première venue.</p>
                  )}

                  {entry.kind === "chat_started" && (
                    <p className="mt-1 text-sm">Conversation ouverte sur le site.</p>
                  )}

                  {entry.kind === "handover" && (
                    <p className="mt-1 text-sm">
                      {entry.to === "staff"
                        ? "Un conseiller a pris la main"
                        : "Rendu à l'assistant"}
                      {entry.actorName !== null && <> par {entry.actorName}</>}
                      .
                    </p>
                  )}

                  {entry.kind === "status" && (
                    <p className="mt-1 text-sm">
                      Passée de{" "}
                      <Badge variant="outline">
                        {LEAD_STATUS_LABELS[entry.from]}
                      </Badge>{" "}
                      à{" "}
                      <Badge variant="outline">
                        {LEAD_STATUS_LABELS[entry.to]}
                      </Badge>
                      {/* Le nom est celui recopié au moment du geste — un
                          historique doit rester lisible après un départ. */}
                      {entry.actorName !== null && <> par {entry.actorName}</>}
                    </p>
                  )}

                  {entry.kind === "message" && (
                    <div className="mt-1 rounded-lg border p-3">
                      <p className="text-sm font-medium">A écrit</p>
                      {entry.subject && (
                        <p className="mt-1 font-medium">{entry.subject}</p>
                      )}
                      {/* `whitespace-pre-wrap` : ce que la personne a écrit,
                          avec ses retours à la ligne. Le rendre en HTML
                          serait accepter du balisage venu d'un formulaire
                          public. */}
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {entry.body}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
