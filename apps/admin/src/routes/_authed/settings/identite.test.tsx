import { describe, expect, test } from "vitest"
import source from "./identite.tsx?raw"

describe("Identité — images du site", () => {
  test("ne propose pas Retirer : logo et icône se remplacent, ne s'effacent pas", () => {
    expect(source).not.toMatch(/\bRetirer\b/)
    expect(source).toMatch(/Changer d/)
    expect(source).toMatch(/Choisir un/)
    expect(source).not.toMatch(/onClear/)
  })

  test("place le logo et l'icône côte à côte, sauf sur mobile", () => {
    expect(source).toMatch(/sm:grid-cols-2/)
    const logoAt = source.indexOf("<FieldLabel>Logo</FieldLabel>")
    const iconAt = source.indexOf("<FieldLabel>Icône</FieldLabel>")
    const gridAt = source.indexOf("sm:grid-cols-2")
    expect(logoAt).toBeGreaterThan(-1)
    expect(iconAt).toBeGreaterThan(logoAt)
    expect(gridAt).toBeGreaterThan(-1)
    expect(gridAt).toBeLessThan(logoAt)
  })

  test("ne montre plus l'aide « aperçu template » de l'icône", () => {
    expect(source).not.toContain(
      "Choisissez une icône dans la médiathèque pour l'assigner"
    )
    expect(source).not.toContain(
      "tant qu'elle n'est pas choisie ici, /media peut encore supprimer ce fichier"
    )
  })

  test("aligne l'icône sur la ligne média du template et l'assigne si iconId est vide", () => {
    expect(source).toContain("resolveIdentityMedia")
    expect(source).toContain("templateIdentityToAssign")
    expect(source).toContain("TEMPLATE_ICON_FILENAME")
    // Sans ça, `value === null` sautait `media.list` et l'écran ne voyait
    // jamais `icon_astrotan.png` déjà en médiathèque.
    expect(source).not.toMatch(/media\.list,\s*value === null \? "skip"/)
  })

  test("porte la section Réseaux sociaux", () => {
    expect(source).toContain("SocialsField")
    expect(source).toContain("Réseaux sociaux")
  })
})
