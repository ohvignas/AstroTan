import { afterEach, expect, test, vi } from "vitest"

const getImage = vi.fn()

vi.mock("astro:assets", () => ({
  getImage: (...args: unknown[]) => getImage(...args),
}))

afterEach(() => {
  getImage.mockReset()
})

test("le partage passe par getImage en JPEG 1200 et rend une URL absolue", async () => {
  getImage.mockResolvedValue({
    src: "/_image?href=https%3A%2F%2Fx.convex.cloud%2Fa.png&w=1200&f=jpg",
    attributes: { width: 1200, height: 675 },
  })
  const { proxifierPartage, OG_SHARE_WIDTH, OG_SHARE_HEIGHT } = await import(
    "./headImages"
  )
  expect(OG_SHARE_WIDTH).toBe(1200)
  expect(OG_SHARE_HEIGHT).toBe(675)
  const result = await proxifierPartage(
    "https://x.convex.cloud/a.png",
    "https://exemple.fr",
  )
  expect(getImage).toHaveBeenCalledWith({
    src: "https://x.convex.cloud/a.png",
    width: 1200,
    height: 675,
    format: "jpg",
  })
  expect(result.href).toBe(
    "https://exemple.fr/_image?href=https%3A%2F%2Fx.convex.cloud%2Fa.png&w=1200&f=jpg",
  )
  expect(result.width).toBe(1200)
  expect(result.height).toBe(675)
})

test("l'alt de partage préfère la légende média au titre de page", async () => {
  const { texteAltPartage } = await import("./headImages")
  expect(texteAltPartage({ alt: "Vitrine rénovée au petit matin" }, "Page")).toBe(
    "Vitrine rénovée au petit matin",
  )
  expect(texteAltPartage(null, "Page")).toBe("Page")
  expect(texteAltPartage({ alt: "   " }, "Page")).toBe("Page")
})

test("un article : la couverture l'emporte sur l'ancien ogImageId et le défaut", async () => {
  const { resolveShareImage } = await import("./headImages")
  expect(
    resolveShareImage({
      coverUrl: "https://x.convex.cloud/cover.png",
      ogImageId: "kg_old",
      defaultOgImageId: "kg_default",
    }),
  ).toEqual({ kind: "cover", url: "https://x.convex.cloud/cover.png" })
})

test("un article sans couverture retombe sur l'ancien ogImageId", async () => {
  const { resolveShareImage } = await import("./headImages")
  expect(
    resolveShareImage({
      coverUrl: null,
      ogImageId: "kg_old",
      defaultOgImageId: "kg_default",
    }),
  ).toEqual({ kind: "storage", storageId: "kg_old" })
})

test("une page sans couverture garde l'image de partage, puis le défaut", async () => {
  const { resolveShareImage } = await import("./headImages")
  expect(
    resolveShareImage({
      ogImageId: "kg_page",
      defaultOgImageId: "kg_default",
    }),
  ).toEqual({ kind: "storage", storageId: "kg_page" })
  expect(resolveShareImage({ defaultOgImageId: "kg_default" })).toEqual({
    kind: "storage",
    storageId: "kg_default",
  })
  expect(resolveShareImage({})).toBeNull()
})

test("une couverture vide ne compte pas : on retombe sur ogImageId", async () => {
  const { resolveShareImage } = await import("./headImages")
  expect(
    resolveShareImage({
      coverUrl: "   ",
      ogImageId: "kg_old",
    }),
  ).toEqual({ kind: "storage", storageId: "kg_old" })
})

test("si getImage refuse, on garde l'URL Convex plutôt que rien", async () => {
  getImage.mockRejectedValue(new Error("remotePatterns"))
  const { proxifierPartage } = await import("./headImages")
  const result = await proxifierPartage(
    "https://x.convex.cloud/a.png",
    "https://exemple.fr",
  )
  expect(result).toEqual({ href: "https://x.convex.cloud/a.png" })
})
