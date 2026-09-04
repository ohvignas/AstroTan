"use client"

import type { CoachTone } from "@/components/coach-buckets"
import { CoachPill } from "@/components/coach-buckets"
import { cn } from "@/lib/utils"

export type CoachTab = {
  id: string
  label: string
  tone: CoachTone
}

// Une pastille de couleur ne dit rien à un lecteur d'écran, et rien non
// plus à qui ne distingue pas le rouge du vert : chaque onglet énonce
// son état en toutes lettres, hors écran.
const SPOKEN: Record<CoachTone, string> = {
  bad: "des problèmes",
  ok: "des améliorations possibles",
  good: "tout est en ordre",
  info: "analyse en cours",
}

export function CoachTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: CoachTab[]
  active: string
  onSelect: (id: string) => void
}) {
  function move(index: number, key: string) {
    const delta = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0
    if (delta === 0) return false
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (!next) return false
    onSelect(next.id)
    document.getElementById(`coach-tab-${next.id}`)?.focus()
    return true
  }

  return (
    <div
      role="tablist"
      aria-label="Familles d’analyse"
      className="flex gap-0.5 rounded-md bg-muted p-0.5"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            id={`coach-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`coach-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (move(index, event.key)) event.preventDefault()
            }}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CoachPill tone={tab.tone} />
            {tab.label}
            <span className="sr-only"> : {SPOKEN[tab.tone]}</span>
          </button>
        )
      })}
    </div>
  )
}
