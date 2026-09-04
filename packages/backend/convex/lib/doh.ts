import { estHoteNu } from "./hoteNu"

// Interroger le DNS depuis Convex.
//
// Le runtime Convex par défaut est un isolat V8 : ni `node:dns`, ni
// `node:net`. Aucun fichier de ce dépôt ne porte `"use node"`, et en poser
// un pour une résolution DNS ferait basculer tout le module dans un
// runtime plus lent et différemment contraint. Le DNS passe donc par
// HTTPS, comme les autres appels sortants du dépôt (`analytics.ts`,
// `lib/umamiToken.ts`).
//
// Cloudflare DoH (JSON) : gratuit, sans clé, Accept: application/dns-json.
//   https://cloudflare-dns.com/dns-query?name=…&type=A
// Second avis possible, non branché : https://dns.google/resolve?name=…&type=A
// Le choix est figé ici — un résolveur configurable serait une surface SSRF.
export const RESOLVEUR = "https://cloudflare-dns.com/dns-query"

/** 8 s, la même borne que les appels Umami (`analytics.ts`). */
const DELAI_MS = 8_000

export type TypeDns = "A" | "AAAA" | "TXT" | "CNAME" | "MX"

export type ReponseDns =
  | { statut: "ok"; valeurs: string[] }
  /** Le nom ne porte pas cet enregistrement — réponse ordinaire, pas une panne. */
  | { statut: "absent"; nxdomain?: boolean }
  | { statut: "erreur"; raison: string }

/**
 * Un label de service : `_dmarc`, `_domainkey`, `_acme-challenge`.
 *
 * La forme est celle de RFC 8552 : un souligné de tête, précisément parce
 * qu'aucun nom d'hôte ne peut en porter — c'est ce qui garantit qu'un
 * enregistrement de service n'entre jamais en collision avec un hôte.
 */
const LABEL = /^_?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Ce nom peut-il être interrogé ?
 *
 * Tous les noms du DNS ne sont pas des hôtes. DKIM et DMARC vivent sous
 * des labels soulignés — `_dmarc.exemple.fr`, `resend._domainkey.exemple.fr`
 * — que `estHoteNu` refuse, et à juste titre : il décrit un hôte
 * *joignable*, ce qu'il faut pour `WEB_DOMAIN`, pas pour une requête DNS.
 * Assouplir `estHoteNu` ferait accepter `_dmarc.exemple.fr` là où un
 * domaine de site est attendu ; la distinction se fait donc ici.
 *
 * Le nom est coupé au DERNIER label souligné : ce qui suit doit être un
 * hôte nu (c'est le domaine de l'adoptant), ce qui précède doit être une
 * suite de labels ordinaires ou de service — dans `resend._domainkey.x`,
 * le souligné n'est pas en tête, le sélecteur le précède.
 */
export function estNomInterrogeable(nom: string): boolean {
  if (nom.length < 1 || nom.length > 253) return false
  const labels = nom.split(".")
  let dernierSouligne = -1
  for (let i = 0; i < labels.length; i += 1) {
    if ((labels[i] as string).startsWith("_")) dernierSouligne = i
  }
  if (dernierSouligne === -1) return estHoteNu(nom)
  const prefixe = labels.slice(0, dernierSouligne + 1)
  const domaine = labels.slice(dernierSouligne + 1).join(".")
  return prefixe.every((label) => LABEL.test(label)) && estHoteNu(domaine)
}

/**
 * L'URL de requête vers le résolveur, pour un nom et un type donnés.
 *
 * `estNomInterrogeable` avant l'interpolation, et non `encodeURIComponent` :
 * le nom vient d'un champ de saisie et part vers un tiers. Une validation
 * qui n'accepte QUE la forme attendue vaut mieux qu'un échappement qui
 * laisse passer des formes qu'on n'a pas imaginées — elle ne laisse
 * survivre que `[a-z0-9._-]`, un alphabet qui ne contient aucun des
 * caractères qui donnent un sens spécial à une URL (`&`, `=`, `?`, `#`,
 * `/`, `%`, `@`, un espace) : il n'y a donc pas de forme qui passe la
 * validation et reste dangereuse une fois interpolée. Le souligné, seul
 * ajout à l'alphabet de `estHoteNu`, n'en a pas davantage.
 */
export function urlRequete(nom: string, type: TypeDns): string {
  if (!estNomInterrogeable(nom)) throw new Error(`Nom DNS invalide : ${nom}`)
  return `${RESOLVEUR}?name=${nom}&type=${type}`
}

/**
 * Interprète la charge JSON du résolveur.
 *
 * Distingue trois choses qu'un code paresseux confondrait : l'enregistrement
 * demandé n'existe pas (`"absent"`, Status 0 sans réponse), le NOM entier
 * n'existe pas (`"absent"` aussi, Status 3 = NXDOMAIN — DoH ne dit pas
 * plus, mais dans les deux cas l'écran affiche la même instruction :
 * « créez cet enregistrement »), et le résolveur n'a pas su répondre
 * (`"erreur"`, tout le reste). Confondre le premier avec le troisième ferait
 * dire à l'écran de créer un enregistrement qui existe déjà.
 */
export function lireReponse(charge: unknown): ReponseDns {
  if (typeof charge !== "object" || charge === null) {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
  const objet = charge as { Status?: unknown; Answer?: unknown }
  if (typeof objet.Status !== "number") {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
  // 3 = NXDOMAIN. 0 sans réponse = le nom existe mais pas ce type.
  if (objet.Status === 3) return { statut: "absent", nxdomain: true }
  if (objet.Status !== 0) {
    return { statut: "erreur", raison: `Le résolveur DNS a répondu ${objet.Status}.` }
  }
  const reponses = Array.isArray(objet.Answer) ? objet.Answer : []
  const valeurs = reponses
    .map((ligne) => (ligne as { data?: unknown }).data)
    .filter((data): data is string => typeof data === "string")
    // Un TXT long est découpé en segments guillemetés et concaténés par le
    // résolveur : `"v=spf1 " "include:x ~all"`. On retire les guillemets et
    // on recolle, sinon aucune comparaison ne trouve jamais rien.
    .map((data) => data.replace(/"\s*"/g, "").replace(/^"|"$/g, "").trim())
    .filter((valeur) => valeur.length > 0)
  return valeurs.length === 0 ? { statut: "absent" } : { statut: "ok", valeurs }
}

function raisonFetch(err: unknown): string {
  const nom =
    err instanceof Error
      ? err.name
      : err instanceof DOMException
        ? err.name
        : ""
  if (nom === "TimeoutError" || nom === "AbortError") {
    return "Délai dépassé — Cloudflare n'a pas répondu."
  }
  return "Réseau : le résolveur est injoignable."
}

export async function resoudre(nom: string, type: TypeDns): Promise<ReponseDns> {
  let reponse: Response
  try {
    reponse = await fetch(urlRequete(nom, type), {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DELAI_MS),
    })
  } catch (err) {
    // Le nom invalide lève aussi ici. Dans les deux cas l'écran doit
    // afficher une ligne, jamais faire tomber la vérification entière.
    return { statut: "erreur", raison: raisonFetch(err) }
  }
  if (!reponse.ok) {
    return { statut: "erreur", raison: `Le résolveur DNS a répondu ${reponse.status}.` }
  }
  try {
    return lireReponse(await reponse.json())
  } catch {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
}
