import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
  ScreenReaderInstructions,
} from "@dnd-kit/core"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Doc, Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS
  
} from "@astrotan/backend/convex/content"
import type {LeadStatus} from "@astrotan/backend/convex/content";
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
import { ColumnsIcon, GripVerticalIcon, ListIcon, SearchIcon, Trash2Icon } from "lucide-react"
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
import { RowActionButton } from "@/components/row-actions"
import { evenementAnnulationDnd } from "@/lib/dragRescue"
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

/**
 * La colonne visée : celle sous le pointeur, sinon la plus proche.
 *
 * « La plus proche » seule mesure la position de la CARTE, pas celle du
 * doigt. Une carte attrapée par son bord gauche déborde d'une centaine de
 * pixels à droite du pointeur, et l'on dépose alors dans la colonne
 * d'à-côté en croyant viser celle qu'on montre. `pointerWithin` répond à
 * la seule question que se pose la personne : sur quelle colonne suis-je ?
 *
 * Le repli existe pour le clavier, où il n'y a pas de pointeur du tout —
 * et pour les quelques pixels de gouttière entre deux colonnes.
 */
export const colonneVisee: CollisionDetection = (args) => {
  const sousLePointeur = pointerWithin(args)
  return sousLePointeur.length > 0 ? sousLePointeur : closestCorners(args)
}

/** Ce qu'une carte emporte avec elle pendant le glissement. */
type DonneesCarte = { lead: Doc<"leads"> }

function litCarte(data: unknown): Doc<"leads"> | null {
  return (data as DonneesCarte | undefined)?.lead ?? null
}

/**
 * Au clavier, une flèche saute d'une colonne à la colonne voisine.
 *
 * Le calcul par défaut de dnd-kit déplace la carte de 25 px par appui —
 * une quinzaine de pressions pour franchir une colonne de 288 px, ce qui
 * revient à ne pas avoir de chemin clavier du tout.
 *
 * La voisine se lit dans `LEAD_STATUSES`, pas dans la géométrie. Chercher
 * « le rectangle le plus proche vers la droite » revenait à désigner la
 * colonne de départ elle-même, dont le centre est à quelques pixels de la
 * carte saisie : les appuis se perdaient dans ce micro-écart au lieu de
 * traverser. Un index ne dérive pas.
 *
 * Haut et bas ne rendent rien : l'ordre d'une colonne est celui des dates,
 * il ne se réarrange pas à la main.
 */
export const colonneVoisine: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context: { active, collisionRect, droppableRects, over } },
) => {
  const sens =
    event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0
  if (sens === 0 || collisionRect === null) return

  // `over` d'abord : c'est la colonne réellement visée à cet instant, celle
  // que les appuis précédents ont atteinte. Le statut de la fiche ne sert
  // que pour le tout premier appui, avant que la première collision soit
  // calculée.
  const depart = LEAD_STATUSES.indexOf(
    (over?.id ?? litCarte(active?.data.current)?.status) as LeadStatus,
  )
  const voisine = LEAD_STATUSES[depart + sens]
  // Aux deux bouts du tableau il n'y a pas de voisine, et c'est très bien :
  // la carte reste où elle est plutôt que de sortir par le côté.
  if (depart === -1 || voisine === undefined) return
  const cible = droppableRects.get(voisine)
  if (cible === undefined) return

  // Viser le centre de la colonne : le prochain appui repartira donc d'une
  // position sans reste, et non d'un décalage accumulé.
  const dx = cible.left + cible.width / 2 - (collisionRect.left + collisionRect.width / 2)
  return { x: currentCoordinates.x + dx, y: currentCoordinates.y }
}

// dnd-kit annonce chaque étape à un lecteur d'écran. Ses formules par
// défaut sont en anglais et parlent de « position dans la liste » — deux
// choses fausses ici, où l'on déplace une fiche entre des colonnes nommées.
const instructionsClavier: ScreenReaderInstructions = {
  draggable:
    "Pour déplacer une fiche, appuyez sur la barre d'espace. " +
    "Utilisez les flèches gauche et droite pour changer de colonne, " +
    "la barre d'espace pour déposer, la touche Échap pour annuler.",
}

function libelleColonne(id: unknown): string | undefined {
  return LEAD_STATUS_LABELS[id as LeadStatus]
}

