import type { APIContext, MiddlewareHandler, MiddlewareNext } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "./lib/convexClient"
import { enTetesSecurite, nouveauNonce } from "./lib/securityHeaders"

// Redirects, resolved before any route runs.
//
// Running before the route is the whole point — an old URL must answer
// without its page existing — and it is also the danger: anything this
// swallows never reaches the page that would have served it. Which is why
// the guard against claiming a live path is at write time, in Convex, and
// not here.

interface Redirect {
  from: string
  to: string
  code: 301 | 302
}

const MEMO_TTL_MS = 60_000

let memo: { rows: Redirect[]; expiresAt: number } | null = null

/**
 * Drop the memo so the next request rereads Convex.
 *
 * Called by `/api/revalidate` when a publication invalidates the site. A
 * 60-second memo means a freshly minted 301 would otherwise stay invisible
 * for a minute — while the rest of the system propagates in seconds. This
 * is what keeps redirects on the same clock as everything else.
 */
export function purgeRedirectMemo(): void {
  memo = null
}

async function activeRedirects(): Promise<Redirect[]> {
  if (memo !== null && memo.expiresAt > Date.now()) return memo.rows
  const rows = (await getConvexClient().query(
    api.redirects.listActive,
    {}
  )) as Redirect[]
  memo = { rows, expiresAt: Date.now() + MEMO_TTL_MS }
  return rows
}

function normalize(pathname: string): string {
  return pathname.replace(/^\/+/, "").replace(/\/+$/, "")
}

async function router(
  context: APIContext,
  next: MiddlewareNext,
): Promise<Response> {
  // A preview link must reach its page. Tokens sign the slug and a preview
  // opens at the article's real URL (`/tarifs?t=…`), so redirecting one
  // would break previewing a page whose slug just changed — which is
  // exactly when someone previews it.
  if (context.url.searchParams.has("t")) return next()

  // Endpoints answer for themselves; `/_image` is Astro's own optimiser and
  // must never be redirected, or every optimised image on the site breaks.
  const path = context.url.pathname
  if (path.startsWith("/api/") || path.startsWith("/_")) return next()

  const from = normalize(path)
  if (from.length === 0) return next()

  const match = (await activeRedirects()).find((row) => row.from === from)
  if (match === undefined) return next()

  return context.redirect(match.to, match.code)
}

/**
 * Le site est-il servi en HTTPS pour ce visiteur ?
 *
 * Derrière Traefik, le conteneur reçoit du HTTP en clair : `context.url` dit
 * `http:` alors que le navigateur, lui, parle en HTTPS. Se fier à elle seule
 * reviendrait à ne jamais envoyer HSTS en production. `x-forwarded-proto` est
 * ce que le reverse proxy pose, et c'est la seule source qui décrit la
 * connexion réelle.
 */
function enHttps(context: APIContext): boolean {
  const transmis = context.request.headers.get("x-forwarded-proto")
  // Une chaîne de proxys écrit `https, http` : le premier maillon est
  // celui qui a parlé au navigateur.
  if (transmis) return transmis.split(",")[0]?.trim() === "https"
  return context.url.protocol === "https:"
}

/**
 * Poser le nonce sur tout `<script>` du document qui n'en porte pas déjà.
 *
 * Ce n'est pas une commodité, c'est ce qui rend `'strict-dynamic'` utilisable.
 * `'strict-dynamic'` fait IGNORER `'self'` et la liste d'origines par le
 * navigateur : à partir de là, un `<script>` écrit dans le HTML n'a plus
 * qu'une façon de s'exécuter, c'est de porter le nonce. Les scripts que
 * nous écrivons le portent depuis leur composant, mais deux familles ne le
 * peuvent pas :
 *
 *  - le module qu'Astro produit en bundlant `<script>` de `ConsentBanner` —
 *    la balise est générée, aucun fichier source ne la contient ;
 *  - les scripts que Vite injecte en développement (`/@vite/client`, les
 *    modules de style, la barre d'outils).
 *
 * Sans cette passe, le bandeau de consentement ne démarre pas — et comme il
 * n'apparaît que si un tiers est configuré, la panne se lit « le bandeau ne
 * s'affiche plus », jamais « la CSP l'a bloqué ».
 *
 * Le `<script>` échappé qui apparaît dans le texte d'une page (`index.astro`
 * en montre un dans un extrait de code) est rendu `&lt;script`, hors de
 * portée de cette expression.
 *
 * On REMPLACE un nonce déjà présent au lieu de le respecter. Le corps peut
 * venir du cache de route (`Astro.cache`, `maxAge: 300`) et porter alors le
 * nonce d'une requête précédente : le laisser en place donnerait un document
 * dont les scripts nomment un nonce que l'en-tête ne nomme plus — c'est-à-dire
 * un site entièrement bloqué, cinq minutes durant, sans qu'aucun test ne
 * l'attrape. Après cette passe, l'invariant est vrai sans condition : tout
 * `<script>` du document porte le nonce que cette réponse annonce.
 */
function poserLeNonce(html: string, nonce: string): string {
  return html.replace(/<script\b[^>]*>/gi, (balise) => {
    const sansNonce = balise.replace(/\snonce="[^"]*"/gi, "")
    return `<script nonce="${nonce}"${sansNonce.slice("<script".length)}`
  })
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  // Un nonce par requête, et jamais deux fois le même : réutilisé, il cesse
  // d'être un nonce et redevient une autorisation qu'un script injecté n'a
  // qu'à recopier.
  const nonce = nouveauNonce()
  context.locals.nonce = nonce

  const response = await router(context, next)

  for (const [nom, valeur] of Object.entries(
    enTetesSecurite(nonce, import.meta.env, enHttps(context)),
  )) {
    response.headers.set(nom, valeur)
  }

  // Seul le HTML porte des `<script>`. Relire le corps d'un JSON, d'un
  // sitemap ou d'une image coûterait pour rien.
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html") || response.body === null) return response

  const html = poserLeNonce(await response.text(), nonce)
  const entetes = new Headers(response.headers)
  // Le corps a changé de taille : une longueur héritée décrirait l'ancien.
  entetes.delete("content-length")
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: entetes,
  })
}
