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

// Des `Response` réelles, pas des objets témoins : le middleware pose
// maintenant des en-têtes et relit le corps du HTML. Un faux objet passerait
// des tests que le vrai code fait échouer.
function contextFor(url: string, entetes: Record<string, string> = {}) {
  const redirect = vi.fn(
    (to: string, code: number) =>
      new Response(null, { status: code, headers: { Location: to } }) as never,
  )
  return {
    context: {
      url: new URL(url),
      request: new Request(url, { headers: entetes }),
      locals: {},
      redirect,
    } as never,
    redirect,
  }
}

const next = vi.fn(() => new Response("passed") as never)

function htmlNext(html: string) {
  return vi.fn(
    () =>
      new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }) as never,
  )
}

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
    expect(await (result as Response).text()).toBe("passed")
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

describe("les en-têtes de sécurité", () => {
  test("toute réponse les porte", async () => {
    const { context } = contextFor("http://site.test/contact")
    const response = (await onRequest(context, next)) as Response
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
  })

  test("une redirection les porte aussi", async () => {
    // Une 301 est une réponse comme une autre : sans en-têtes, `X-Frame-Options`
    // manquerait précisément sur les URL les plus anciennes du site.
    const { context } = contextFor("http://site.test/ancienne-offre")
    const response = (await onRequest(context, next)) as Response
    expect(response.status).toBe(301)
    expect(response.headers.get("X-Frame-Options")).toBe("DENY")
  })

  test("le nonce change à chaque requête", async () => {
    const un = (await onRequest(contextFor("http://site.test/a").context, next)) as Response
    const deux = (await onRequest(contextFor("http://site.test/b").context, next)) as Response
    expect(un.headers.get("Content-Security-Policy")).not.toBe(
      deux.headers.get("Content-Security-Policy"),
    )
  })

  test("HSTS suit `x-forwarded-proto`, pas le protocole du conteneur", async () => {
    // Derrière Traefik, le conteneur ne voit que du HTTP en clair. Se fier à
    // `context.url` reviendrait à n'envoyer HSTS jamais, en production
    // comprise — et à l'envoyer sur `http://localhost` le jour où l'on
    // développerait en HTTPS, ce qui rend le site injoignable.
    const clair = (await onRequest(contextFor("http://site.test/a").context, next)) as Response
    expect(clair.headers.get("Strict-Transport-Security")).toBeNull()

    const derriereProxy = (await onRequest(
      contextFor("http://site.test/a", { "x-forwarded-proto": "https" }).context,
      next,
    )) as Response
    expect(derriereProxy.headers.get("Strict-Transport-Security")).toContain("max-age=")
  })
})

describe("le nonce posé sur le document", () => {
  test("un `<script>` sans nonce en reçoit un, et c'est celui de la CSP", async () => {
    // Le module qu'Astro produit en bundlant le script de `ConsentBanner` n'a
    // pas de fichier source où écrire l'attribut. Sous `'strict-dynamic'`,
    // `'self'` est ignoré : sans cette passe, le bandeau ne démarre pas.
    const { context } = contextFor("http://site.test/contact")
    const response = (await onRequest(
      context,
      htmlNext('<html><body><script type="module" src="/_astro/x.js"></script></body></html>'),
    )) as Response
    const html = await response.text()
    const nonce = /nonce="([^"]+)"/.exec(html)?.[1]
    expect(nonce).toBeTruthy()
    expect(response.headers.get("Content-Security-Policy")).toContain(`'nonce-${nonce}'`)
  })

  test("une balise ne se retrouve jamais avec deux nonces", async () => {
    const { context } = contextFor("http://site.test/contact")
    const response = (await onRequest(
      context,
      htmlNext('<script nonce="deja">1</script>'),
    )) as Response
    const html = await response.text()
    expect(html.match(/nonce=/g)).toHaveLength(1)
  })

  test("un `<script>` échappé dans le texte d'une page n'est pas touché", async () => {
    // `index.astro` montre `<script type="application/ld+json">` dans un
    // extrait de code. Rendu, c'est `&lt;script` : du texte, pas une balise.
    const { context } = contextFor("http://site.test/")
    const response = (await onRequest(context, htmlNext("<p>&lt;script&gt;</p>"))) as Response
    expect(await response.text()).toBe("<p>&lt;script&gt;</p>")
  })

  test("une réponse qui n'est pas du HTML n'est pas relue", async () => {
    const { context } = contextFor("http://site.test/api/health")
    const json = vi.fn(
      () =>
        new Response('{"script":"<script>"}', {
          headers: { "content-type": "application/json" },
        }) as never,
    )
    const response = (await onRequest(context, json)) as Response
    expect(await response.text()).toBe('{"script":"<script>"}')
  })
})

describe("le nonce d'un corps venu du cache", () => {
  test("un nonce périmé est remplacé, jamais respecté", async () => {
    // `Astro.cache` garde le HTML 300 s. Servi tel quel, il nommerait le
    // nonce d'une requête précédente pendant que l'en-tête en nomme un autre :
    // tous les scripts du site bloqués, cinq minutes, sans erreur serveur.
    const { context } = contextFor("http://site.test/contact")
    const response = (await onRequest(
      context,
      htmlNext('<script nonce="perime" type="module" src="/a.js"></script>'),
    )) as Response
    const html = await response.text()
    expect(html).not.toContain("perime")
    const nonce = /nonce="([^"]+)"/.exec(html)?.[1]
    expect(response.headers.get("Content-Security-Policy")).toContain(`'nonce-${nonce}'`)
    // Les autres attributs de la balise survivent au remplacement.
    expect(html).toContain('type="module"')
    expect(html).toContain('src="/a.js"')
  })
})
