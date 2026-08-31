import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test, vi } from "vitest"

vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query: async () => null }),
}))

vi.mock("../../lib/loadPage", () => ({
  loadPage: async (astro: { response: { status: number }; cache?: { set: (v: unknown) => void } }) => {
    astro.response.status = 404
    return { page: null, preview: false }
  },
}))

test("une page sans ternaire répond 404 et n'affiche pas son hero", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./UnpublishedFonctionnalites.astro")
  const response = await container.renderToResponse(Page, {
    locals: { nonce: "test-nonce" },
    request: new Request("http://localhost/fonctionnalites"),
  })
  expect(response.status).toBe(404)
  const html = await response.text()
  expect(html).toContain("Cette page n'existe pas")
  expect(html).not.toContain("Tout ce qui est déjà résolu")
})
