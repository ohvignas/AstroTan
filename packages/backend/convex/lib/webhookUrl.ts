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
// Une autre limite, plus étroite, est fermée ici plutôt que documentée :
// une IPv4 écrite en notation non pointée (décimale pure, octale ou
// hexadécimale — `2130706433`, `0177.0.0.1`, `0x7f000001`, tous 127.0.0.1)
// est acceptée par `new URL()` au même titre qu'une IPv4 pointée classique.
// Un contrôle qui se contente de `split(".")` sur le hostname la laisse
// passer telle quelle. On ne peut pas non plus compter sur le hostname
// d'être déjà canonicalisé en notation pointée avant d'arriver ici : cela
// dépend de l'implémentation d'URL du runtime, et rien ne garantit qu'elle
// se comporte comme celle de Node. `isPrivateIpv4` reparse donc elle-même
// ces formes plutôt que de supposer qu'elles ont déjà été normalisées.

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

/**
 * Interprète un hostname qui code une IPv4 sous une forme quelconque —
 * pointée classique (`127.0.0.1`), compressée (`127.1`), décimale pure
 * (`2130706433`), octale (`0177.0.0.1`) ou hexadécimale (`0x7f000001`),
 * y compris mélangée entre segments. Reproduit (en simplifié) l'algorithme
 * de parsing IPv4 de la spec WHATWG URL. `null` si `hostname` n'a pas cette
 * forme — auquel cas ce n'est très probablement pas une adresse IP.
 */
function parseNumericIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".")
  if (parts.length === 0 || parts.length > 4) return null

  const numbers: number[] = []
  for (const part of parts) {
    if (part === "") return null
    let n: number
    if (/^0x[0-9a-f]+$/i.test(part)) {
      n = Number.parseInt(part.slice(2), 16)
    } else if (/^0[0-7]+$/.test(part)) {
      n = Number.parseInt(part, 8)
    } else if (/^(0|[1-9][0-9]*)$/.test(part)) {
      n = Number.parseInt(part, 10)
    } else {
      return null
    }
    if (!Number.isSafeInteger(n) || n < 0) return null
    numbers.push(n)
  }

  // Seul le dernier segment peut porter plusieurs octets (notation
  // compressée) ; les précédents doivent chacun tenir sur un octet.
  for (let i = 0; i < numbers.length - 1; i++) {
    if ((numbers[i] as number) > 255) return null
  }
  const last = numbers[numbers.length - 1] as number
  const maxLast = 256 ** (5 - numbers.length) - 1
  if (last > maxLast) return null

  const octets = numbers.slice(0, -1)
  for (let i = numbers.length - 1; i < 4; i++) {
    octets.push(Math.floor(last / 256 ** (3 - i)) % 256)
  }
  return octets as [number, number, number, number]
}

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

function isPrivateIpv4(hostname: string): boolean {
  const octets = parseNumericIpv4(hostname)
  if (!octets) return false
  return isPrivateOctets(octets)
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
    if (inner === "::" || inner.includes("::1") || inner.startsWith("fc") || inner.startsWith("fd")) {
      return "INTERNAL_ADDRESS"
    }
    if (isMappedIpv4Internal(inner)) return "INTERNAL_ADDRESS"
  }
  // `.local` et `.internal` ne résolvent que sur un réseau privé.
  if (host.endsWith(".local") || host.endsWith(".internal")) return "INTERNAL_ADDRESS"

  return null
}
