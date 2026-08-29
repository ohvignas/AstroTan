import { describe, expect, test } from "vitest"
import { CATALOGUE } from "./catalogueEmails"

describe("CATALOGUE", () => {
  test("décrit exactement les emails que ce dépôt envoie", () => {
    // Deux, et deux seulement. Better Auth n'envoie rien : ni
    // réinitialisation, ni vérification d'adresse, ni changement d'email —
    // aucun n'est monté dans `auth.ts`. Si l'un l'est un jour, ce test
    // échoue, et c'est le rappel qu'il faut l'ajouter ici aussi.
    expect(CATALOGUE.map((e) => e.cle)).toEqual(["invitation", "leadNotification"])
  })

  test("l'invitation n'est pas désactivable, et dit pourquoi", () => {
    const invitation = CATALOGUE.find((e) => e.cle === "invitation")!
    expect(invitation.desactivable).toBe(false)
    expect(invitation.raisonNonDesactivable).toBeTruthy()
  })

  test("le lien est une variable obligatoire de l'invitation", () => {
    // Un gabarit d'invitation sans lien est un email qui n'ouvre aucune
    // porte, sur le seul chemin de création de compte du dépôt.
    const invitation = CATALOGUE.find((e) => e.cle === "invitation")!
    expect(invitation.variablesObligatoires).toContain("lien")
  })

  test("chaque variable obligatoire est déclarée dans les variables", () => {
    for (const email of CATALOGUE) {
      for (const obligatoire of email.variablesObligatoires) {
        expect(email.variables, email.cle).toContain(obligatoire)
      }
    }
  })

  test("chaque texte par défaut n'emploie que des variables déclarées", () => {
    // Le défaut livré doit passer sa propre validation, sinon le premier
    // enregistrement d'un adoptant serait refusé sur un texte qu'il n'a
    // pas écrit.
    for (const email of CATALOGUE) {
      const employees = [...`${email.objetParDefaut} ${email.corpsParDefaut}`
        .matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
      for (const nom of employees) expect(email.variables, email.cle).toContain(nom)
    }
  })
})
