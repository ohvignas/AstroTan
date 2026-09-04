import { ConvexError } from "convex/values"

export const DEFAULT_SERP_LOCATION_CODE = 2250
export const DEFAULT_SERP_LANGUAGE_CODE = "fr"
export const MAX_SERP_LANGUAGE_CODE_LENGTH = 8

// Codes officiels DataForSEO SERP Google (CSV appendix 2026-08-06).
// https://cdn.dataforseo.com/v3/locations/locations_serp_google_2026_08_06.csv
export const SERP_LIEUX = [
  { locationCode: 2250, languageCode: "fr", label: "France (Google)", kind: "country" },
  { locationCode: 2056, languageCode: "fr", label: "Belgique (Google)", kind: "country" },
  { locationCode: 2756, languageCode: "fr", label: "Suisse (Google)", kind: "country" },
  { locationCode: 2442, languageCode: "fr", label: "Luxembourg (Google)", kind: "country" },
  { locationCode: 2124, languageCode: "fr", label: "Canada (Google)", kind: "country" },
  { locationCode: 1006094, languageCode: "fr", label: "Paris (Google)", kind: "city" },
  { locationCode: 1006410, languageCode: "fr", label: "Lyon (Google)", kind: "city" },
  { locationCode: 1006356, languageCode: "fr", label: "Marseille (Google)", kind: "city" },
  { locationCode: 1006219, languageCode: "fr", label: "Toulouse (Google)", kind: "city" },
  { locationCode: 1005811, languageCode: "fr", label: "Bordeaux (Google)", kind: "city" },
  { locationCode: 1006235, languageCode: "fr", label: "Lille (Google)", kind: "city" },
  { locationCode: 1006285, languageCode: "fr", label: "Nantes (Google)", kind: "city" },
  { locationCode: 1006359, languageCode: "fr", label: "Nice (Google)", kind: "city" },
] as const

const ALLOWED_SERP_LOCATION_CODES = new Set<number>(
  SERP_LIEUX.map((lieu) => lieu.locationCode),
)

export function isAllowedSerpLocationCode(code: number): boolean {
  return ALLOWED_SERP_LOCATION_CODES.has(code)
}

export function assertSerpLocale(input: {
  serpLocationCode?: number | null
  serpLanguageCode?: string | null
}): { serpLocationCode?: number; serpLanguageCode?: string } {
  const out: { serpLocationCode?: number; serpLanguageCode?: string } = {}

  if (input.serpLocationCode !== undefined) {
    if (input.serpLocationCode === null) {
      out.serpLocationCode = undefined
    } else if (
      !Number.isInteger(input.serpLocationCode) ||
      input.serpLocationCode <= 0 ||
      !isAllowedSerpLocationCode(input.serpLocationCode)
    ) {
      throw new ConvexError({ code: "INVALID_SERP_LOCALE" })
    } else {
      out.serpLocationCode = input.serpLocationCode
    }
  }

  if (input.serpLanguageCode !== undefined) {
    if (input.serpLanguageCode === null) {
      out.serpLanguageCode = undefined
    } else {
      const code = input.serpLanguageCode.trim()
      if (code.length === 0) {
        out.serpLanguageCode = undefined
      } else if (!/^[a-z]{2}$/.test(code)) {
        throw new ConvexError({ code: "INVALID_SERP_LOCALE" })
      } else {
        out.serpLanguageCode = code
      }
    }
  }

  return out
}

export function resolveSerpLocale(settings: {
  serpLocationCode?: number
  serpLanguageCode?: string
}): { locationCode: number; languageCode: string } {
  return {
    locationCode: settings.serpLocationCode ?? DEFAULT_SERP_LOCATION_CODE,
    languageCode: settings.serpLanguageCode ?? DEFAULT_SERP_LANGUAGE_CODE,
  }
}
