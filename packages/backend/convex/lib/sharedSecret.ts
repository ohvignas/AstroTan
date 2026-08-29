// La comparaison d'un secret partagé, à un seul endroit.
//
// Ce fichier existe parce qu'il y en avait trois, et que le troisième ne
// suivait pas la même règle que les deux autres. `leads.submit` et
// `/api/revalidate` hachaient les deux côtés avant de comparer ;
// `consent.record` comparait les chaînes brutes. Une revue de sécurité l'a
// relevé — le seul comparateur du dépôt à ne pas appliquer sa propre règle.
//
// Une règle recopiée à trois endroits finit par diverger. Elle est ici.

import { ConvexError } from "convex/values"
import { timingSafeEqualHex } from "./previewToken"

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Compare un secret présenté au secret attendu, en temps constant.
 *
 * **Les deux côtés sont hachés avant comparaison**, et c'est le point de
 * tout le fichier. Un condensé fait toujours 64 caractères : la comparaison
 * ne peut donc ni sortir plus tôt sur des longueurs différentes, ni voir
 * son temps varier avec la longueur du secret attendu. Comparer les chaînes
 * brutes laisse fuir cette longueur par le temps de réponse — une fuite
 * ténue, mais gratuite à supprimer.
 *
 * Pas de `node:crypto` dans le runtime Convex : `crypto.subtle` fait le
 * travail, et il est asynchrone, d'où la promesse.
 *
 * @throws `NOT_CONFIGURED` si le secret attendu est absent — un
 * déploiement mal configuré refuse tout le monde. L'inverse
 * transformerait un oubli en porte ouverte, que personne ne verrait.
 * @throws `FORBIDDEN` si les deux ne correspondent pas.
 */
export async function assertSharedSecret(
  provided: string,
  expected: string | undefined,
): Promise<void> {
  if (!expected) throw new ConvexError({ code: "NOT_CONFIGURED" })
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)])
  if (!timingSafeEqualHex(a, b)) throw new ConvexError({ code: "FORBIDDEN" })
}
