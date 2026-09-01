import { useEffect, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"
import { splitEntities } from "@/lib/contentGuards"
import { geoChecklist } from "@/lib/geoChecklist"
import { factsForPost } from "@/lib/postSeoFacts"
import { useDebouncedValue } from "@/lib/useDebouncedValue"
import { usePostAnalytics } from "@/lib/usePostAnalytics"
import { PostGeoChecklist } from "@/components/post-geo-checklist"
import { PostSeoFacts } from "@/components/post-seo-facts"
import { PostSeoFindings } from "@/components/post-seo-findings"

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

export function PostCoachPanel({
  fields,
  postId,
  path,
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
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  )
  const rank = useQuery(api.seoRanks.forDocument, { kind: "post", postId })
  const snapshot = useQuery(api.seoRanks.siteSnapshot)
  const umami = usePostAnalytics(path)

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
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [analyze, debounced])

  const facts = factsForPost({
    path,
    targetKeyword: fields.targetKeyword,
    rank,
    umami,
    snapshot,
  })
  const geoItems = geoChecklist({
    summary: fields.geoSummary,
    entities: splitEntities(fields.geoEntities),
    faq: fields.geoFaq,
    noai: fields.geoNoai,
    publishedAt,
  })

  return (
    <aside
      className="flex flex-col gap-4 rounded-lg border border-input bg-muted/30 p-3"
      aria-label="Aide à la rédaction"
    >
      <p className="text-xs text-muted-foreground">
        Ce panneau juge, il n’écrit pas. « Générer avec l’IA » remplit les
        champs SEO/GEO.
      </p>
      <PostSeoFacts facts={facts} />
      <PostSeoFindings findings={findings} status={status} />
      <PostGeoChecklist items={geoItems} />
    </aside>
  )
}
