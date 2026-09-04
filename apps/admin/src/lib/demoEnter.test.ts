import { expect, test } from "vitest"
import { entrerDemo, secretPresent } from "./demoEnter"

test("un secret absent ou vide n'est pas présent", () => {
  expect(secretPresent({})).toBe(false)
  expect(secretPresent({ DEMO_ENTER_SECRET: "" })).toBe(false)
  expect(secretPresent({ DEMO_ENTER_SECRET: undefined })).toBe(false)
})

test("un secret non vide est présent", () => {
  expect(secretPresent({ DEMO_ENTER_SECRET: "x" })).toBe(true)
})

test("sans secret admin, 404 — Convex ne doit pas être appelé", () => {
  expect(
    entrerDemo({
      ouvert: { actif: true, adminUrl: "https://admin.exemple.fr" },
      secretEnv: false,
    }),
  ).toBe("404")
})

test("ouvert null ou inactif → 404 (ouvert est un objet, pas un booléen)", () => {
  expect(entrerDemo({ ouvert: null, secretEnv: true })).toBe("404")
  expect(entrerDemo({ ouvert: { actif: false, adminUrl: null }, secretEnv: true })).toBe(
    "404",
  )
})

test("rate-limité → 429", () => {
  expect(
    entrerDemo({
      ouvert: { actif: true, adminUrl: "https://admin.exemple.fr" },
      secretEnv: true,
      rateLimited: true,
    }),
  ).toBe("429")
})

test("secret présent et bac à sable ouvert → ok", () => {
  expect(
    entrerDemo({
      ouvert: { actif: true, adminUrl: "https://admin.exemple.fr" },
      secretEnv: true,
    }),
  ).toBe("ok")
})
