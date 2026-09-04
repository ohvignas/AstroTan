export type VisitorGeo = {
  ip?: string
  country?: string
  city?: string
  latitude?: number
  longitude?: number
  timezone?: string
}

function headerValue(headers: Headers, name: string): string {
  const raw = headers.get(name)?.trim() ?? ""
  if (raw.length === 0) return ""
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "))
  } catch {
    return raw
  }
}

function countryFromHeaders(headers: Headers): string | undefined {
  const raw =
    headerValue(headers, "cf-ipcountry") ||
    headerValue(headers, "x-vercel-ip-country") ||
    headerValue(headers, "cloudfront-viewer-country")
  const country = raw.toUpperCase()
  if (country === "XX" || country === "T1") return undefined
  return /^[A-Z]{2}$/.test(country) ? country : undefined
}

function cityFromHeaders(headers: Headers): string | undefined {
  const city =
    headerValue(headers, "cf-ipcity") || headerValue(headers, "x-vercel-ip-city")
  return city.length > 0 ? city : undefined
}

function boundedCoord(raw: string, min: number, max: number): number | undefined {
  if (raw.length === 0) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) return undefined
  return value
}

function latitudeFromHeaders(headers: Headers): number | undefined {
  return boundedCoord(
    headerValue(headers, "cf-iplatitude") || headerValue(headers, "x-vercel-ip-latitude"),
    -90,
    90,
  )
}

function longitudeFromHeaders(headers: Headers): number | undefined {
  return boundedCoord(
    headerValue(headers, "cf-iplongitude") || headerValue(headers, "x-vercel-ip-longitude"),
    -180,
    180,
  )
}

function timezoneFromHeaders(headers: Headers): string | undefined {
  const zone =
    headerValue(headers, "cf-timezone") || headerValue(headers, "x-vercel-ip-timezone")
  if (zone.length === 0) return undefined
  try {
    Intl.DateTimeFormat("fr-FR", { timeZone: zone }).format(new Date())
    return zone
  } catch {
    return undefined
  }
}

export function geoFromTrustedIp(ip: string, headers: Headers): VisitorGeo {
  const trimmed = ip.trim()
  if (trimmed.length === 0) return {}
  const country = countryFromHeaders(headers)
  const city = cityFromHeaders(headers)
  const latitude = latitudeFromHeaders(headers)
  const longitude = longitudeFromHeaders(headers)
  const timezone = timezoneFromHeaders(headers)
  return {
    ip: trimmed,
    ...(country ? { country } : {}),
    ...(city ? { city } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(timezone ? { timezone } : {}),
  }
}
