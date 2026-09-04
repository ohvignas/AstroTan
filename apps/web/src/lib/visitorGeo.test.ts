import { describe, expect, test } from "vitest"
import { geoFromTrustedIp } from "./visitorGeo"

describe("geoFromTrustedIp", () => {
  test("recopie l'IP de confiance et le pays Cloudflare", () => {
    const headers = new Headers({
      "cf-ipcountry": "fr",
      "cf-ipcity": "Lyon",
    })
    expect(geoFromTrustedIp("203.0.113.42", headers)).toEqual({
      ip: "203.0.113.42",
      country: "FR",
      city: "Lyon",
    })
  })

  test("honore x-vercel-ip-* si Cloudflare est absent", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "DE",
      "x-vercel-ip-city": "Berlin",
    })
    expect(geoFromTrustedIp("198.51.100.9", headers)).toEqual({
      ip: "198.51.100.9",
      country: "DE",
      city: "Berlin",
    })
  })

  test("sans en-tête géographique, garde seulement l'IP", () => {
    expect(geoFromTrustedIp("203.0.113.42", new Headers())).toEqual({
      ip: "203.0.113.42",
    })
  })

  test("une IP vide ne produit rien", () => {
    expect(geoFromTrustedIp("", new Headers({ "cf-ipcountry": "FR" }))).toEqual({})
  })

  test("127.0.0.1 se conserve, sans pays si les en-têtes n'en donnent pas", () => {
    expect(geoFromTrustedIp("127.0.0.1", new Headers())).toEqual({ ip: "127.0.0.1" })
  })

  test("cf-ipcountry XX (inconnu) n'invente pas de pays", () => {
    expect(geoFromTrustedIp("127.0.0.1", new Headers({ "cf-ipcountry": "XX" }))).toEqual({
      ip: "127.0.0.1",
    })
  })

  test("recopie lat/lng et fuseau Cloudflare s'ils sont déjà là", () => {
    const headers = new Headers({
      "cf-ipcountry": "FR",
      "cf-ipcity": "Lyon",
      "cf-iplatitude": "45.75",
      "cf-iplongitude": "4.85",
      "cf-timezone": "Europe/Paris",
    })
    expect(geoFromTrustedIp("203.0.113.42", headers)).toEqual({
      ip: "203.0.113.42",
      country: "FR",
      city: "Lyon",
      latitude: 45.75,
      longitude: 4.85,
      timezone: "Europe/Paris",
    })
  })

  test("un fuseau ou une coordonnée invalide est ignoré", () => {
    const headers = new Headers({
      "x-vercel-ip-latitude": "200",
      "x-vercel-ip-timezone": "Mars/Olympus",
    })
    expect(geoFromTrustedIp("203.0.113.42", headers)).toEqual({
      ip: "203.0.113.42",
    })
  })
})
