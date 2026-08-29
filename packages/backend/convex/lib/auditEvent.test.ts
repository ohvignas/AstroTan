import { describe, expect, test } from "vitest"
import { AUDIT_ACTIONS, decrireAction } from "./auditEvent"

describe("decrireAction", () => {
  test("chaque action a une phrase lisible", () => {
    // Un journal qui affiche `SET_ROLE` oblige à connaître le code pour le
    // lire, et personne ne le consulte au moment où il faudrait.
    for (const action of AUDIT_ACTIONS) {
      expect(decrireAction(action, "Antoine", "editor").length).toBeGreaterThan(10)
    }
  })

  test("nomme l'auteur et la cible", () => {
    expect(decrireAction("role.change", "Antoine", "editor")).toContain("Antoine")
    expect(decrireAction("role.change", "Antoine", "editor")).toContain("editor")
  })

  // Les huit gestes que la tâche demande d'instrumenter. La liste est
  // fermée, et ce test est ce qui empêche d'en retirer un en silence :
  // supprimer une action de `AUDIT_ACTIONS` fait disparaître ses lignes de
  // journal sans rien casser d'autre.
  test("la liste couvre exactement les huit gestes instrumentés", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        "lead.remove",
        "page.publish",
        "page.unpublish",
        "role.change",
        "secret.clear",
        "secret.set",
        "settings.update",
        "user.remove",
      ].sort(),
    )
  })

  // Le détail est facultatif dans le journal — `settings.update` n'a pas de
  // cible — et une phrase amputée d'un `undefined` visible se lit mal.
  test("sans cible ni détail, la phrase reste une phrase", () => {
    for (const action of AUDIT_ACTIONS) {
      const phrase = decrireAction(action, "Antoine")
      expect(phrase).toContain("Antoine")
      expect(phrase).not.toContain("undefined")
    }
  })

  // Le détail sert au geste qui a deux informations à porter : le rôle
  // donné, le nom du réglage touché. Il s'ajoute à la cible, il ne la
  // remplace pas.
  test("le détail complète la cible sans l'effacer", () => {
    const phrase = decrireAction("role.change", "Antoine", "alice@exemple.fr", "editor")
    expect(phrase).toContain("alice@exemple.fr")
    expect(phrase).toContain("editor")
  })
})