const annonces: Announcements = {
  onDragStart: ({ active }) =>
    `Fiche de ${litCarte(active.data.current)?.name} saisie.`,
  onDragOver: ({ over }) =>
    over ? `Au-dessus de la colonne ${libelleColonne(over.id)}.` : undefined,
  onDragEnd: ({ active, over }) => {
    const nom = litCarte(active.data.current)?.name
    return over
      ? `Fiche de ${nom} déposée dans la colonne ${libelleColonne(over.id)}.`
      : `Fiche de ${nom} reposée à sa place.`
  },
  onDragCancel: ({ active }) =>
    `Déplacement annulé. Fiche de ${litCarte(active.data.current)?.name} reposée à sa place.`,
}

function LeadsPage() {
  const board = useQuery(api.leads.board)
  const profile = useQuery(api.profiles.me)
  const move = useMutation(api.leads.move)
  const remove = useMutation(api.leads.remove)
  const [openLead, setOpenLead] = useState<Doc<"leads"> | null>(null)
  // La fiche en cours de déplacement. Elle sert au calque qui suit le
  // geste — la carte d'origine, elle, reste en place et s'estompe, sans
  // quoi la colonne se refermerait sous le doigt.
  const [saisie, setSaisie] = useState<Doc<"leads"> | null>(null)
  // La colonne actuellement survolée pendant un glissement. Sans ce retour
  // visuel, on lâche à l'aveugle et on découvre le résultat après coup.
  const [survolee, setSurvolee] = useState<LeadStatus | null>(null)
  // La fiche déposée au clavier, dont il faut rattraper le focus. Changer
  // de colonne démonte la carte et la remonte ailleurs : le focus tombe
  // alors sur `<body>`, et déplacer la fiche suivante demande de
  // retraverser toute la page. Personne ne déplace une seule fiche.
  const [aRefocaliser, setARefocaliser] = useState<Id<"leads"> | null>(null)
  // Le refus du serveur, montré à l'écran. Sans lui, un déplacement rejeté
  // est indiscernable d'un geste raté.
  const [erreur, setErreur] = useState<string | null>(null)
  // La recherche filtre les DEUX vues. Un filtre qui ne s'appliquerait qu'à
  // l'une donnerait deux comptes différents pour la même requête.
  const [recherche, setRecherche] = useState("")
  const [vue, setVue] = useState<"tableau" | "liste">("tableau")

  const sensors = useSensors(
    // Huit pixels avant qu'un appui devienne un glissement : sans cette
    // contrainte, le capteur avale le clic et le panneau des messages ne
    // s'ouvre plus jamais.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Au doigt, c'est un délai et non une distance : une contrainte de
    // distance confondrait le début d'un défilement avec le début d'un
    // glissement, et la page deviendrait impossible à faire défiler. La
    // tolérance annule l'appui long dès que le doigt part défiler.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // `scrollBehavior: "auto"` n'est pas un détail de confort. Quand la
    // colonne visée est hors écran, dnd-kit fait défiler le tableau ET
    // retranche d'avance ce défilement du déplacement de la carte. Le
    // défilement doux — le défaut — est asynchrone : la soustraction est
    // faite tout de suite, le défilement arrive plus tard, et entre les
    // deux la carte est à un endroit qui ne correspond à rien. Chaque
    // appui suivant repart de ce décalage et l'aggrave. Un défilement
    // immédiat rend les deux moitiés du calcul vraies en même temps.
    useSensor(KeyboardSensor, {
      coordinateGetter: colonneVoisine,
      scrollBehavior: "auto",
    }),
  )

  // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
  // visiteur a écrit. L'interface masque, et la mutation revérifie.
  // Le filet.
  //
  // Ce qui suit ne corrige aucune cause : il rend l'état bloqué impossible
  // à conserver. Le défaut signalé — « quand j'attrape un élément il reste
  // collé à ma souris, obligé de relancer la page » — est celui d'un
  // `pointerup` qui n'atteint jamais dnd-kit : capture perdue quand le nœud
  // est démonté par un re-rendu de la query réactive, relâchement hors de
  // la fenêtre, onglet masqué en plein geste. Le glissement ne se termine
  // alors jamais, et rien ne le rattrape.
  //
  // Une correction qui vise une cause a déjà été tentée ici et n'a pas
  // suffi. Celle-ci part de l'autre bout : quel que soit le chemin, si le
  // bouton est relâché — ou la fenêtre perdue — et qu'un glissement est
  // encore en cours un tour de boucle plus tard, on envoie à dnd-kit la
  // touche par laquelle il annule lui-même, puis on remet notre propre
  // état à zéro.
  //
  // Le `setTimeout(…, 0)` n'est pas une temporisation prudente : dans un
  // dépôt NORMAL, `pointerup` précède `onDragEnd`. Sans ce tour de boucle,
  // le filet couperait chaque dépôt réussi juste avant qu'il n'écrive.
  // Après, `saisie` est déjà `null` et le filet ne fait rien — il ne se
  // déclenche que sur le cas anormal.
  // Miroir de `saisie` lisible depuis un `setTimeout` sans le refermer dans
  // la valeur du rendu où il a été posé.
  const saisieRef = useRef<Doc<"leads"> | null>(null)
  saisieRef.current = saisie

  useEffect(() => {
    if (saisie === null) return

    function rattraper() {
      window.setTimeout(() => {
        if (saisieRef.current === null) return
        // La touche par laquelle dnd-kit annule un glissement. La
        // synthétiser plutôt que de simplement vider notre état : sans
        // elle, le calque disparaîtrait mais dnd-kit se croirait encore en
        // train de glisser, et avalerait le clic suivant.
        //
        // Sur `document` parce que c'est là que le capteur pose cet
        // écouteur — et l'événement lui-même est construit dans
        // `lib/dragRescue.ts`, où un test vise le champ qui a été oublié la
        // première fois.
        document.dispatchEvent(evenementAnnulationDnd())
        setSaisie(null)
        setSurvolee(null)
      }, 0)
    }

    function surVisibilite() {
      if (document.visibilityState === "hidden") rattraper()
    }

    // `mouseup` en plus de `pointerup`, et ce n'est pas une ceinture de
    // plus : `MouseSensor` n'a AUCUN événement d'annulation — sa table
    // d'événements est `mousemove` + `mouseup`, là où `PointerSensor` et
    // `TouchSensor` écoutent en plus `pointercancel` et `touchcancel`.
    // Le chemin souris est donc le seul qui n'a pas de filet interne, et
    // c'est précisément celui où le blocage a été constaté.
    for (const nom of ["pointerup", "pointercancel", "mouseup", "blur"]) {
      window.addEventListener(nom, rattraper)
    }
    document.addEventListener("visibilitychange", surVisibilite)
    return () => {
      for (const nom of ["pointerup", "pointercancel", "mouseup", "blur"]) {
        window.removeEventListener(nom, rattraper)
      }
      document.removeEventListener("visibilitychange", surVisibilite)
    }
  }, [saisie])

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
    lead.email.toLowerCase().includes(requete)

  const colonnes = Object.fromEntries(
    LEAD_STATUSES.map((status) => [status, board[status].filter(filtre)]),
  ) as Record<LeadStatus, Doc<"leads">[]>

  // La liste, tous statuts confondus, du plus récent au plus ancien : c'est
  // l'ordre dans lequel on répond, et la seule raison d'ouvrir cette vue.
  const liste = LEAD_STATUSES.flatMap((status) => colonnes[status]).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  )

  const total = LEAD_STATUSES.reduce((sum, status) => sum + colonnes[status].length, 0)

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

  function onDragStart(event: DragStartEvent) {
    setSaisie(litCarte(event.active.data.current))
    setARefocaliser(null)
  }

  function onDragOver(event: DragOverEvent) {
    setSurvolee((event.over?.id as LeadStatus | undefined) ?? null)
  }

  function onDragEnd(event: DragEndEvent) {
    setSaisie(null)
    setSurvolee(null)
    const lead = litCarte(event.active.data.current)
    const status = event.over?.id as LeadStatus | undefined

    // `console.error` et non `warn` : le serveur de développement ne relaie
    // que le premier vers son journal. Trace temporaire.
    console.error(
      `[drag] fiche=${lead?.name ?? "?"} depuis=${lead?.status ?? "?"} vers=${status ?? "AUCUNE"}`,
    )

    // Relâcher hors de toute colonne ne déplace rien, et le disait par le
    // silence — indiscernable d'une panne. dnd-kit rend `over` nul quand le
    // pointeur ne survole aucune zone de dépôt au moment du relâchement.
    if (lead && !status) {
      setErreur(
        "Relâché en dehors des colonnes : la fiche n'a pas bougé. Déposez-la sur la colonne visée.",
      )
      return
    }

    // Lâcher une carte dans sa propre colonne ne doit pas écrire : ce
    // serait une mutation pour rien, et une ligne d'historique qui ne
    // raconte rien.
    if (lead && status && status !== lead.status) {
      setErreur(null)
      // Un `void` sur cette promesse renvoyait l'échec au néant : la carte
      // revenait à sa place sans un mot, et rien à l'écran ne distinguait
      // « refusé par le serveur » de « je n'ai pas visé la bonne colonne ».
      // C'est la classe de défaut que tout ce chantier corrige : une
      // moitié qui échoue en silence.
      move({ id: lead._id, status }).catch((err: unknown) => {
        console.error("[drag] la mutation a échoué", err)
        setErreur(describeLeadError(err))
      })
      // Seulement au clavier : à la souris, le focus n'a pas bougé et le
      // déplacer d'autorité ferait sauter l'écran sous le curseur.
      if (event.activatorEvent instanceof KeyboardEvent) setARefocaliser(lead._id)
    }
  }

  function onDragCancel() {
    setSaisie(null)
    setSurvolee(null)
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
            placeholder="Rechercher un nom ou un email"
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
          onOpen={setOpenLead}
          onMove={(id, status) =>
            move({ id, status }).catch((err: unknown) => setErreur(describeLeadError(err)))
          }
          onRemove={(id) =>
            remove({ id }).catch((err: unknown) => setErreur(describeLeadError(err)))
          }
        />
      ) : (
      <DndContext
        sensors={sensors}
        // Les colonnes s'étirent toutes à la hauteur de la plus haute
        // (`items-stretch` du conteneur) : le repli géométrique a donc des
        // rectangles réguliers à comparer, et non des colonnes hautes comme
        // leur contenu.
        collisionDetection={colonneVisee}
        accessibility={{ announcements: annonces, screenReaderInstructions: instructionsClavier }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* Défilement horizontal plutôt que colonnes rétrécies : cinq colonnes
            sur un écran étroit donnent cinq bandes illisibles. */}
        <div className="flex gap-4 overflow-x-auto pb-2">
          {LEAD_STATUSES.map((status) => (
            <ColonneLeads
              key={status}
              status={status}
              leads={colonnes[status]}
              survolee={survolee === status}
              canDelete={canDelete}
              aRefocaliser={aRefocaliser}
              onOpen={setOpenLead}
              onRemove={(id) =>
                remove({ id }).catch((err: unknown) => setErreur(describeLeadError(err)))
              }
            />
          ))}
        </div>

        {/* Le calque vit hors du conteneur qui défile : rendu dedans, il
            serait rogné au bord dès qu'on traverse le tableau.

            `dropAnimation={null}` pour deux raisons, et la seconde est la
            plus sérieuse. D'abord l'animation par défaut ramène le calque
            vers l'emplacement d'ORIGINE de la carte — or la carte part
            dans une autre colonne : elle montre le mauvais endroit. Ensuite
            le calque reste monté tant que cette animation n'est pas
            terminée, et une animation peut ne jamais se terminer — un
            onglet passé en arrière-plan gèle la ligne de temps du
            document. La carte reste alors collée à l'écran, relâchée pour
            l'application mais pas pour l'œil. Sans animation, le calque
            disparaît au relâchement, toujours. */}
        <DragOverlay dropAnimation={null}>
          {saisie && (
            <div className="w-72 rotate-2 cursor-grabbing rounded-lg border bg-card p-3 text-sm shadow-lg">
              <ContenuCarte lead={saisie} canDelete={canDelete} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      )}

      <LeadMessages lead={openLead} onClose={() => setOpenLead(null)} />
    </div>
  )
}

