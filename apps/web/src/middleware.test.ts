import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// Le middleware s'exécute avant toute route : ce qu'il avale n'atteint
// jamais la page qui l'aurait servi. Ces tests portent sur les trois
// choses qu'il ne doit jamais avaler.

const listActive = vi.fn()

vi.mock("./lib/convexClient", () => ({
  getConvexClient: () => ({ query: listActive }),
}))

let onRequest: typeof import("./middleware").onRequest
let purgeRedirectMemo: typeof import("./middleware").purgeRedirectMemo

beforeEach(async () => {
  vi.resetModules()
  listActive.mockReset()
  listActive.mockResolvedValue([
    { from: "ancienne-offre", to: "/tarifs", code: 301 },
  ])
  const mod = await import("./middleware")
  onRequest = mod.onRequest
  purgeRedirectMemo = mod.purgeRedirectMemo
  purgeRedirectMemo()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function contextFor(url: string) {
  const redirect = vi.fn((to: string, code: number) => ({ to, code }) as never)
  return {
    context: { url: new URL(url), redirect } as never,
    redirect,
  }
}

const next = vi.fn(() => ({ passed: true }) as never)

describe("ce qu'il redirige", () => {
  test("un chemin correspondant à une redirection active", async () => {
    const { context, redirect } = contextFor("http://site.test/ancienne-offre")
    await onRequest(context, next)
    expect(redirect).toHaveBeenCalledWith("/tarifs", 301)
  })

  test("les variantes de slash désignent la même redirection", async () => {
    // Sinon `/ancienne-offre/` échapperait à une redirection écrite sans
    // slash final, et l'ancienne URL resterait en 404.
    const { redirect } = contextFor("http://site.test/ancienne-offre/")
    await onRequest(contextFor("http://site.test/ancienne-offre/").context, next)
    expect(redirect).toBeDefined()
  })
})

describe("ce qu'il ne doit jamais avaler", () => {
  test("un lien d'aperçu passe intact", async () => {
    // Les jetons signent le slug et l'aperçu s'ouvre sur l'URL réelle de la
    // page. Rediriger ce lien casserait la prévisualisation d'une page dont
    // le slug vient de changer — précisément le moment où l'on s'en sert.
    const { context, redirect } = contextFor(
      "http://site.test/ancienne-offre?t=jeton",
    )
    const result = await onRequest(context, next)
    expect(redirect).not.toHaveBeenCalled()
    expect(result).toEqual({ passed: true })
  })

  test("les endpoints répondent pour eux-mêmes", async () => {
    const { context, redirect } = contextFor("http://site.test/api/revalidate")
    await onRequest(context, next)
    expect(redirect).not.toHaveBeenCalled()
  })

  test("l'optimiseur d'images d'Astro n'est jamais redirigé", async () => {
    // `/_image` sert chaque image optimisée du site : le rediriger les
    // casserait toutes d'un coup.
    const { context, redirect } = contextFor("http://site.test/_image?href=x")
    await onRequest(context, next)
    expect(redirect).not.toHaveBeenCalled()
  })

  test("un chemin sans redirection passe", async () => {
    const { context, redirect } = contextFor("http://site.test/contact")
    await onRequest(context, next)
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe("le mémo", () => {
  test("une seule lecture de Convex pour plusieurs requêtes", async () => {
    await onRequest(contextFor("http://site.test/a").context, next)
    await onRequest(contextFor("http://site.test/b").context, next)
    await onRequest(contextFor("http://site.test/c").context, next)
    // Sans mémo, chaque requête du site paierait un aller-retour réseau.
    expect(listActive).toHaveBeenCalledTimes(1)
  })

  test("la purge force une relecture", async () => {
    await onRequest(contextFor("http://site.test/a").context, next)
    expect(listActive).toHaveBeenCalledTimes(1)

    // C'est ce que `/api/revalidate` appelle : sans lui, une 301 fraîche
    // resterait invisible 60 s pendant que tout le reste se propage en
    // quelques secondes.
    purgeRedirectMemo()
    await onRequest(contextFor("http://site.test/b").context, next)
    expect(listActive).toHaveBeenCalledTimes(2)
  })
})
