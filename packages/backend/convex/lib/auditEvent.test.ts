import { describe, expect, test } from "vitest"
import { AUDIT_CIBLE_NATURE, CIBLE_NATURES } from "../_dataRegistry"
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

  // Les huit gestes que la tâche initiale demandait d'instrumenter, plus
  // les cinq de la relecture finale (correctif 2) : `invitation.create` —
  // l'autre chemin, outre `users.setRole`, par lequel un rôle s'accorde —
  // et la parité page/article pour publier, dépublier et supprimer.
  // S'y ajoutent les trois gestes de l'écran d'envoi des emails : modifier
  // le texte d'un email, couper ou rétablir son envoi, revenir au texte du
  // code. Trois et non un seul — voir `auditEvent.ts` pour pourquoi les
  // confondre rendrait le journal muet sur la question qu'on lui pose.
  // La liste est fermée, et ce test est ce qui empêche d'en retirer un en
  // silence : supprimer une action de `AUDIT_ACTIONS` fait disparaître ses
  // lignes de journal sans rien casser d'autre.
  // S'y ajoute `password.reset` : le seul geste de la liste dont l'auteur
  // n'est pas une session authentifiée, et le seul qui modifie un accès
  // sans qu'aucune connexion ne l'ait demandé — donc le seul qu'aucune
  // autre donnée conservée ne permettrait de reconstituer après coup.
  test("la liste couvre exactement les dix-sept gestes instrumentés", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        "password.reset",
        "emailTemplate.reset",
        "emailTemplate.set",
        "emailTemplate.toggle",
        "invitation.create",
        "lead.remove",
        "page.publish",
        "page.remove",
        "page.unpublish",
        "post.publish",
        "post.remove",
        "post.unpublish",
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

// ---------------------------------------------------------------------
// La moitié « backend » du garde-fou du journal publié.
//
// Le test ci-dessus ferme la liste des actions ; il ne dit rien de ce
// qu'elles ÉCRIVENT. C'est par là que le défaut est passé : trois actions
// ajoutées (`invitation.create`, `password.reset`, `emailTemplate.*`)
// écrivaient en `cible` des catégories que `/confidentialite` n'énumérait
// pas — dont l'adresse d'une personne invitée qui n'a jamais eu de compte,
// dans la seule table que rien ne purge.
//
// Le maillon est `AUDIT_CIBLE_NATURE` (`convex/_dataRegistry.ts`) : une
// action y pointe la NATURE de sa cible, et la nature porte la phrase que
// la page doit publier. Ici on tient le premier bout — toute action a une
// nature, et cette nature existe. `apps/web/src/config/legal.test.ts`
// tient l'autre — la phrase est réellement publiée.
// ---------------------------------------------------------------------

describe("la nature de la cible, en face de chaque geste", () => {
  test("toute action journalisée a une nature déclarée", () => {
    // `Record<AuditAction, …>` le refuserait déjà à la compilation. Refait
    // ici parce que `tsc` ne tourne pas dans la boucle d'un `vitest run` :
    // une action ajoutée avec le typecheck en échec passerait au vert.
    const sansNature = AUDIT_ACTIONS.filter((action) => !(action in AUDIT_CIBLE_NATURE))
    expect(
      sansNature,
      "Une action a été ajoutée à `AUDIT_ACTIONS` sans dire ce qu'elle écrit " +
        "en `cible`. Ajoutez-lui une nature dans `AUDIT_CIBLE_NATURE` " +
        "(`convex/_dataRegistry.ts`) : si cette nature est nouvelle, elle doit " +
        "aussi être énumérée dans le registre publié sur /confidentialite " +
        "(`apps/web/src/config/legal.ts`), sans quoi la page décrit un journal " +
        "qui n'est plus celui que le code écrit.",
    ).toEqual([])
  })

  test("aucune nature déclarée n'a survécu à son action", () => {
    // La réciproque : une entrée qui reste après le retrait de son action
    // force la page à publier une catégorie que le journal n'écrit plus.
    const connues = new Set<string>(AUDIT_ACTIONS)
    expect(Object.keys(AUDIT_CIBLE_NATURE).filter((a) => !connues.has(a))).toEqual([])
  })

  test("chaque nature pointée existe, et dit soit sa phrase soit sa raison", () => {
    for (const [action, nom] of Object.entries(AUDIT_CIBLE_NATURE)) {
      const nature = CIBLE_NATURES[nom]
      expect(nature, `${action} pointe une nature inconnue : ${nom}`).toBeDefined()
      // Une phrase vide passerait le test de la page publiée — `contains ""`
      // est toujours vrai — tout en n'énumérant rien. Une raison vide serait
      // la porte de sortie silencieuse que `sansCible` ne doit pas être.
      const texte = "publiee" in nature ? nature.publiee : nature.sansCible
      expect(texte.trim().length, `la nature ${nom} ne dit rien`).toBeGreaterThan(20)
    }
  })

  test("`invitation.create` écrit une adresse SANS COMPTE, et le dit", () => {
    // Le cas qui coûte, nommé plutôt que noyé dans la boucle ci-dessus :
    // une personne invitée qui n'accepte jamais n'a jamais de compte, et
    // son adresse reste pourtant dans une table sans purge. La ranger
    // sous la même nature que `role.change` publierait une phrase où elle
    // ne se reconnaîtrait pas — « le compte concerné », alors qu'elle n'en
    // a pas. Ce test refuse cette fusion.
    expect(AUDIT_CIBLE_NATURE["invitation.create"]).toBe("emailDePersonneInvitee")
    expect(AUDIT_CIBLE_NATURE["invitation.create"]).not.toBe(
      AUDIT_CIBLE_NATURE["role.change"],
    )
  })
})
