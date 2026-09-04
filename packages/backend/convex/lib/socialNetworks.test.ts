import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  SOCIAL_NETWORKS,
  availableNetworks,
  assertSocials,
  hydrateSocials,
  isSocialHttpUrl,
  resolveSocialNetwork,
} from "./socialNetworks"

const IDS = SOCIAL_NETWORKS.map((network) => network.id)

test("le catalogue porte les réseaux courants, sans doublon", () => {
  expect(IDS).toEqual([
    "instagram",
    "facebook",
    "linkedin",
    "x",
    "youtube",
    "tiktok",
    "whatsapp",
    "telegram",
    "pinterest",
    "github",
    "threads",
    "bluesky",
    "discord",
    "mastodon",
  ])
  expect(new Set(IDS).size).toBe(IDS.length)
})

test("resolveSocialNetwork accepte l'id, le libellé et les alias", () => {
  expect(resolveSocialNetwork("instagram")).toBe("instagram")
  expect(resolveSocialNetwork(" Instagram ")).toBe("instagram")
  expect(resolveSocialNetwork("X")).toBe("x")
  expect(resolveSocialNetwork("Twitter")).toBe("x")
  expect(resolveSocialNetwork("LinkedIn")).toBe("linkedin")
  expect(resolveSocialNetwork("inconnu")).toBeNull()
})

test("isSocialHttpUrl n'accepte que http(s) absolu", () => {
  expect(isSocialHttpUrl("https://instagram.com/exemple")).toBe(true)
  expect(isSocialHttpUrl("http://exemple.test/x")).toBe(true)
  expect(isSocialHttpUrl("  https://x.com/exemple  ")).toBe(true)
  expect(isSocialHttpUrl("javascript:alert(1)")).toBe(false)
  expect(isSocialHttpUrl("mailto:contact@exemple.fr")).toBe(false)
  expect(isSocialHttpUrl("/instagram")).toBe(false)
  expect(isSocialHttpUrl("//evil.example")).toBe(false)
  expect(isSocialHttpUrl("")).toBe(false)
})

test("availableNetworks écarte les ids déjà pris", () => {
  const rest = availableNetworks(["instagram", "x"])
  expect(rest.map((network) => network.id)).not.toContain("instagram")
  expect(rest.map((network) => network.id)).not.toContain("x")
  expect(rest.some((network) => network.id === "linkedin")).toBe(true)
})

test("hydrateSocials normalise le libellé et ignore l'inconnu et le doublon", () => {
  expect(
    hydrateSocials([
      { label: "Instagram", url: "https://instagram.com/a" },
      { label: "instagram", url: "https://instagram.com/b" },
      { label: "Forum", url: "https://forum.exemple" },
    ]),
  ).toEqual([{ id: "instagram", url: "https://instagram.com/a" }])
})

test("assertSocials normalise l'id et refuse réseau inconnu, doublon, URL non http(s)", () => {
  expect(
    assertSocials([{ label: "Instagram", url: " https://instagram.com/a " }]),
  ).toEqual([{ label: "instagram", url: "https://instagram.com/a" }])

  expect(() =>
    assertSocials([{ label: "Forum", url: "https://forum.exemple" }]),
  ).toThrow(ConvexError)

  expect(() =>
    assertSocials([
      { label: "instagram", url: "https://instagram.com/a" },
      { label: "Instagram", url: "https://instagram.com/b" },
    ]),
  ).toThrow(ConvexError)

  expect(() =>
    assertSocials([{ label: "instagram", url: "javascript:alert(1)" }]),
  ).toThrow(ConvexError)
})
