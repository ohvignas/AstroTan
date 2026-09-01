import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { PostSeoFacts } from "./post-seo-facts"

test("affiche trois lignes de faits, sans /100", () => {
  const html = renderToStaticMarkup(
    <PostSeoFacts
      facts={[
        { id: "rank", text: "Rang relevé : 7." },
        { id: "umami", text: "Audience : 128 vues sur 7 jours." },
        { id: "labs", text: "Labs : pas dans le snapshot." },
      ]}
    />,
  )
  expect(html).toContain("Faits")
  expect(html).toContain("128")
  expect(html).not.toContain("/100")
})
