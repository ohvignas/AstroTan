import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { PostGeoChecklist } from "./post-geo-checklist"
import { geoChecklist } from "@/lib/geoChecklist"

test("titre GEO et items FR", () => {
  const html = renderToStaticMarkup(
    <PostGeoChecklist
      items={geoChecklist({
        summary: "",
        entities: [],
        faq: [],
        noai: false,
      })}
    />,
  )
  expect(html).toContain("GEO")
  expect(html).toContain("résumé")
  expect(html).not.toContain("citation")
  expect(html).not.toContain("auteur")
})
