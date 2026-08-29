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
  /** Meta (Facebook) Pixel — sa présence seule ouvre les origines de Meta. */
  PUBLIC_META_PIXEL_ID?: string
  /** Balise Google (`G-`, `AW-`, `GT-`) — même règle. */
  PUBLIC_GOOGLE_TAG_ID?: string
}

/**
 * Les origines qu'un traceur a besoin d'atteindre, une fois chargé.
 *
 * LE DÉFAUT QUE CES DEUX TABLES FERMENT
 *
 * `'strict-dynamic'` ne porte que sur `script-src`. Le bandeau injecte ses
 * balises par `document.createElement("script")` depuis un script noncé :
 * `fbevents.js` et `gtag/js` se CHARGENT donc. Ensuite, plus rien ne
 * passait — GA4 poste sur `google-analytics.com`, absent de `connect-src` ;
 * le pixel Meta émet un `<img src="https://www.facebook.com/tr?…">`, absent
 * d'`img-src` ; et `frame-src` non déclaré retombait sur `default-src
 * 'self'`, ce qui bloque les iframes de synchronisation de cookies.
 *
 * Le résultat était un site qui demande un accord, l'obtient, l'enregistre,
 * injecte la balise — et ne transmet rien. Aucun symptôme à l'écran : un
 * consentement décoratif.
 *
 * CE QUI RESTE FERMÉ
 *
 * Ces origines n'entrent dans la politique QUE si la variable de build
 * correspondante est posée. Un site sans pixel garde une CSP aussi stricte
 * qu'avant — c'est la condition pour que cet élargissement soit acceptable,
 * et le test « sans identifiant de traceur, la CSP ne nomme ni Google ni
 * Meta » la tient.
 *
 * Et la CSP n'est que la première des deux barrières : elle dit ce que le
 * navigateur AURAIT le droit de charger, pas ce qui est chargé. La seconde
 * — le consentement — reste entière dans `ConsentBanner.astro` : sans un
 * « oui », aucune balise n'est injectée, donc aucune de ces origines n'est
 * jamais contactée.
 *
 * `script-src` n'est délibérément pas élargi : `'strict-dynamic'` suffit sur
 * tout navigateur qui l'implémente, et c'est déjà par lui que ces balises
 * se chargent aujourd'hui.
 *
 * L'ASYMÉTRIE AVEC UMAMI, ASSUMÉE
 *
 * L'origine d'Umami, elle, EST écrite dans `script-src` — explicitement
 * « pour les navigateurs restés en CSP niveau 2 » (voir la directive plus
 * bas). Le même service n'est pas rendu aux traceurs consentis, et il faut
 * dire pourquoi, sinon le prochain lecteur conclura à un oubli et
 * « corrigera » l'asymétrie.
 *
 * La raison technique tient : les deux ne se chargent pas de la même
 * façon. Umami arrive par un `<script src>` du DOCUMENT
 * (`Analytics.astro`), que `'strict-dynamic'` ne couvre pas — sur un
 * navigateur qui l'implémente, ce script passe par son nonce ; sur un
 * navigateur de niveau 2, il ne passe QUE par la liste d'origines. Les
 * pixels, eux, arrivent par `createElement` depuis un script déjà noncé :
 * en niveau 3 c'est `'strict-dynamic'` qui les autorise, jamais la liste.
 *
 * Mais l'argument n'est pas symétrique pour autant, et c'est le point à
 * assumer : en CSP niveau 2, `'strict-dynamic'` est ignoré, donc les
 * pixels consentis NE SE CHARGENT PAS. On pourrait les ajouter ici. On ne
 * le fait pas, et c'est un choix : élargir `script-src` à
 * `connect.facebook.net` et `googletagmanager.com` rend ces origines
 * exécutables sur toute page du site, y compris pour un navigateur de
 * niveau 3 où `'strict-dynamic'` les couvrait déjà — on paierait une
 * surface d'exécution permanente pour un parc résiduel.
 *
 * Le mode de défaite décide : « le pixel ne se charge pas sur un vieux
 * navigateur » est un échec DANS LE SENS SÛR — on mesure moins, on ne fuit
 * rien. « Une origine tierce devient exécutable partout » est un échec dans
 * l'autre sens. Umami mérite la ligne parce que sans elle il ne se charge
 * nulle part en niveau 2 ; les pixels ne la méritent pas parce que sans
 * elle ils se chargent partout ailleurs.
 */
interface OriginesTraceur {
  connect: string[]
  img: string[]
  frame: string[]
}

/**
 * Meta — la liste que Meta publie pour son pixel.
 *
 * `connect.facebook.net` sert le script ET reçoit des requêtes ;
 * `www.facebook.com` reçoit le `/tr` (une image d'un pixel) et porte les
 * iframes de synchronisation.
 */
const META: OriginesTraceur = {
  connect: ["https://connect.facebook.net", "https://www.facebook.com"],
  img: ["https://www.facebook.com"],
  frame: ["https://www.facebook.com"],
}

