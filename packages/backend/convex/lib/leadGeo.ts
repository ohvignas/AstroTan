import { ConvexError, v } from "convex/values"
import {
  MAX_LEAD_CITY_LENGTH,
  MAX_LEAD_COUNTRY_LENGTH,
  MAX_LEAD_IP_LENGTH,
  MAX_LEAD_PAGE_URL_LENGTH,
  MAX_LEAD_TIMEZONE_LENGTH,
} from "../content"

export const leadGeoArgs = {
  ip: v.optional(v.string()),
  country: v.optional(v.string()),
  city: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  timezone: v.optional(v.string()),
  pageUrl: v.optional(v.string()),
}

export type LeadGeo = {
  ip?: string
  country?: string
  city?: string
  latitude?: number
  longitude?: number
  timezone?: string
  pageUrl?: string
}

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export function normalizeLeadGeo(raw: LeadGeo): LeadGeo {
  const ip = raw.ip?.trim() ?? ""
  if (ip.length > 0) assertBounded(ip, MAX_LEAD_IP_LENGTH, "ip")

  const countryRaw = raw.country?.trim().toUpperCase() ?? ""
  // XX / T1 : codes Cloudflare « inconnu / Tor », pas un pays ISO.
  const country =
    countryRaw.length === MAX_LEAD_COUNTRY_LENGTH &&
    /^[A-Z]{2}$/.test(countryRaw) &&
    countryRaw !== "XX" &&
    countryRaw !== "T1"
      ? countryRaw
      : ""

  const city = raw.city?.trim() ?? ""
  if (city.length > 0) assertBounded(city, MAX_LEAD_CITY_LENGTH, "city")

  const latitude =
    typeof raw.latitude === "number" && Number.isFinite(raw.latitude) && raw.latitude >= -90 && raw.latitude <= 90
      ? raw.latitude
      : undefined
  const longitude =
    typeof raw.longitude === "number" &&
    Number.isFinite(raw.longitude) &&
    raw.longitude >= -180 &&
    raw.longitude <= 180
      ? raw.longitude
      : undefined

  const timezoneRaw = raw.timezone?.trim() ?? ""
  let timezone = ""
  if (timezoneRaw.length > 0) {
    assertBounded(timezoneRaw, MAX_LEAD_TIMEZONE_LENGTH, "timezone")
    try {
      Intl.DateTimeFormat("fr-FR", { timeZone: timezoneRaw }).format(new Date())
      timezone = timezoneRaw
    } catch {
      timezone = ""
    }
  }

  const pageUrl = normalizeLeadPageUrl(raw.pageUrl)

  return {
    ...(ip.length > 0 ? { ip } : {}),
    ...(country.length > 0 ? { country } : {}),
    ...(city.length > 0 ? { city } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(timezone.length > 0 ? { timezone } : {}),
    ...(pageUrl ? { pageUrl } : {}),
  }
}

export function normalizeLeadPageUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0) return undefined
  assertBounded(trimmed, MAX_LEAD_PAGE_URL_LENGTH, "pageUrl")
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed.split(/[?#]/)[0] || undefined
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
}

export function leadGeoPatch(raw: LeadGeo): LeadGeo {
  return normalizeLeadGeo(raw)
}
