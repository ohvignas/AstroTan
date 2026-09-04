import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import {
  destinataireConversionAds,
  lireConversionDepuisBandeau,
  programmerSuiviLead,
  trackLeadConversion,
  LEAD_CONVERSION_STORAGE_KEY,
} from "./trackLeadConversion"

function memoire(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => {
      map.clear()
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe("destinataireConversionAds", () => {
  test("un AW- sans label n'est pas une conversion Ads", () => {
    expect(destinataireConversionAds({ googleTagId: "AW-999" })).toBeNull()
    expect(
      destinataireConversionAds({ googleTagId: "AW-999", googleConversionLabel: "" }),
    ).toBeNull()
  })

  test("un G- ou un GT- n'est pas une conversion Ads, même avec un label", () => {
    expect(
      destinataireConversionAds({ googleTagId: "G-ABC", googleConversionLabel: "AbC-xyz" }),
    ).toBeNull()
    expect(
      destinataireConversionAds({ googleTagId: "GT-XYZ", googleConversionLabel: "AbC-xyz" }),
    ).toBeNull()
  })

  test("AW- + label compose send_to", () => {
    expect(
      destinataireConversionAds({
        googleTagId: "AW-123456789",
        googleConversionLabel: "AbC-D_efG",
      }),
    ).toBe("AW-123456789/AbC-D_efG")
  })
})

describe("trackLeadConversion", () => {
  test("sans pixel chargé, rien ne part", () => {
    const store = memoire()
    expect(trackLeadConversion({}, { sessionStorage: store })).toBe(false)
    expect(store.getItem(LEAD_CONVERSION_STORAGE_KEY)).toBeNull()
  })

  test("Meta : Lead une seule fois", () => {
    const store = memoire()
    const calls: unknown[][] = []
    const fbq = (...args: unknown[]) => {
      calls.push(args)
    }
    expect(trackLeadConversion({}, { fbq, sessionStorage: store })).toBe(true)
    expect(trackLeadConversion({}, { fbq, sessionStorage: store })).toBe(false)
    expect(calls).toEqual([["track", "Lead"]])
  })

  test("Google : conversion seulement avec AW- et un label", () => {
    const store = memoire()
    const calls: unknown[][] = []
    const gtag = (...args: unknown[]) => {
      calls.push(args)
    }
    expect(
      trackLeadConversion(
        { googleTagId: "AW-999" },
        { gtag, sessionStorage: store },
      ),
    ).toBe(false)
    expect(
      trackLeadConversion(
        { googleTagId: "AW-999", googleConversionLabel: "AbC-xyz" },
        { gtag, sessionStorage: store },
      ),
    ).toBe(true)
    expect(calls).toEqual([["event", "conversion", { send_to: "AW-999/AbC-xyz" }]])
    expect(
      trackLeadConversion(
        { googleTagId: "AW-999", googleConversionLabel: "AbC-xyz" },
        { gtag, sessionStorage: store },
      ),
    ).toBe(false)
  })
})

describe("lireConversionDepuisBandeau", () => {
  test("lit les data-* du bandeau, ignore un attribut vide", () => {
    const banner = {
      dataset: { googleTagId: "AW-1", googleConversionLabel: "lbl" },
    }
    const root = {
      querySelector: (sel: string) => (sel === "[data-consent-banner]" ? banner : null),
    }
    expect(lireConversionDepuisBandeau(root as unknown as ParentNode)).toEqual({
      googleTagId: "AW-1",
      googleConversionLabel: "lbl",
    })
    banner.dataset.googleConversionLabel = ""
    expect(lireConversionDepuisBandeau(root as unknown as ParentNode).googleConversionLabel).toBeUndefined()
  })
})

describe("programmerSuiviLead", () => {
  test("réessaie quand les pixels viennent d'être posés", () => {
    const store = memoire()
    const calls: unknown[][] = []
    const listeners = new Map<string, EventListener>()
    const host = {
      sessionStorage: store,
      document: {
        addEventListener: (type: string, fn: EventListener) => {
          listeners.set(type, fn)
        },
      },
      fbq: (...args: unknown[]) => {
        calls.push(args)
      },
    }
    delete (host as { fbq?: unknown }).fbq
    programmerSuiviLead({}, host)
    expect(calls).toEqual([])
    host.fbq = (...args: unknown[]) => {
      calls.push(args)
    }
    listeners.get("astrotan:pixels-ready")?.(new Event("astrotan:pixels-ready"))
    expect(calls).toEqual([["track", "Lead"]])
  })
})

test("le formulaire contact et le chat câblent le suivi après un vrai succès", () => {
  const contact = readFileSync(new URL("../pages/contact.astro", import.meta.url), "utf8")
  const card = readFileSync(new URL("../components/chat/ChatEmailCard.tsx", import.meta.url), "utf8")
  expect(contact).toContain("programmerSuiviLead")
  expect(contact).toContain("envoye")
  expect(card).toContain("programmerSuiviLead")
  expect(card).toContain("result.ok")
})
