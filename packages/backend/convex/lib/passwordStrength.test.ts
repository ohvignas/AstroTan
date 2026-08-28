import { describe, expect, test } from "vitest"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
  scorePassword,
} from "./passwordStrength"

// The gauge in `accept-invite.tsx` renders whatever this function returns,
// and `invitations.accept` refuses whatever scores below MIN_PASSWORD_SCORE.
// So these are not tests of a display detail — every case below is a
// password that either can or cannot create an account in this template.

describe("bornes de longueur", () => {
  test("un mot de passe plus court que le plancher est refusé, sans autre analyse", () => {
    const { score, issues } = scorePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))
    expect(score).toBe(0)
    expect(issues).toEqual(["TOO_SHORT"])
  })

  test("un mot de passe plus long que le plafond est refusé", () => {
    const { score, issues } = scorePassword("a".repeat(MAX_PASSWORD_LENGTH + 1))
    expect(score).toBe(0)
    expect(issues).toEqual(["TOO_LONG"])
  })

  test("exactement le plancher reste jouable — avec assez de variété", () => {
    // 8 characters is still the floor `auth.ts` declares; the score gate
    // tightens the *shape* of a short password, it does not move the floor.
    expect(scorePassword("Kx7#mQ2v").score).toBeGreaterThanOrEqual(
      MIN_PASSWORD_SCORE
    )
  })
})

describe("les mots de passe qui ont l'air complexes et ne le sont pas", () => {
  // This block is the reason the scorer exists. Every string here clears a
  // naive "8+ characters, three character classes" rule, and every one of
  // them sits near the top of a breach corpus.
  test.each([
    ["P@ssw0rd1", "password"],
    ["Azerty123!", "azerty"],
    ["admin1234", "admin"],
    ["Motdepasse2", "motdepasse"],
    ["L3tm31n!!", "letmein"],
    ["Qw3rty12", "qwerty"],
  ])("%s se replie sur « %s » et est plafonné", (password) => {
    const { score, issues } = scorePassword(password)
    expect(issues).toContain("COMMON")
    expect(score).toBeLessThan(MIN_PASSWORD_SCORE)
  })

  test("un caractère répété est plafonné quelle que soit sa longueur", () => {
    const { score, issues } = scorePassword("a".repeat(40))
    expect(issues).toContain("REPEATED")
    expect(score).toBeLessThan(MIN_PASSWORD_SCORE)
  })

  test.each(["12345678", "abcdefghij", "87654321", "azertyuiop", "qwertyui"])(
    "la suite %s est plafonnée",
    (password) => {
      const { score, issues } = scorePassword(password)
      expect(issues).toContain("SEQUENTIAL")
      expect(score).toBeLessThan(MIN_PASSWORD_SCORE)
    }
  )

  test("un mot de passe fabriqué à partir de l'email qu'il protège est plafonné", () => {
    const { score, issues } = scorePassword("Antoine2026!", {
      email: "antoine@illith.com",
    })
    expect(issues).toContain("DERIVED_FROM_EMAIL")
    expect(score).toBeLessThan(MIN_PASSWORD_SCORE)
  })

  test("sans email fourni, la même chaîne n'est plus rapprochée de rien", () => {
    // The check needs the address to mean anything: the form always passes
    // it (it has it from the invitation), but the function must not invent
    // a verdict when it doesn't.
    const { issues } = scorePassword("Antoine2026!")
    expect(issues).not.toContain("DERIVED_FROM_EMAIL")
  })

  test("une partie locale de moins de 3 caractères ne déclenche pas le rapprochement", () => {
    // Otherwise "al" inside "Kx7#alpaca9" would read as derived from `al@…`.
    const { issues } = scorePassword("Kx7#alpaca9", { email: "al@illith.com" })
    expect(issues).not.toContain("DERIVED_FROM_EMAIL")
  })
})

describe("les mots de passe réellement solides", () => {
  test("une phrase de passe tout en minuscules atteint le haut de l'échelle", () => {
    // The whole xkcd point: length beats ornamentation, so length alone has
    // to be able to carry the score or the gauge would push people toward
    // the weaker of the two options.
    expect(scorePassword("correct horse battery staple").score).toBe(4)
  })

  test("une chaîne courte mais très variée passe le plancher sans atteindre le sommet", () => {
    const { score } = scorePassword("Kx7#mQ2v")
    expect(score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE)
    expect(score).toBeLessThan(4)
  })

  test("la variété fait monter le score à longueur égale", () => {
    const plain = scorePassword("marmotteverte")
    const varied = scorePassword("Marmotte#V3rte")
    expect(varied.score).toBeGreaterThan(plain.score)
  })

  test("un mot de passe qui passe ne remonte aucun problème", () => {
    expect(scorePassword("Marmotte#V3rte").issues).toEqual([])
  })
})

describe("le contrat que consomment l'interface et la mutation", () => {
  test("TOO_SIMPLE n'est remonté que sous le plancher, jamais au-dessus", () => {
    // The form turns this issue into "choose something longer or more
    // varied"; showing it on a password that will be accepted would be a
    // lie, and hiding it on one that won't leaves the visitor stuck with a
    // disabled button and no explanation.
    const weak = scorePassword("marmotte")
    expect(weak.score).toBeLessThan(MIN_PASSWORD_SCORE)
    expect(weak.issues).toContain("TOO_SIMPLE")

    const strong = scorePassword("Marmotte#V3rte")
    expect(strong.score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE)
    expect(strong.issues).not.toContain("TOO_SIMPLE")
  })

  test("le score reste dans l'échelle annoncée pour n'importe quelle entrée", () => {
    const samples = [
      "",
      "a",
      "aaaaaaaa",
      "12345678",
      "P@ssw0rd1",
      "Kx7#mQ2v",
      "correct horse battery staple",
      "é".repeat(20),
      "🔐🔐🔐🔐🔐🔐🔐🔐",
      "x".repeat(MAX_PASSWORD_LENGTH),
    ]
    for (const sample of samples) {
      const { score } = scorePassword(sample, { email: "invitee@example.com" })
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(4)
    }
  })
})