export function ColonneLeads({
  status,
  leads,
  survolee,
  canDelete,
  aRefocaliser,
  onOpen,
  onRemove,
}: {
  status: LeadStatus
  leads: Doc<"leads">[]
  survolee: boolean
  canDelete: boolean
  aRefocaliser: Id<"leads"> | null
  onOpen: (lead: Doc<"leads">) => void
  onRemove: (id: Id<"leads">) => void
}) {
  // L'identifiant de la zone de dépôt EST le statut : c'est ce que
  // `onDragEnd` relit pour composer la mutation, sans table de
  // correspondance à tenir à jour.
  const { setNodeRef } = useDroppable({ id: status })

  return (
    <section
      ref={setNodeRef}
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
        {leads.map((lead) => (
          <CarteLead
            key={lead._id}
            lead={lead}
            canDelete={canDelete}
            rattraperLeFocus={aRefocaliser === lead._id}
            onOpen={() => onOpen(lead)}
            onRemove={() => onRemove(lead._id)}
          />
        ))}
      </div>
    </section>
  )
}

function CarteLead({
  lead,
  canDelete,
  rattraperLeFocus,
  onOpen,
  onRemove,
}: {
  lead: Doc<"leads">
  canDelete: boolean
  rattraperLeFocus: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } =
    useDraggable({ id: lead._id, data: { lead } satisfies DonneesCarte })
  const poignee = useRef<HTMLButtonElement | null>(null)

  // Cette carte vient d'arriver dans sa nouvelle colonne à la suite d'un
  // dépôt au clavier, et le focus l'attend. Le drapeau est remis à zéro au
  // glissement suivant, donc l'effet ne se redéclenche pas dans son dos.
  useEffect(() => {
    if (rattraperLeFocus) poignee.current?.focus()
  }, [rattraperLeFocus])

  return (
    // Les écouteurs sont sur la carte entière : à la souris et au doigt, on
    // attrape la fiche où l'on veut, comme avant.
    //
    // `select-none` : sans lui, un glissement commencé sur du texte démarre
    // une sélection au lieu d'un déplacement, et les deux se disputent le
    // geste.
    <article
      ref={setNodeRef}
      {...listeners}
      className={`cursor-grab select-none rounded-lg border bg-card p-3 text-sm shadow-xs active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <ContenuCarte
        lead={lead}
        canDelete={canDelete}
        onOpen={onOpen}
        onRemove={onRemove}
        poignee={
          // La poignée n'est pas une décoration : dnd-kit refuse de démarrer
          // un glissement au clavier tant que le focus n'est pas exactement
          // sur le nœud désigné ici. C'est ce qui laisse Entrée et Espace au
          // bouton voisin, qui ouvre les messages — sans elle, les deux
          // gestes se disputeraient la même touche.
          <button
            ref={(node) => {
              poignee.current = node
              setActivatorNodeRef(node)
            }}
            type="button"
            {...attributes}
            aria-label={`Déplacer la fiche de ${lead.name}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <GripVerticalIcon className="size-4" />
          </button>
        }
      />
    </article>
  )
}

