import { expect, test } from "vitest"
import { SEO_ANALYZE_DEBOUNCE_MS } from "./useDebouncedValue"

test("le recalcul attend 1,5 s, dans la fourchette 1–2 s validée", () => {
  expect(SEO_ANALYZE_DEBOUNCE_MS).toBe(1500)
})
