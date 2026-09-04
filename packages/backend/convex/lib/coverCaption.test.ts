import { expect, test } from "vitest"
import {
  MAX_COVER_ALT_LENGTH,
  MAX_COVER_TITLE_LENGTH,
  coverCaption,
  parseCoverCaptionDraft,
} from "./coverCaption"

test("l'alt est français, descriptif, ≤ 125, et porte le mot-clé une seule fois", () => {
  const { alt } = coverCaption({
    title: "Rénover une vitrine",
    excerpt: "Les trois gestes qui changent une rue.",
    targetKeyword: "vitrine commerçant",
  })
  expect(alt.length).toBeGreaterThan(0)
  expect(alt.length).toBeLessThanOrEqual(MAX_COVER_ALT_LENGTH)
  expect(alt.toLowerCase()).toContain("vitrine commerçant")
  expect(alt.toLowerCase().split("vitrine commerçant")).toHaveLength(2)
  expect(alt).not.toMatch(/vitrine commerçant.+\bvitrine commerçant\b/)
})

test("le title est court, utile, et n'est pas un nom de fichier", () => {
  const { title } = coverCaption({
    title: "Rénover une vitrine",
    targetKeyword: "vitrine commerçant",
  })
  expect(title.length).toBeGreaterThan(0)
  expect(title.length).toBeLessThanOrEqual(MAX_COVER_TITLE_LENGTH)
  expect(title).not.toMatch(/\.(png|jpe?g|webp)$/i)
  expect(title).not.toMatch(/^une-/)
  expect(title).not.toMatch(/^og-/)
})

test("sans mot-clé, l'alt reste descriptif à partir du titre", () => {
  const { alt, title } = coverCaption({ title: "Rénover une vitrine" })
  expect(alt).toContain("Rénover une vitrine")
  expect(title).toBe("Rénover une vitrine")
})

test("n'écrit pas « image de » et retire un SIRET inventé", () => {
  const parsed = parseCoverCaptionDraft({
    alt: "Image de l'atelier SIRET 123 456 789 00012 à Lyon",
    title: "Image de l'atelier",
  })
  expect(parsed).not.toBeNull()
  expect(parsed!.alt.toLowerCase()).not.toMatch(/image de/)
  expect(parsed!.alt).not.toMatch(/SIRET|\d{14}|123\s?456\s?789\s?00012/)
  expect(parsed!.title.toLowerCase()).not.toMatch(/image de/)
})

