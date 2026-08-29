import { describe, expect, test } from "vitest"
import { EXPEDITEUR_BAC_A_SABLE, choisirExpediteur, estAdresseValide } from "./expediteur"

describe("choisirExpediteur", () => {
  test("sans réglage, retombe sur le bac à sable de Resend", () => {
    // Et surtout pas sur une adresse inventée : le bac à sable ne délivre
    // qu'aux adresses de test de Resend, ce qui est un échec VISIBLE. Une
    // adresse plausible sur un domaine non vérifié échoue en silence.
    expect(choisirExpediteur(undefined)).toBe(EXPEDITEUR_BAC_A_SABLE)
    expect(choisirExpediteur("")).toBe(EXPEDITEUR_BAC_A_SABLE)
    expect(choisirExpediteur("   ")).toBe(EXPEDITEUR_BAC_A_SABLE)
  })

  test("une adresse réglée est utilisée telle quelle", () => {
    expect(choisirExpediteur("AstroTan <bonjour@exemple.fr>")).toBe(
      "AstroTan <bonjour@exemple.fr>"
    )
  })

  test("une valeur qui n'est pas une adresse retombe sur le bac à sable", () => {
    // Un `from` malformé fait échouer l'envoi côté Resend, sans que
    // personne ne sache pourquoi. Mieux vaut le repli visible.
    expect(choisirExpediteur("pas une adresse")).toBe(EXPEDITEUR_BAC_A_SABLE)
  })
})

describe("estAdresseValide", () => {
  test("accepte les deux formes que Resend accepte", () => {
    expect(estAdresseValide("bonjour@exemple.fr")).toBe(true)
    expect(estAdresseValide("AstroTan <bonjour@exemple.fr>")).toBe(true)
  })

  test("refuse ce qui n'a ni arobase ni domaine", () => {
    expect(estAdresseValide("bonjour")).toBe(false)
    expect(estAdresseValide("bonjour@")).toBe(false)
    expect(estAdresseValide("@exemple.fr")).toBe(false)
  })
})
