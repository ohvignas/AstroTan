export function isLocalIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase()
  if (trimmed === "::1" || trimmed === "localhost" || trimmed === "::ffff:127.0.0.1") {
    return true
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)
}

/** Drapeau emoji depuis un code ISO-3166 alpha-2. XX / vide → rien. */
export function countryFlag(country?: string): string | null {
  const code = country?.trim().toUpperCase() ?? ""
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null
  const A = 0x1f1e6
  return String.fromCodePoint(A + (code.charCodeAt(0) - 65), A + (code.charCodeAt(1) - 65))
}

export function leadHeadline(lead: {
  name: string
  email?: string
  ip?: string
}): string {
  const email = lead.email?.trim() ?? ""
  if (email.length > 0) return lead.name
  const ip = lead.ip?.trim() ?? ""
  if (ip.length > 0) return `Visiteur · ${ip}`
  return lead.name || "Visiteur"
}

export function formatLeadLocation(lead: {
  city?: string
  country?: string
  ip?: string
}): string | null {
  const city = lead.city?.trim() ?? ""
  const country = lead.country?.trim().toUpperCase() ?? ""
  const ip = lead.ip?.trim() ?? ""
  const flag = countryFlag(country)
  const place = [city, country].filter((part) => part.length > 0).join(", ")
  const rest = [place, ip].filter((part) => part.length > 0).join(" · ")
  if (flag && rest.length > 0) return `${flag} ${rest}`
  if (flag) return flag
  if (rest.length > 0) return rest
  return null
}