/**
 * Ce qu'une carte montre, sans rien savoir du glissement.
 *
 * Rendu deux fois : à sa place dans la colonne, et dans le calque qui suit
 * le geste. Le calque n'a ni poignée ni gestionnaires — il n'est qu'une
 * image — et c'est pourquoi tout est facultatif ici.
 */
function ContenuCarte({
  lead,
  canDelete,
  onOpen,
  onRemove,
  poignee,
}: {
  lead: Doc<"leads">
  canDelete: boolean
  onOpen?: () => void
  onRemove?: () => void
  poignee?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-1">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={onOpen === undefined}
        onClick={onOpen}
      >
        <p className="font-medium">{lead.name}</p>
        <p className="truncate text-muted-foreground">{lead.email}</p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {formatDate(lead.lastMessageAt)}
          {lead.messageCount > 1 && ` · ${lead.messageCount} messages`}
        </p>
      </button>

      {poignee}

      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Supprimer la fiche de ${lead.name}`}
          disabled={onRemove === undefined}
          onClick={onRemove}
        >
          <Trash2Icon className="size-4" />
        </Button>
      )}
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
                  className="text-left font-medium hover:underline"
                >
                  {lead.name}
                </button>
                <p className="text-xs text-muted-foreground">{lead.email}</p>
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
                  <SelectTrigger size="sm" aria-label={`Statut de ${lead.name}`}>
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
                    label={`Supprimer la fiche de ${lead.name}`}
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
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead?.name}</DialogTitle>
          <DialogDescription>
            <a href={`mailto:${lead?.email}`} className="underline">
              {lead?.email}
            </a>
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
