// PAGE DE DIAGNOSTIC — TEMPORAIRE, À SUPPRIMER.
//
// Elle existe pour une seule raison : l'écran des leads est derrière une
// authentification, je ne saisis pas de mots de passe, et je n'ai donc
// jamais pu voir le glisser-déposer échouer de mes yeux. Trois correctifs
// ont été proposés sur la foi d'une lecture de code, et l'utilisateur a dû
// constater trois fois que ça ne marchait toujours pas.
//
// Cette route n'est pas sous `_authed` : elle s'ouvre sans session, avec des
// données fausses, et reproduit EXACTEMENT le montage dnd-kit de
// `_authed/leads.tsx` — mêmes capteurs, même détection de collision, même
// structure de carte (écouteurs sur l'article entier, poignée séparée pour
// le clavier). Ce qui s'y passe s'y passe pour la même raison.
import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import { ColonneLeads, colonneVisee, colonneVoisine } from "./_authed/leads"
import { LEAD_STATUSES  } from "@astrotan/backend/convex/content"
import type {LeadStatus} from "@astrotan/backend/convex/content";
import type { Doc, Id } from "@astrotan/backend/convex/_generated/dataModel"

export const Route = createFileRoute("/dnd-test")({
  component: DndTest,
})

function DndTest() {
  // De fausses fiches, mais du VRAI composant de colonne et de carte —
  // avec ses boutons, sa poignée, son menu de suppression. C'est là que la
  // différence avec le bac à sable minimal doit se voir.
  const [cartes, setCartes] = useState<Record<string, LeadStatus>>({
    a: "new",
    b: "new",
    c: "contacted",
  })

  function fausseFiche(id: string, status: LeadStatus): Doc<"leads"> {
    return {
      _id: id as Id<"leads">,
      _creationTime: 1_700_000_000_000,
      name: `Carte ${id}`,
      email: `${id}@exemple.fr`,
      status,
      lastMessageAt: 1_700_000_000_000,
      messageCount: 1,
    }
  }
  const [saisie, setSaisie] = useState<string | null>(null)
  const [journal, setJournal] = useState<string[]>([])

  // Capteurs identiques à l'écran réel, `colonneVoisine` comprise.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: colonneVoisine, scrollBehavior: "auto" }),
  )

  // LE FILET, recopié à l'identique de `_authed/leads.tsx`. C'est la seule
  // différence entre ce bac à sable qui marche et l'écran qui ne marche pas.
  const saisieRef = useRef<string | null>(null)
  saisieRef.current = saisie

  useEffect(() => {
    if (saisie === null) return
    function rattraper() {
      window.setTimeout(() => {
        if (saisieRef.current === null) return
        noter("FILET → Échap")
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
        )
        setSaisie(null)
      }, 0)
    }
    for (const nom of ["pointerup", "pointercancel", "mouseup", "blur"]) {
      window.addEventListener(nom, rattraper)
    }
    return () => {
      for (const nom of ["pointerup", "pointercancel", "mouseup", "blur"]) {
        window.removeEventListener(nom, rattraper)
      }
    }
  }, [saisie])

  function noter(ligne: string) {
    setJournal((j) => [ligne, ...j].slice(0, 14))
  }

  // Les événements BRUTS que le navigateur produit, avant dnd-kit.
  //
  // C'est la seule chose qui distingue encore ma machine de la sienne : le
  // glissement marche ici avec des événements synthétiques et échoue là-bas
  // avec une vraie main. Si dnd-kit ne démarre pas, la réponse est dans
  // quels événements arrivent — et lesquels n'arrivent pas.
  const [bruts, setBruts] = useState<Record<string, number>>({})
  const [dernier, setDernier] = useState("")

  useEffect(() => {
    const compte: Record<string, number> = {}
    function tracer(e: Event) {
      const pe = e as PointerEvent
      const type = e.type === "pointerdown" ? `pointerdown(${pe.pointerType})` : e.type
      compte[type] = (compte[type] ?? 0) + 1
      setBruts({ ...compte })
      if (e.type !== "mousemove" && e.type !== "pointermove") {
        setDernier(`${type} · bouton=${(pe as MouseEvent).button ?? "?"} · cible=${(e.target as HTMLElement)?.tagName ?? "?"}`)
      }
    }
    const types = [
      "pointerdown",
      "mousedown",
      "mousemove",
      "pointermove",
      "mouseup",
      "pointerup",
      "pointercancel",
      "touchstart",
      "touchmove",
      "touchend",
      "dragstart",
      "selectstart",
    ]
    for (const t of types) document.addEventListener(t, tracer, true)
    return () => {
      for (const t of types) document.removeEventListener(t, tracer, true)
    }
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Diagnostic dnd-kit</h1>
      <DndContext
        sensors={sensors}
        collisionDetection={colonneVisee}
        onDragStart={(e: DragStartEvent) => {
          setSaisie(String(e.active.id))
          noter(`START ${String(e.active.id)}`)
        }}
        onDragOver={(e) => noter(`OVER ${String(e.over?.id ?? "AUCUNE")}`)}
        onDragEnd={(e: DragEndEvent) => {
          setSaisie(null)
          const cible = e.over?.id as LeadStatus | undefined
          noter(`END active=${String(e.active.id)} over=${String(cible ?? "AUCUNE")}`)
          if (cible) setCartes((c) => ({ ...c, [String(e.active.id)]: cible }))
        }}
        onDragCancel={() => {
          setSaisie(null)
          noter("CANCEL")
        }}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {LEAD_STATUSES.map((status) => (
            <ColonneLeads
              key={status}
              status={status}
              leads={Object.entries(cartes)
                .filter(([, c]) => c === status)
                .map(([id]) => fausseFiche(id, status))}
              survolee={false}
              canDelete={true}
              aRefocaliser={null}
              onOpen={() => {}}
              onRemove={() => {}}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {saisie ? (
            <div className="rounded-lg border bg-card p-3 text-sm shadow-lg">Carte {saisie}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <h2 style={{ marginTop: 24, fontSize: 14 }}>Événements bruts du navigateur</h2>
      <p style={{ fontFamily: "monospace", fontSize: 13 }}>
        {Object.entries(bruts)
          .map(([t, n]) => `${t}=${n}`)
          .join("  ") || "aucun"}
      </p>
      <p style={{ fontFamily: "monospace", fontSize: 13 }}>dernier : {dernier || "—"}</p>

      <h2 style={{ marginTop: 24, fontSize: 14 }}>Journal dnd-kit (plus récent en haut)</h2>
      <ol data-journal style={{ fontFamily: "monospace", fontSize: 12 }}>
        {journal.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </div>
  )
}
