import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test, vi } from "vitest"

vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query: async () => null }),
}))

test("BaseLayout affiche le bandeau d'aperçu quand locals.preview est vrai", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./PreviewSlot.astro")
  const html = await container.renderToString(Page, {
    locals: { nonce: "test-nonce", preview: true },
  })
  expect(html).toContain("Aperçu — cet article n'est pas publié")
  expect(html).toContain("corps-visible")
  expect(html).toContain("preview-banner")
})

test("sans locals.preview, aucun bandeau", async () => {
  const container = await AstroContainer.create()
  const { default: BaseLayout } = await import("../../layouts/BaseLayout.astro")
  const html = await container.renderToString(BaseLayout, {
    props: { page: null, fallbackTitle: "Blog" },
    locals: { nonce: "test-nonce" },
    slots: { default: "<p>corps-visible</p>" },
  })
  expect(html).not.toContain("preview-banner")
  expect(html).toContain("corps-visible")
})
