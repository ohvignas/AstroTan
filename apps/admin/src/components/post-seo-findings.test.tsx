import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { PostSeoFindings } from "./post-seo-findings"

describe("PostSeoFindings", () => {
  test("liste manque et à améliorer, pas un score seul", () => {
    const html = renderToStaticMarkup(
      <PostSeoFindings
        findings={[
          { identifier: "keyphraseLength", severity: "missing", rating: "bad" },
          { identifier: "textLength", severity: "improve", rating: "ok" },
        ]}
        status="ready"
      />,
    )
    expect(html).toContain("Manque")
    expect(html).toContain("À améliorer")
    expect(html).not.toContain("/100")
  })

  test("vide : phrase d'état, pas une note inventée", () => {
    const html = renderToStaticMarkup(
      <PostSeoFindings findings={[]} status="ready" />,
    )
    expect(html).toContain("Rien à signaler pour le moment")
  })
})
