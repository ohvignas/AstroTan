import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"

export function usePostAnalytics(path: string | null): AnalyticsResult | undefined {
  const forPath = useAction(api.analytics.forPath)
  const [result, setResult] = useState<AnalyticsResult | undefined>(undefined)

  useEffect(() => {
    let current = true
    setResult(undefined)
    if (path === null) return
    forPath({ path })
      .then((value) => {
        if (current) setResult(value)
      })
      .catch(() => {
        if (current) {
          setResult({ last7: null, last30: null, status: "unreachable" })
        }
      })
    return () => {
      current = false
    }
  }, [forPath, path])

  return result
}
