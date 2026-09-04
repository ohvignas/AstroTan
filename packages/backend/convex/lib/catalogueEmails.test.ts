import { describe, expect, test } from "vitest"
import { CATALOGUE, VARIABLES_DE_CONFIANCE } from "./catalogueEmails"

describe("CATALOGUE", () => {
  test("décrit exactement les emails que ce dépôt envoie", () => {
    // Trois, et trois seulement. Better Auth n'en envoie aucun lui-même : ni
    // vérification d'adresse, ni changement d'email — rien de tout ça n'est
    // monté dans `auth.ts`. Si un quatrième l'est un jour, ce test échoue,
    // et c'est le rappel qu'il faut l'ajouter ici aussi.
    expect(CATALOGUE.map((e) => e.cle)).toEqual([
      "invitation",
      "leadNotification",
      "passwordReset",
      "postPublished",
      "purchaseConfirmation",
    ])
  })

  test("leadNotification accepte encore lien et sujet, et gagne url", () => {
    const lead = CATALOGUE.find((e) => e.cle === "leadNotification")!
    expect(lead.variables).toEqual(
      expect.arrayContaining(["nom", "email", "sujet", "message", "lien", "url", "nom_du_site"]),
    )
    expect(VARIABLES_DE_CONFIANCE.leadNotification).toEqual(["lien", "url"])
    for (const champ of ["nom", "email", "sujet", "message"]) {
      expect(VARIABLES_DE_CONFIANCE.leadNotification).not.toContain(champ)
    }
  })

  test("purchaseConfirmation confirme l'offre Complet à l'acheteur", () => {
    const achat = CATALOGUE.find((e) => e.cle === "purchaseConfirmation")!
    expect(achat.desactivable).toBe(true)
    expect(achat.variables).toEqual(["nom_du_site", "montant", "lien"])
    expect(VARIABLES_DE_CONFIANCE.purchaseConfirmation).toEqual(["lien"])
  })

  test("postPublished déclare url en confiance, pas titre ni auteur", () => {
    const post = CATALOGUE.find((e) => e.cle === "postPublished")!
    expect(post.titre).toBe("Un collègue a publié un article")
    expect(post.desactivable).toBe(true)
    expect(post.variables).toEqual(["nom_du_site", "url", "titre", "auteur"])
    expect(VARIABLES_DE_CONFIANCE.postPublished).toEqual(["url"])
  })

  test("la réinitialisation est au catalogue, et n'est pas désactivable", () => {
    // Même raisonnement que l'invitation : couper cet email retire le
    // dernier chemin de récupération d'un déploiement où l'inscription est
    // fermée. Un interrupteur ici est un verrouillage à retardement.
    const reset = CATALOGUE.find((e) => e.cle === "passwordReset")!
    expect(reset).toBeDefined()
    expect(reset.desactivable).toBe(false)
    expect(reset.variablesObligatoires).toContain("lien")
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

  test("les seules variables de confiance sont celles que le serveur construit", () => {
    // Ce qui est « de confiance » devient un lien CLIQUABLE dans la partie
    // HTML de l'email (`rendreHtml`, `lib/gabarit.ts`). Les quatre autres
    // variables de la notification de lead sont saisies par un visiteur
    // anonyme du formulaire de contact, et l'email part vers un owner ou un
    // admin : les mettre en lien serait offrir l'hameçonnage des
    // administrateurs du déploiement, depuis le domaine du site. Ce test est
    // le garde-fou de cette liste — l'y ajouter un champ du visiteur le fait
    // échouer.
    expect(VARIABLES_DE_CONFIANCE.leadNotification).toEqual(["lien", "url"])
    for (const champ of ["nom", "email", "sujet", "message"]) {
      expect(VARIABLES_DE_CONFIANCE.leadNotification, champ).not.toContain(champ)
    }
  })

  test("une variable de confiance est d'abord une variable de l'email", () => {
    for (const email of CATALOGUE) {
      for (const nom of VARIABLES_DE_CONFIANCE[email.cle]) {
        expect(email.variables, email.cle).toContain(nom)
      }
    }
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
