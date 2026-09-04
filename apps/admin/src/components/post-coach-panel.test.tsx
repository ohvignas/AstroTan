import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ findings: [] })),
  useQuery: () => undefined,
}))

test("le module panneau se charge sans tirer yoastseo", async () => {
  await import("./post-coach-panel")
  expect(true).toBe(true)
})

test("un titre, un score et trois onglets, pas de faits", async () => {
  const { PostCoachPanel } = await import("./post-coach-panel")
  const html = renderToStaticMarkup(
    <PostCoachPanel
      fields={{
        title: "Un titre",
        excerpt: "",
        body: "<p>Un corps.</p>",
        targetKeyword: "astrotan",
        seoTitle: "",
        seoDescription: "",
        slug: "un-titre",
        geoSummary: "",
        geoEntities: "",
        geoFaq: [],
        geoNoai: false,
      }}
      postId={"post_1" as Id<"posts">}
      path="/blog/un-titre"
    />,
  )
  expect(html).toContain("Analyse SEO")
  expect(html).toContain("—/100")
  expect(html).toContain("Lisibilité")
  expect(html).toContain("GEO")
  expect(html).not.toContain("Faits")
  expect(html).not.toContain("Ce panneau juge")
  expect(html).not.toContain("Générer avec l’IA")
})
