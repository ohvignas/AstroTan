import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { trackUmamiEvent, umamiEventForHref } from "./umamiEvent"

describe("umamiEventForHref", () => {
  test("mappe les CTA utiles, ignore le reste", () => {
    expect(umamiEventForHref("/contact")).toBe("cta-contact")
    expect(umamiEventForHref("/tarifs?offre=complet")).toBe("cta-tarifs")
    expect(umamiEventForHref("/acheter")).toBe("checkout-start")
    expect(umamiEventForHref("https://github.com/OhVignas/AstroTan")).toBe("cta-clone")
    expect(umamiEventForHref("/fonctionnalites")).toBeUndefined()
    expect(umamiEventForHref(undefined)).toBeUndefined()
  })
})

describe("trackUmamiEvent", () => {
  test("appelle umami.track s'il est déjà chargé, sinon ne fait rien", () => {
    const calls: unknown[][] = []
    trackUmamiEvent("contact-submit", { source: "form" }, {
      umami: { track: (...args: unknown[]) => calls.push(args) },
    })
    expect(calls).toEqual([["contact-submit", { source: "form" }]])
    expect(() => trackUmamiEvent("contact-submit", undefined, {})).not.toThrow()
  })
})

test("les CTA et le contact portent des events Umami consent-safe", () => {
  const cta = readFileSync(new URL("../components/CTA.astro", import.meta.url), "utf8")
  const pricing = readFileSync(
    new URL("../components/sections/Pricing.astro", import.meta.url),
    "utf8",
  )
  const contact = readFileSync(new URL("../pages/contact.astro", import.meta.url), "utf8")
  expect(cta).toContain("umamiEventForHref")
  expect(pricing).toContain("umamiEventForHref")
  expect(contact).toContain("trackUmamiEvent")
  expect(contact).toContain("contact-submit")
})
