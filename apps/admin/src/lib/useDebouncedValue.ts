import { useEffect, useState } from "react"

export const SEO_ANALYZE_DEBOUNCE_MS = 1500

export function useDebouncedValue<T>(value: T, delayMs = SEO_ANALYZE_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
