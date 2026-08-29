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
// Cloudflare plutôt que Google : c'est le seul des deux qui publie une
// politique de non-conservation des requêtes, et l'écran envoie le domaine
// de l'adoptant. Le choix est écrit ici plutôt que dans un réglage — un
// résolveur configurable serait une valeur saisie par l'opérateur vers
// laquelle on ferait des requêtes sortantes, donc une surface SSRF pour
// une souplesse dont personne n'a besoin.
export const RESOLVEUR = "https://cloudflare-dns.com/dns-query"

/** 8 s, la même borne que les appels Umami (`analytics.ts`). */
const DELAI_MS = 8_000

export type TypeDns = "A" | "AAAA" | "TXT" | "CNAME" | "MX"

export type ReponseDns =
  | { statut: "ok"; valeurs: string[] }
  /** Le nom ne porte pas cet enregistrement — réponse ordinaire, pas une panne. */
  | { statut: "absent" }
  | { statut: "erreur"; raison: string }

/**
 * L'URL de requête vers le résolveur, pour un nom et un type donnés.
 *
 * `estHoteNu` avant l'interpolation, et non `encodeURIComponent` : le nom
 * vient d'un champ de saisie et part vers un tiers. Une validation qui
 * n'accepte QUE la forme attendue vaut mieux qu'un échappement qui laisse
 * passer des formes qu'on n'a pas imaginées — `estHoteNu` ne laisse
 * survivre que `[a-z0-9.-]`, un alphabet qui ne contient aucun des
 * caractères qui donnent un sens spécial à une URL (`&`, `=`, `?`, `#`,
 * `/`, `%`, `@`, un espace) : il n'y a donc pas de forme qui passe la
 * validation et reste dangereuse une fois interpolée.
 */
export function urlRequete(nom: string, type: TypeDns): string {
  if (!estHoteNu(nom)) throw new Error(`Nom DNS invalide : ${nom}`)
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
  if (objet.Status === 3) return { statut: "absent" }
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

export async function resoudre(nom: string, type: TypeDns): Promise<ReponseDns> {
  let reponse: Response
  try {
    reponse = await fetch(urlRequete(nom, type), {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DELAI_MS),
    })
  } catch {
    // Le nom invalide lève aussi ici. Dans les deux cas l'écran doit
    // afficher une ligne, jamais faire tomber la vérification entière.
    return { statut: "erreur", raison: "Le résolveur DNS est injoignable." }
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
