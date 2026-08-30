// Le chiffrement d'enveloppe des jetons saisis depuis l'interface.
//
// POURQUOI CE FICHIER EXISTE
//
// Une variable d'environnement Convex ne se pose qu'au déploiement, par la
// CLI ou le tableau de bord — aucune API ne permet à une mutation d'en
// écrire une. Un jeton saisi dans l'interface finit donc forcément en base,
// ce qui est un cran en dessous de l'environnement en sécurité. Ce module
// est ce qui rend ce cran aussi étroit que possible.
//
// La clé maîtresse (`SECRETS_KEY`) vit dans l'environnement Convex, posée
// une seule fois par la CLI, et n'est JAMAIS saisissable depuis l'écran :
// si elle l'était, elle serait rangée au même endroit que ce qu'elle
// protège, et le chiffrement ne serait que décoratif.
//
// Ce que le dispositif achète, exactement : une copie de la base ne suffit
// plus. Un export de sauvegarde, un accès au tableau de bord Convex, une
// query mal écrite qui renverrait la ligne entière — aucun des trois ne
// donne le jeton, il faut aussi `SECRETS_KEY`, qui vit ailleurs.
//
// Ce qu'il n'achète PAS, et il faut le dire : quiconque peut exécuter du
// code sur ce déploiement lit `SECRETS_KEY` dans `process.env` et déchiffre
// tout. C'est un chiffrement au repos, pas un coffre. L'environnement reste
// strictement plus sûr, et c'est pour cela qu'il gagne (voir `secrets.ts`).
//
// Aucune fonction Convex ici : ce module est pur, donc testable directement,
// et importable depuis un test sans monter de déploiement.

export const SECRETS_KEY_VAR = "SECRETS_KEY"

/** La commande exacte, reprise telle quelle par le message de refus et par l'écran. */
export const SECRETS_KEY_COMMANDE =
  'cd packages/backend && npx convex env set SECRETS_KEY "$(openssl rand -base64 32)"'

/**
 * 12 octets — la taille d'IV recommandée pour AES-GCM, et la seule pour
 * laquelle le mode est spécifié sans dérivation supplémentaire.
 */
export const IV_LENGTH = 12

/** AES-256 : 32 octets, et rien d'autre n'est accepté. */
export const KEY_LENGTH = 32

export type CleMaitresse =
  | { ok: true; octets: Uint8Array }
  /** Absente : l'écriture refuse et l'écran donne la commande. */
  | { ok: false; raison: "MISSING" }
  /**
   * Présente mais inutilisable — mal recopiée, tronquée, ou pas 32 octets.
   * Distinguée de « absente » à dessein : le remède n'est pas le même, et
   * « je l'ai pourtant posée » est exactement le moment où un message
   * indistinct fait perdre une heure.
   */
  | { ok: false; raison: "MALFORMED" }

function decodeBase64(valeur: string): Uint8Array | null {
  try {
    const binaire = atob(valeur.trim())
    const octets = new Uint8Array(binaire.length)
    for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i)
    return octets
  } catch {
    return null
  }
}

/**
 * La clé maîtresse telle que l'environnement la porte.
 *
 * `env` est passé plutôt que lu directement dans `process.env` pour la même
 * raison que `readUmamiConfig` : un test doit pouvoir décrire l'absence
 * sans toucher au processus.
 */
export function lireCleMaitresse(
  env: Record<string, string | undefined>
): CleMaitresse {
  const brut = env[SECRETS_KEY_VAR]
  if (!brut || brut.trim().length === 0) return { ok: false, raison: "MISSING" }
  const octets = decodeBase64(brut)
  if (octets === null || octets.length !== KEY_LENGTH) {
    return { ok: false, raison: "MALFORMED" }
  }
  return { ok: true, octets }
}

async function importer(
  octets: Uint8Array,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  // `extractable: false` : la clé importée ne peut plus ressortir de
  // `crypto.subtle`, donc aucun chemin de code ne peut la relire ni la
  // journaliser par accident.
  return crypto.subtle.importKey(
    "raw",
    octets as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    [usage]
  )
}

/**
 * Chiffre une valeur, avec un IV NEUF.
 *
 * À n'appeler que depuis une `action`. Les queries et les mutations Convex
 * sont contraintes au déterminisme et leur aléa est ensemencé : deux
 * chiffrements pourraient y recevoir le même IV, et un IV réutilisé avec la
 * même clé casse la garantie d'AES-GCM — c'est le seul mode d'emploi que
 * ce mode ne pardonne pas. Une action n'a pas cette contrainte.
 */
export async function chiffrer(
  cle: Uint8Array,
  clair: string
): Promise<{ iv: ArrayBuffer; chiffre: ArrayBuffer }> {
  const key = await importer(cle, "encrypt")
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const chiffre = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(clair) as unknown as BufferSource
  )
  return { iv: iv.buffer.slice(0) as ArrayBuffer, chiffre }
}

/**
 * Rend la valeur en clair, ou lève.
 *
 * AES-GCM est authentifié : un chiffré modifié d'un seul octet, ou déchiffré
 * avec une autre clé, fait échouer `decrypt` au lieu de rendre des octets
 * plausibles. On ne le suppose pas — `secretsCrypto.test.ts` le vérifie.
 */
export async function dechiffrer(
  cle: Uint8Array,
  iv: ArrayBuffer,
  chiffre: ArrayBuffer
): Promise<string> {
  const key = await importer(cle, "decrypt")
  const clair = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) as unknown as BufferSource },
    key,
    chiffre
  )
  return new TextDecoder().decode(clair)
}
