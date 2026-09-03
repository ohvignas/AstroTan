import { ConvexError, v } from "convex/values"
import {
  MAX_LEAD_CITY_LENGTH,
  MAX_LEAD_COUNTRY_LENGTH,
  MAX_LEAD_IP_LENGTH,
} from "../content"

export const leadGeoArgs = {
  ip: v.optional(v.string()),
  country: v.optional(v.string()),
  city: v.optional(v.string()),
}

export type LeadGeo = {
  ip?: string
  country?: string
  city?: string
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

  return {
    ...(ip.length > 0 ? { ip } : {}),
    ...(country.length > 0 ? { country } : {}),
    ...(city.length > 0 ? { city } : {}),
  }
}

export function leadGeoPatch(raw: LeadGeo): LeadGeo {
  return normalizeLeadGeo(raw)
}
