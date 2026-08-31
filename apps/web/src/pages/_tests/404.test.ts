import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test, vi } from "vitest"

// Le 404 du site, rendu pour de vrai.
//
// Ce dossier est préfixé d'un `_` parce qu'Astro route TOUT ce qui vit sous
// `src/pages/` : un `.test.ts` posé à côté de `404.astro` deviendrait une
// route et casserait `astro build` alors que la suite resterait verte.
// Même raison que `pages/api/_tests/`.
//
// CE QUE CE TEST VÉRIFIE, et pourquoi chaque point y est :
//
//   · le STATUT. Une page d'erreur qui répond 200 se fait indexer : le
//     moteur croit avoir trouvé une page, et c'est elle qui remonte à la
//     place de celle qui a disparu. C'est le seul point qu'aucune
//     relecture du balisage ne peut attraper, et c'est pour lui qu'on rend
//     une `Response` (`renderToResponse`) plutôt qu'une chaîne ;
//   · la LANGUE et la MISE EN PAGE. Sans fichier `404.astro`, Astro sert
//     son propre écran de secours — `<html lang="en">`, « 404: Not
//     Found », fond sombre, aucun en-tête ni pied de page du site. C'est
//     l'état dans lequel ce dépôt était, et il n'atteint jamais l'auteur du
//     template : seulement chaque adoptant, sur chaque lien mort.
//
// Convex est simulé parce que `BaseLayout` en dépend par trois chemins
// (`PageHead`, `Header`, `Footer`) et qu'aucun d'eux n'est le sujet ici.
// `null` est la réponse d'un déploiement neuf sans réglages — donc le cas
// le plus défavorable, celui où rien ne vient adoucir la page.

vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query: async () => null }),
}))

async function rendre404(): Promise<Response> {
  const container = await AstroContainer.create()
  const { default: NotFound } = await import("../404.astro")
  return container.renderToResponse(NotFound, {
    // Le middleware pose ce nonce sur chaque requête réelle ; hors serveur
    // il faut le fournir, sinon `BaseLayout` lève « Astro is not defined »
    // au rendu.
    locals: { nonce: "test-nonce" },
  })
}

test("une URL inconnue répond 404, jamais 200", async () => {
  const response = await rendre404()
  expect(response.status).toBe(404)
})

test("le 404 est en français et porte la mise en page du site", async () => {
  const html = await (await rendre404()).text()

  // La signature exacte de l'écran de secours d'Astro, qu'on refuse.
  expect(html).not.toContain('lang="en"')
  expect(html).not.toContain("404: Not Found")

  expect(html).toContain('lang="fr"')
  expect(html).toContain("<title>Page introuvable</title>")
  expect(html).toContain("Cette page n'existe pas")

  // L'en-tête et le pied de page du site, c'est-à-dire `BaseLayout` : ce
  // qui distingue une vraie page d'erreur d'un écran de secours nu.
  expect(html).toContain("<header")
  expect(html).toContain("<footer")

  // Un chemin de retour, et pas seulement un constat.
  expect(html).toContain('href="/"')
})

test("BaseLayout rend le corps 404 quand le statut est 404, même si le slot a du contenu", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./Status404Slot.astro")
  const html = await container.renderToString(Page, {
    locals: { nonce: "test-nonce" },
  })
  expect(html).toContain("Cette page n'existe pas")
  expect(html).not.toContain("CONTENU-INTERDIT-EN-404")
})

test("/blog avec page=null n'est pas un 404", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./BlogIndexSlot.astro")
  const response = await container.renderToResponse(Page, {
    locals: { nonce: "test-nonce" },
  })
  expect(response.status).toBe(200)
  const html = await response.text()
  expect(html).toContain("<h1>Blog</h1>")
  expect(html).not.toContain("Cette page n'existe pas")
})
