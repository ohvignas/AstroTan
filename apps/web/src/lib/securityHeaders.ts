// Les en-têtes de sécurité du site public.
//
// La CSP est la seule chose qui rend l'invariant « aucune requête tierce
// sans accord » vrai PAR LE SERVEUR et non par discipline. Sans elle, un
// `<img src="https://ailleurs/pixel.gif">` collé dans le corps d'un article
// charge un tiers à chaque lecture, hors du bandeau — la seule brèche que
// l'audit de sécurité a laissée ouverte.

export interface SecurityEnv {
  PUBLIC_CONVEX_URL?: string
  PUBLIC_UMAMI_URL?: string
}

export function nouveauNonce(): string {
  const octets = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...octets)).replace(/[+/=]/g, "")
}

/**
 * L'origine d'une URL de configuration, ou `null` si elle est absente ou
 * illisible.
 *
 * Une CSP ne prend pas une URL, elle prend une *origine* : le slash final de
 * `https://umami.exemple.fr/` en fait une source de chemin, et la faute de
 * frappe ne se voit nulle part — le script se charge encore, mais plus rien
 * ne remonte. On normalise donc plutôt que de recopier la variable telle
 * quelle.
 */
function origine(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function enTetesSecurite(
  nonce: string,
  env: SecurityEnv,
  https = false,
): Record<string, string> {
  const convex = env.PUBLIC_CONVEX_URL ?? ""

  // Umami n'est PAS `'self'` : le script vient de son propre domaine et y
  // reposte chaque vue. Le brief n'en parlait pas, et c'est exactement le
  // genre d'omission qui coûte cher — une CSP qui casse la mesure d'audience
  // ne casse rien de visible, elle arrête juste de compter.
  //
  //  - `script-src` : `<script src="${umami}/script.js">` dans
  //    `Analytics.astro`, et `recorder.js` injecté après consentement.
  //  - `connect-src` : `script.js` poste ses vues sur `${umami}/api/send`.
  //    `'strict-dynamic'` ne couvre que `script-src` — un script autorisé ne
  //    gagne aucun droit de connexion.
  const umami = origine(env.PUBLIC_UMAMI_URL)

  const entetes: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      // Les scripts du consentement sont en ligne : ils portent le nonce.
      // `'strict-dynamic'` autorise ce qu'ils injectent APRÈS accord — un
      // pixel accepté doit pouvoir se charger, un pixel injecté par une
      // faille ne le peut pas, faute de nonce sur son parent.
      //
      // Conséquence à connaître : sur un navigateur qui implémente
      // `'strict-dynamic'`, `'self'` et la liste d'origines qui suivent sont
      // IGNORÉS. Tout `<script>` du document doit donc porter le nonce, y
      // compris ceux qu'Astro bundle lui-même — c'est ce que fait le
      // middleware. `'self'` et l'origine Umami restent écrits pour les
      // navigateurs restés en CSP niveau 2, où seule cette liste répond.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${umami ? ` ${umami}` : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // Le point de la tâche : pas d'image distante.
      "img-src 'self' data: blob:",
      // `data:` n'est pas une largesse : au build, Vite inline les petites
      // polices en `data:font/woff2;base64,…`. Sans lui, la production perd
      // ses polices là où le serveur de développement, qui les sert en
      // fichiers, n'en montrait rien. C'est la violation que seul un build
      // réel fait apparaître.
      "font-src 'self' data:",
      `connect-src 'self' ${convex}${umami ? ` ${umami}` : ""}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  }
  // Jamais en HTTP : posé sur `http://localhost`, HSTS épingle le
  // navigateur sur une origine sans certificat, et le site devient
  // inaccessible jusqu'à purge manuelle.
  if (https) {
    entetes["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  }
  return entetes
}
