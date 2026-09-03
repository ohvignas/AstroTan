export type VisitorGeo = {
  ip?: string
  country?: string
  city?: string
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

export function geoFromTrustedIp(ip: string, headers: Headers): VisitorGeo {
  const trimmed = ip.trim()
  if (trimmed.length === 0) return {}
  const country = countryFromHeaders(headers)
  const city = cityFromHeaders(headers)
  return {
    ip: trimmed,
    ...(country ? { country } : {}),
    ...(city ? { city } : {}),
  }
}
