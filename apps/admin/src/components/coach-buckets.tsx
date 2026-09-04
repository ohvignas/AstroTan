"use client"

import type { ReactNode } from "react"
import { ChevronDownIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export type CoachTone = "bad" | "ok" | "good" | "info"

export type CoachItem = {
  id: string
  tone: CoachTone
  title: string
  phrase: string
}

// Jetons sémantiques, jamais `bg-red-500` : les trois pastilles sont le
// seul endroit du panneau qui porte une couleur, et elles doivent tenir
// le contraste en thème sombre comme en thème clair.
const PILL: Record<CoachTone, string> = {
  bad: "bg-destructive",
  ok: "bg-warning",
  good: "bg-success",
  info: "bg-muted-foreground",
}

const LABEL: Record<CoachTone, string> = {
  bad: "text-destructive",
  ok: "text-warning",
  good: "text-success",
  info: "text-muted-foreground",
}

export function CoachPill({
  tone,
  className,
}: {
  tone: CoachTone
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", PILL[tone], className)}
    />
  )
}

export function CoachRow({ tone, title, phrase }: Omit<CoachItem, "id">) {
  return (
    <li className="flex gap-2.5 py-1.5 text-xs leading-snug">
      <CoachPill tone={tone} className="mt-1" />
      <p>
        <span className="font-semibold text-foreground">{title}</span>
        <span className="text-muted-foreground"> : {phrase}</span>
      </p>
    </li>
  )
}

/**
 * Les trois accordéons d'un onglet : Problèmes, Améliorations, Bons
 * résultats — la hiérarchie de Yoast, écrite une seule fois.
 *
 * « Problèmes » et « Améliorations » sont ouverts, « Bons résultats »
 * replié : c'est la liste la plus longue, et la seule qui n'appelle
 * aucune action.
 */
export function CoachGroup({
  items,
  emptyLabel = "Rien à signaler pour le moment.",
}: {
  items: CoachItem[]
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }
  const bad = items.filter((item) => item.tone === "bad")
  const ok = items.filter((item) => item.tone === "ok")
  const good = items.filter((item) => item.tone !== "bad" && item.tone !== "ok")
  return (
    <div className="flex flex-col gap-2">
      <CoachBucket title="Problèmes" count={bad.length} tone="bad" defaultOpen>
        {bad.map(toRow)}
      </CoachBucket>
      <CoachBucket
        title="Améliorations"
        count={ok.length}
        tone="ok"
        defaultOpen
      >
        {ok.map(toRow)}
      </CoachBucket>
      <CoachBucket title="Bons résultats" count={good.length} tone="good">
        {good.map(toRow)}
      </CoachBucket>
    </div>
  )
}

function toRow(item: CoachItem) {
  return (
    <CoachRow
      key={item.id}
      tone={item.tone}
      title={item.title}
      phrase={item.phrase}
    />
  )
}

/** La pastille d'un onglet : le pire état de ce qu'il contient. */
export function worstTone(items: CoachItem[]): CoachTone {
  if (items.some((item) => item.tone === "bad")) return "bad"
  if (items.some((item) => item.tone === "ok")) return "ok"
  if (items.length === 0) return "info"
  return "good"
}

/** Score /100 de l'onglet SEO : un problème pèse plus qu'une amélioration. */
export function scoreFromItems(items: CoachItem[]): number {
  if (items.length === 0) return 0
  let points = 0
  for (const item of items) {
    if (item.tone === "bad") continue
    points += item.tone === "ok" ? 55 : 100
  }
  return Math.round(points / items.length)
}

function CoachBucket({
  title,
  count,
  tone,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  tone: CoachTone
  defaultOpen?: boolean
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/bucket rounded-md border border-input px-2.5"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 py-2 text-left text-xs font-semibold transition-opacity hover:opacity-80",
          LABEL[tone],
        )}
      >
        <CoachPill tone={tone} />
        <span>
          {title} ({count})
        </span>
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-open/bucket:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="pb-2 pl-0.5">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
