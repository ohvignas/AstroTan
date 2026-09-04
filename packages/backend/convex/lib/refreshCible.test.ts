import { describe, expect, test } from "vitest"
import {
  cibleApex,
  doitEssayerJumeau,
  hoteJumeauWww,
  snapshotStatsVide,
} from "./refreshCible"

describe("cibleApex", () => {
  test("retire www, schéma et slash — n'importe quel domaine", () => {
    expect(cibleApex("www.agence-dupont.fr")).toBe("agence-dupont.fr")
    expect(cibleApex("https://Agence-Dupont.fr/")).toBe("agence-dupont.fr")
    expect(cibleApex("exemple.fr")).toBe("exemple.fr")
  })

  test("ne hardcode aucun domaine", () => {
    expect(cibleApex("autre-site.be")).toBe("autre-site.be")
    expect(cibleApex("www.autre-site.be")).not.toBe("www.autre-site.be")
  })
})

describe("hoteJumeauWww", () => {
  test("le jumeau de l'apex est www, jamais l'inverse d'abord", () => {
    expect(hoteJumeauWww(cibleApex("www.exemple.fr"))).toBe("www.exemple.fr")
    expect(hoteJumeauWww(cibleApex("exemple.fr"))).toBe("www.exemple.fr")
  })
})

describe("doitEssayerJumeau", () => {
  test("vrai zéro (succès + vide) : on essaie www", () => {
    expect(
      doitEssayerJumeau({
        labsOk: true,
        rows: [],
        counts: { backlinks: 0, referringDomains: 0 },
      }),
    ).toBe(true)
  })

  test("erreur API (401/402/40400) : pas un zéro, on n'essaie pas www", () => {
    expect(
      doitEssayerJumeau({ labsOk: false, rows: [], counts: null }),
    ).toBe(false)
    expect(snapshotStatsVide([], null)).toBe(true)
  })

  test("un mot-clé ou un backlink : on garde l'apex", () => {
    expect(
      doitEssayerJumeau({
        labsOk: true,
        rows: [{ keyword: "x" }],
        counts: { backlinks: 0, referringDomains: 0 },
      }),
    ).toBe(false)
  })
})
