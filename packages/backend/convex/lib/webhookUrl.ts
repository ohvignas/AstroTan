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
// privée, et seule une résolution DNS au moment de l'appel l'attraperait.
// C'est une barrière, pas une garantie — et le dire ici évite qu'on la
// prenne pour ce qu'elle n'est pas.

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

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // boucle locale
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // lien-local, dont les métadonnées
  )
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
  // boucle locale ou d'une adresse unique-local est refusée.
  if (host.startsWith("[") && (host.includes("::1") || host.startsWith("[fc") || host.startsWith("[fd"))) {
    return "INTERNAL_ADDRESS"
  }
  // `.local` et `.internal` ne résolvent que sur un réseau privé.
  if (host.endsWith(".local") || host.endsWith(".internal")) return "INTERNAL_ADDRESS"

  return null
}
