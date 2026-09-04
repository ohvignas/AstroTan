import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { PostSeoFacts } from "./post-seo-facts"

test("affiche trois lignes de faits, sans /100", () => {
  const html = renderToStaticMarkup(
    <PostSeoFacts
      facts={[
        { id: "rank", title: "Rang", text: "Rang relevé : 7.", tone: "good" },
        {
          id: "umami",
          title: "Audience",
          text: "Audience : 128 vues sur 7 jours.",
          tone: "good",
        },
        { id: "labs", title: "Labs", text: "Labs : pas dans le snapshot.", tone: "ok" },
      ]}
    />,
  )
  expect(html).toContain("Faits")
  expect(html).toContain("128")
  expect(html).toContain("Rang")
  expect(html).not.toContain("/100")
})
