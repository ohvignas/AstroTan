// Ce que ce fichier couvre, et pourquoi il ne couvre pas le reste.
//
// `useAutoSave` tient un minuteur, un appel réseau et un abonnement Convex :
// l'exercer demanderait jsdom et Testing Library, que `vitest.config.ts`
// écarte explicitement. Ce qui est testable sans eux, ce sont les décisions
// pures que la barre prend — et ce sont justement celles qui portent les
// invariants :
//
//   • `snapshotChanged`, qui décide si l'on écrit ou non (une comparaison
//     trop laxiste écrirait une ligne qu'on n'a fait qu'ouvrir) ;
//   • `describeStatus` / `formatLastSaved`, qui décident ce que
//     l'opérateur lit — dont l'état d'échec, dont la phrase doit dire que
//     rien n'est perdu ;
//   • le rendu de `SaveBar` dans ses quatre états.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  SaveBar,
  describeStatus,
  formatLastSaved,
  snapshotChanged,
} from "./save-bar"
import type { SaveStatus } from "./save-bar"

// `toContain("disabled")` serait toujours vrai : les classes utilitaires du
// bouton contiennent `disabled:opacity-50`. Seul l'attribut compte.
function buttonIsDisabled(html: string): boolean {
  return /<button[^>]*\sdisabled(?=[\s=>])/.test(html)
}

function render(
  status: SaveStatus,
  {
    lastSavedAt = null,
    error = null,
    canSave = false,
  }: { lastSavedAt?: number | null; error?: string | null; canSave?: boolean } = {}
) {
  return renderToStaticMarkup(
    <SaveBar
      status={status}
      lastSavedAt={lastSavedAt}
      error={error}
      canSave={canSave}
      onSave={() => {}}
    />
  )
}

describe("snapshotChanged", () => {
  test("deux photos identiques ne déclenchent aucune écriture", () => {
    const a = { title: "Tarifs", geo: { entities: ["Convex"] } }
    const b = { title: "Tarifs", geo: { entities: ["Convex"] } }
    expect(snapshotChanged(a, b)).toBe(false)
  })

  test("une différence imbriquée est vue", () => {
    expect(
      snapshotChanged({ geo: { entities: ["a"] } }, { geo: { entities: ["b"] } })
    ).toBe(true)
  })

  test("un champ passé à `undefined` compte comme un changement", () => {
    // `JSON.stringify` supprime la clé — c'est bien deux charges utiles
    // différentes qui partiraient au serveur.
    expect(snapshotChanged({ seo: { title: "x" } }, { seo: {} })).toBe(true)
  })
})

describe("formatLastSaved", () => {
  test("sans horodatage, ne prétend pas qu'une sauvegarde a eu lieu", () => {
    const text = formatLastSaved(null)
    expect(text).not.toContain("Dernière sauvegarde")
    expect(text).toContain("Aucun enregistrement")
  })

  test("avec un horodatage, donne la date et l'heure", () => {
    const text = formatLastSaved(Date.UTC(2026, 7, 29, 12, 7))
    expect(text.startsWith("Dernière sauvegarde le ")).toBe(true)
    expect(text).toContain(" à ")
    expect(text).toContain("2026")
  })
})

describe("describeStatus", () => {
  test("rien à enregistrer : la barre annonce la dernière sauvegarde", () => {
    const at = Date.now()
    expect(describeStatus("saved", at, null)).toBe(formatLastSaved(at))
  })

  test("modifications en attente : la dernière sauvegarde reste lisible", () => {
    const at = Date.now()
    const text = describeStatus("pending", at, null)
    expect(text).toContain(formatLastSaved(at))
    expect(text).toContain("non enregistrées")
  })

  test("enregistrement en cours", () => {
    expect(describeStatus("saving", null, null)).toBe("Enregistrement…")
  })

  test("échec : dit la cause et que rien n'est perdu", () => {
    const text = describeStatus("error", null, "Ce slug est déjà utilisé.")
    expect(text).toContain("Ce slug est déjà utilisé.")
    expect(text).toContain("toujours à l'écran")
  })

  test("échec sans message : reste une phrase, jamais « null »", () => {
    const text = describeStatus("error", null, null)
    expect(text).not.toContain("null")
    expect(text).toContain("échoué")
  })
})

describe("SaveBar", () => {
  test("rien à enregistrer : coche, et bouton désactivé", () => {
    const html = render("saved", { lastSavedAt: Date.now(), canSave: false })
    expect(html).toContain("save-icon-saved")
    expect(buttonIsDisabled(html)).toBe(true)
    expect(html).toContain("Enregistrer")
  })

  test("modifications en attente : icône distincte, bouton actif", () => {
    const html = render("pending", { canSave: true })
    expect(html).toContain("save-icon-pending")
    expect(html).not.toContain("save-icon-saved")
    expect(buttonIsDisabled(html)).toBe(false)
  })

  test("enregistrement en cours : le bouton le dit et ne se reclique pas", () => {
    const html = render("saving", { canSave: false })
    expect(html).toContain("save-icon-saving")
    expect(html).toContain("Enregistrement…")
    expect(buttonIsDisabled(html)).toBe(true)
  })

  test("échec : message d'erreur visible et bouton toujours cliquable", () => {
    const html = render("error", {
      error: "Le serveur a refusé.",
      canSave: true,
    })
    expect(html).toContain("save-icon-error")
    expect(html).toContain("Le serveur a refusé.")
    // Réessayer doit rester possible — c'est l'inverse d'une barre qui se
    // verrouille sur son propre échec.
    expect(buttonIsDisabled(html)).toBe(false)
  })

  test("la barre est collante en bas", () => {
    expect(render("saved")).toContain("sticky bottom-0")
  })
})