/**
 * Google — la liste que Google publie pour GA4 et pour Google Ads.
 *
 * Les jokers ne sont pas de la paresse : le trafic européen de GA4 part sur
 * `region1.google-analytics.com`, et une origine écrite en dur n'aurait
 * couvert que le point d'entrée américain — soit exactement la panne
 * silencieuse qu'on répare, restreinte à l'Europe.
 *
 * Limite connue, à dire plutôt qu'à laisser découvrir : les conversions
 * Google Ads pingent aussi les domaines nationaux (`www.google.fr`…), que
 * `https://*.google.com` ne couvre pas. Les énumérer serait recopier la
 * liste des TLD de Google dans ce fichier ; un site qui en dépend ajoute le
 * sien ici.
 */
const GOOGLE: OriginesTraceur = {
  connect: [
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
    "https://*.g.doubleclick.net",
    "https://*.google.com",
  ],
  img: [
    "https://*.google-analytics.com",
    "https://*.googletagmanager.com",
    "https://*.g.doubleclick.net",
    "https://*.google.com",
  ],
  frame: ["https://*.doubleclick.net", "https://*.googletagmanager.com"],
}

/**
 * Les traceurs que CE déploiement peut charger, d'après sa configuration.
 *
 * Une chaîne vide ne compte pas : un build-arg non posé vaut `""`, jamais
 * `undefined`, et le traiter comme une valeur ouvrirait la CSP de tous les
 * adoptants qui n'ont aucun traceur.
 */
function traceurs(env: SecurityEnv): OriginesTraceur[] {
  const actifs: OriginesTraceur[] = []
  if (env.PUBLIC_META_PIXEL_ID) actifs.push(META)
  if (env.PUBLIC_GOOGLE_TAG_ID) actifs.push(GOOGLE)
  return actifs
}

/** Les origines d'une surface, dédoublonnées, préfixées d'un espace ou vides. */
function suffixe(origines: string[]): string {
  const uniques = [...new Set(origines)]
  return uniques.length === 0 ? "" : ` ${uniques.join(" ")}`
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
  // Normalisée comme Umami, et pas concaténée telle quelle : un slash final
  // sur `PUBLIC_CONVEX_URL` produirait une source de *chemin* là où une CSP
  // attend une origine. La faute de frappe est la même des deux côtés, elle
  // mérite le même traitement.
  const convex = origine(env.PUBLIC_CONVEX_URL)

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

  // Les origines des traceurs configurés — vides sur un site qui n'en a
  // aucun, ce qui laisse la politique exactement telle qu'elle était.
  const actifs = traceurs(env)
  const connectTiers = suffixe(actifs.flatMap((t) => t.connect))
  const imgTiers = suffixe(actifs.flatMap((t) => t.img))
  const frameTiers = suffixe(actifs.flatMap((t) => t.frame))

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
      //
      // Les origines des traceurs consentis, elles, ne sont PAS ajoutées
      // ici — asymétrie délibérée, dont le raisonnement complet est sur
      // `OriginesTraceur` plus haut : Umami se charge par un `<script src>`
      // du document, les pixels par `createElement` depuis un script noncé.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${umami ? ` ${umami}` : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // Le point de la tâche : pas d'image distante — sauf notre propre
      // stockage.
      //
      // Convex n'est pas un tiers, c'est le backend de ce site. Deux médias
      // ne traversent PAS le proxy `/_image` d'`astro:assets` et arrivent
      // donc au navigateur sur l'origine du déploiement :
      //
      //  - le favicon téléversé depuis Réglages → Identité, servi par un
      //    `<link rel="icon">` dont la destination de fetch est `image` ;
      //  - une image de la médiathèque collée dans le corps d'un article,
      //    rendu par `<Fragment set:html>` et jamais par `astro:assets`.
      //
      // Sans cette origine, les deux disparaissaient en silence. Ce qui reste
      // refusé est exactement ce que la tâche visait : un
      // `https://traqueur.exemple/pixel.gif` collé dans un article ne se
      // charge pas.
      //
      // L'origine est celle de `PUBLIC_CONVEX_URL` parce qu'elle a été
      // RELEVÉE, pas déduite : `ctx.storage.getUrl` rend
      // `http://127.0.0.1:3210/api/storage/<uuid>` — l'origine de l'API, et
      // non celle du site d'actions HTTP (`CONVEX_SITE_URL`, port 3211
      // en local, `*.convex.site` en nuage). Si un déploiement venait à
      // servir ses fichiers depuis le second, cette ligne serait fausse et il
      // faudrait une variable à elle.
      `img-src 'self' data: blob:${convex ? ` ${convex}` : ""}${imgTiers}`,
      // `data:` n'est pas une largesse : au build, Vite inline les petites
      // polices en `data:font/woff2;base64,…`. Sans lui, la production perd
      // ses polices là où le serveur de développement, qui les sert en
      // fichiers, n'en montrait rien. C'est la violation que seul un build
      // réel fait apparaître.
      "font-src 'self' data:",
      `connect-src 'self'${convex ? ` ${convex}` : ""}${umami ? ` ${umami}` : ""}${connectTiers}`,
      // `frame-src` n'apparaît QUE si un traceur est configuré. Absente, la
      // directive retombe sur `default-src 'self'` — la politique stricte
      // d'origine, qu'un site sans pixel doit garder intacte. L'écrire
      // inconditionnellement, ne serait-ce qu'en `'self'`, changerait la
      // CSP de tous les adoptants pour le confort de deux.
      ...(frameTiers ? [`frame-src 'self'${frameTiers}`] : []),
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
