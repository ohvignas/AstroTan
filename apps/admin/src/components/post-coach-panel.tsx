import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"
import { useDebouncedValue } from "@/lib/useDebouncedValue"
import { PostSeoFindings } from "@/components/post-seo-findings"

export type CoachFields = {
  title: string
  excerpt: string
  body: string
  targetKeyword: string
  seoTitle: string
  seoDescription: string
  slug: string
}

export function PostCoachPanel({ fields }: { fields: CoachFields }) {
  const analyze = useAction(api.seoAnalyze.analyze)
  const debounced = useDebouncedValue(fields)
  const [findings, setFindings] = useState<SeoFinding[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  )

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

  return (
    <aside
      className="rounded-lg border border-input bg-muted/30 p-3"
      aria-label="Aide à la rédaction"
    >
      <p className="mb-2 text-xs text-muted-foreground">
        Ce panneau juge, il n’écrit pas. « Générer avec l’IA » remplit les
        champs SEO/GEO.
      </p>
      <PostSeoFindings findings={findings} status={status} />
    </aside>
  )
}
