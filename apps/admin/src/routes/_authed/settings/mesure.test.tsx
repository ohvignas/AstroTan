import { describe, expect, test } from "vitest"
import source from "./mesure.tsx?raw"

// SEO & Pixel passait par `SettingsPageShell` — l'en-tête seul, sans
// barre. Sans `SaveBar`, `AppShell` n'étire pas la colonne, le filet du
// menu s'arrête à mi-hauteur, et l'écran ne ressemble plus aux autres
// réglages. Le chrome est celui de `SettingsFormShell`, comme Identité.

describe("settings/mesure — chrome des réglages", () => {
  test("porte la barre d'enregistrement, pas seulement l'en-tête", () => {
    expect(source).toContain("SettingsFormShell")
    expect(source).toContain("useAutoSave")
    expect(source).not.toContain("SettingsPageShell")
  })

  test("n'arme pas la sauvegarde automatique : DataForSEO et les pixels s'enregistrent à part", () => {
    // Même convention qu'`/settings/emails` : `auto: {}` pour que
    // `snapshotChanged` reste faux. La barre affiche « Aucun
    // enregistrement depuis l'ouverture de cet écran » ; le bouton
    // DataForSEO (essai + Connecté) n'est pas dupliqué.
    expect(source).toMatch(/auto:\s*\{\s*\}/)
  })

  test("garde le corps existant : DataForSEO, pixels et lieu SERP", () => {
    expect(source).toContain("SeoPixelPage")
    expect(source).toContain("onSaveDataForSeo")
    expect(source).toContain("onSavePixel")
    expect(source).toContain("onSaveSerp")
  })
})
