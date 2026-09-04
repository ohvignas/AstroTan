"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"
import { splitEntities } from "@/lib/contentGuards"
import { findingItems, geoItems } from "@/lib/coachItems"
import { geoChecklist } from "@/lib/geoChecklist"
import { useDebouncedValue } from "@/lib/useDebouncedValue"
import { CoachGroup, scoreFromItems, worstTone } from "@/components/coach-buckets"
import { CoachTabs } from "@/components/coach-tabs"

export type CoachFields = {
  title: string
  excerpt: string
  body: string
  targetKeyword: string
  seoTitle: string
  seoDescription: string
  slug: string
  geoSummary: string
  geoEntities: string
  geoFaq: { question: string; answer: string }[]
  geoNoai: boolean
}

type TabId = "seo" | "readability" | "geo"

export function PostCoachPanel({
  fields,
  publishedAt,
}: {
  fields: CoachFields
  postId: Id<"posts">
  path: string
  publishedAt?: number
}) {
  const analyze = useAction(api.seoAnalyze.analyze)
  const debounced = useDebouncedValue(fields)
  const [findings, setFindings] = useState<SeoFinding[]>([])
  const [yoastScore, setYoastScore] = useState<number | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  )
  const [tab, setTab] = useState<TabId>("seo")

  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    analyze({
      title: debounced.title,
      excerpt: debounced.excerpt,
      bodyHtml: debounced.body,
      targetKeyword: debounced.targetKeyword,
      seoTitle: debounced.seoTitle,
      seoDescription: debounced.seoDescription,
      slug: debounced.slug,
    })
      .then((out) => {
        if (cancelled) return
        setFindings(out.findings)
        const raw = "score" in out ? (out as { score?: number }).score : undefined
        setYoastScore(
          typeof raw === "number" && raw >= 0 && raw <= 100
            ? Math.round(raw)
            : null,
        )
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [analyze, debounced])

  const groups: Record<TabId, ReturnType<typeof findingItems>> = {
    seo: findingItems(findings, "seo"),
    readability: findingItems(findings, "readability"),
    geo: geoItems(
      geoChecklist({
        summary: fields.geoSummary,
        entities: splitEntities(fields.geoEntities),
        faq: fields.geoFaq,
        noai: fields.geoNoai,
        publishedAt,
      }),
    ),
  }

  // Tant que Yoast n'a pas répondu, les deux onglets qui en dépendent
  // n'ont pas d'état à annoncer — une pastille verte le temps du calcul
  // dirait « tout va bien » d'un texte qui n'a pas encore été lu.
  const pending = status === "idle" || status === "loading"
  const analysisTone = (id: TabId) =>
    pending && id !== "geo" ? "info" : worstTone(groups[id])
  const seoScore = pending ? null : (yoastScore ?? scoreFromItems(groups.seo))

  return (
    <aside
      className="flex flex-col gap-3 rounded-lg border border-input bg-background p-3"
      aria-labelledby="coach-title"
    >
      <h2
        id="coach-title"
        className="flex items-baseline justify-between gap-2 text-sm font-semibold"
      >
        Analyse SEO
        <span className="font-medium tabular-nums text-muted-foreground">
          {seoScore === null ? "—" : seoScore}/100
        </span>
      </h2>
      <CoachTabs
        tabs={[
          { id: "seo", label: "SEO", tone: analysisTone("seo") },
          {
            id: "readability",
            label: "Lisibilité",
            tone: analysisTone("readability"),
          },
          { id: "geo", label: "GEO", tone: analysisTone("geo") },
        ]}
        active={tab}
        onSelect={(id) => setTab(id as TabId)}
      />
      <div
        id={`coach-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`coach-tab-${tab}`}
      >
        <AnalysisState status={status} tab={tab}>
          <CoachGroup items={groups[tab]} />
        </AnalysisState>
      </div>
    </aside>
  )
}

function AnalysisState({
  status,
  tab,
  children,
}: {
  status: "idle" | "loading" | "ready" | "error"
  tab: TabId
  children: ReactNode
}) {
  // La checklist GEO se calcule dans le navigateur, sans Yoast : elle
  // reste lisible même quand l'action d'analyse échoue.
  if (tab === "geo") return children
  if (status === "error") {
    return (
      <p role="alert" className="text-xs text-destructive">
        Analyse indisponible.
      </p>
    )
  }
  if (status === "idle" || status === "loading") {
    return <p className="text-xs text-muted-foreground">Analyse…</p>
  }
  return children
}
