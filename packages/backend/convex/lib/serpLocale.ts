import { ConvexError } from "convex/values"

export const DEFAULT_SERP_LOCATION_CODE = 2250
export const DEFAULT_SERP_LANGUAGE_CODE = "fr"
export const MAX_SERP_LANGUAGE_CODE_LENGTH = 8

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
      input.serpLocationCode <= 0
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
