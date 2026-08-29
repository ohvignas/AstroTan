// Valider une URL de webhook choisie par l'opérateur.
//
// Un champ d'URL librement éditable qui déclenche une requête sortante est
// une machine à faire faire des appels à notre serveur — c'est la faille
// SSRF. Chez un hébergeur, `http://169.254.169.254/` rend les jetons
// d'identité de l'instance ; sur un réseau privé, `http://10.0.0.5/`
// atteint ce qui n'est pas censé être joignable depuis dehors.
//
// La liste ci-dessous refuse ce qui est manifestement interne. Elle n'est
// pas une preuve : un nom de domaine public peut résoudre vers une adresse
// privée, et seule une résolution DNS au moment de l'appel l'attraperait —
// et un enregistrement DNS peut changer après coup. C'est une barrière, pas
// une garantie — et le dire ici évite qu'on la prenne pour ce qu'elle n'est
// pas.
//
// Une IPv4 écrite en notation non pointée — décimale pure (`2130706433`),
// octale (`0177.0.0.1`), hexadécimale (`0x7f000001`), ou compressée
// (`127.1`) — n'a pas besoin d'un parsing dédié ici : le parseur d'hôte de
// la spec WHATWG URL la canonicalise en notation pointée classique avant
// que `url.hostname` ne soit lu plus bas. Ce n'est pas une particularité
// de Node : c'est l'algorithme de parsing lui-même, et il a été vérifié
// tel quel sous `edge-runtime` (l'environnement de test de ce projet,
// voir `vitest.config.ts`), pas seulement supposé. `isPrivateIpv4` ne voit
// donc jamais ces formes-là — elle voit déjà `127.0.0.1`, et un parseur
// dédié ici serait du code mort, inatteignable via `refuseWebhookUrl`.

export type WebhookUrlRefusal =
  | "NOT_A_URL"
  | "NOT_HTTPS"
  | "INTERNAL_ADDRESS"
  | "TOO_LONG"

const MAX_WEBHOOK_URL_LENGTH = 2_048

/** Ce qui ne peut pas être une destination légitime. */
const INTERNAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  // L'adresse de métadonnées d'AWS, GCP et Azure. Celle-ci, avant toutes
  // les autres : elle rend des identifiants, pas seulement des données.
  "169.254.169.254",
  "metadata.google.internal",
])

/** Les octets d'une IPv4 déjà résolue appartiennent-ils à une plage interne ? */
function isPrivateOctets([a, b]: [number, number, number, number]): boolean {
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // boucle locale
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // lien-local, dont les métadonnées
  )
}

// `hostname` est déjà en notation pointée classique à ce stade (voir le
// commentaire d'en-tête) : un simple split(".") suffit, pas besoin de
// gérer les formes décimale/octale/hexadécimale.
//
// Exportée parce que `dns.ts` pose la même question sur une autre entrée :
// un enregistrement A qui pointe vers `192.168.1.10` ne rend pas le site
// joignable, exactement comme une URL de webhook vers `192.168.1.10` ne
// mène nulle part de légitime. La liste des plages est UNE règle ; en
// écrire une seconde copie dans `dns.ts` la ferait diverger en silence à
// la première correction — ce dépôt a déjà payé ce motif.
//
// `refuseWebhookUrl` n'est pas le bon point d'entrée pour cet autre
// appelant : elle exige `https:` et refuserait un hôte nu.
export function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  return isPrivateOctets(octets as [number, number, number, number])
}

/**
 * Une IPv4-mappée en IPv6 (`::ffff:127.0.0.1`, ou sa forme hexadécimale
 * compressée `::ffff:7f00:1`) porte l'IPv4 dans ses 32 derniers bits.
 * `inner` est l'adresse sans les crochets.
 */
function isMappedIpv4Internal(inner: string): boolean {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(inner)
  if (dotted) return isPrivateIpv4(dotted[1] as string)

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(inner)
  if (hex) {
    const hi = Number.parseInt(hex[1] as string, 16)
    const lo = Number.parseInt(hex[2] as string, 16)
    return isPrivateOctets([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff])
  }

  return false
}

/** `null` si l'URL est acceptable, sinon la raison du refus. */
export function refuseWebhookUrl(value: string): WebhookUrlRefusal | null {
  if (value.length > MAX_WEBHOOK_URL_LENGTH) return "TOO_LONG"

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "NOT_A_URL"
  }

  // `https` seulement : en clair, le contenu d'un message de contact
  // voyagerait lisible par tout intermédiaire.
  if (url.protocol !== "https:") return "NOT_HTTPS"

  const host = url.hostname.toLowerCase()
  if (INTERNAL_HOSTNAMES.has(host)) return "INTERNAL_ADDRESS"
  if (isPrivateIpv4(host)) return "INTERNAL_ADDRESS"
  // Les adresses IPv6 arrivent entre crochets ; toute forme abrégée de la
  // boucle locale, une adresse unique-local, l'adresse non spécifiée « :: »
  // (que beaucoup de piles réseau traitent comme la boucle locale à la
  // connexion sortante), ou une IPv4 mappée en IPv6 est refusée.
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1)
    // `inner === "::1"` (égalité, pas sous-chaîne) : la boucle locale
    // IPv6 n'a qu'une forme compressée canonique. Un `.includes("::1")`
    // aurait aussi refusé `2001:db8::1` ou `2606:4700:4700::1111` (le
    // résolveur DNS public de Cloudflare) — des adresses publiques qui
    // se terminent par ces chiffres sans être la boucle locale.
    //
    // Relecture finale, correctif 3 : `fe80::/10` (lien-local IPv6, jamais
    // routable au-delà du segment local) est l'exact équivalent IPv6 de
    // `169.254.0.0/16` (lien-local IPv4, déjà refusé par `isPrivateOctets`
    // ci-dessus) — la parité manquait. `/^fe[89ab]/` couvre le premier
    // hextet de `fe80` à `febf`, précisément la plage `/10` : les 10 bits
    // de poids fort valent `1111111010`, et les 6 bits libres du même
    // hextet parcourent tout l'intervalle `80`-`bf` en hexadécimal. Même
    // heuristique par préfixe textuel que `fc`/`fd` juste au-dessus — une
    // barrière, pas un parseur d'adresse — et donc avec la même limite
    // assumée par l'en-tête de ce fichier : elle ne voit que le hextet
    // déjà écrit avec ses zéros de tête, pas sa valeur numérique.
    if (
      inner === "::" ||
      inner === "::1" ||
      inner.startsWith("fc") ||
      inner.startsWith("fd") ||
      /^fe[89ab]/.test(inner)
    ) {
      return "INTERNAL_ADDRESS"
    }
    if (isMappedIpv4Internal(inner)) return "INTERNAL_ADDRESS"
  }
  // `.local` et `.internal` ne résolvent que sur un réseau privé.
  if (host.endsWith(".local") || host.endsWith(".internal")) return "INTERNAL_ADDRESS"

  return null
}
