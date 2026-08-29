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
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
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

// ---------------------------------------------------------------------
// Le collage en bas de l'écran
//
// `sticky bottom-0` sur la barre a longtemps suffi à faire croire le
// collage acquis — le test ci-dessus le vérifiait, et il passait, pendant
// que la barre flottait en plein milieu de `settings/referencement`.
//
// Parce que `position: sticky` ne pousse rien vers le bas : il retient un
// élément que le défilement emmènerait hors de l'écran. Sur une page plus
// courte que la fenêtre, il n'y a rien à retenir, et la barre se pose là
// où le contenu s'arrête. Le collage tient donc à trois faits répartis
// sur trois fichiers, et il suffit d'en perdre un pour rouvrir le défaut.
// Ce qui suit les nomme tous les trois, là où on les cherchera.
//
// Ce sont des assertions sur du TEXTE SOURCE, et c'est assumé : un
// `sticky` cassé est un fait de mise en page, que ni `vitest` en
// environnement `node` ni jsdom (qui n'implémente aucune mise en page)
// ne peuvent constater. Le défaut a été observé, et le correctif vérifié,
// dans un vrai navigateur sur une reconstitution de l'arbre réel. Ceci
// n'en est pas la preuve : c'est le garde-fou contre la refonte qui
// enlèverait une des trois pièces sans savoir qu'elle en était une.
// ---------------------------------------------------------------------

const APP_SHELL = readFileSync(
  fileURLToPath(new URL("./app-shell.tsx", import.meta.url)),
  "utf8"
)
const SETTINGS_LAYOUT = readFileSync(
  fileURLToPath(new URL("../routes/_authed/settings.tsx", import.meta.url)),
  "utf8"
)
const SETTINGS_NAV = readFileSync(
  fileURLToPath(new URL("./settings-nav.tsx", import.meta.url)),
  "utf8"
)

describe("le collage en bas de l'écran", () => {
  test("la barre se pousse au bas de sa colonne, et se laisse reconnaître", () => {
    const html = render("saved")
    // `mt-auto` mange l'espace libre de la colonne : sans lui, une page
    // courte laisse la barre juste sous sa dernière carte.
    expect(html).toContain("mt-auto")
    // La prise sur laquelle `AppShell` sélectionne la colonne à étirer.
    expect(html).toContain('data-slot="save-bar"')
  })

  test("AppShell étire l'écran qui porte une barre", () => {
    // Sans cette règle, `mt-auto` n'a aucun espace libre à manger : la
    // colonne s'arrête à la fin de son contenu, bien au-dessus du bas de
    // la fenêtre.
    expect(APP_SHELL).toContain("*:has-[[data-slot=save-bar]]:flex-1")
  })

  test("la rangée des réglages n'aligne plus toute la page en haut", () => {
    // `lg:items-start` visait le menu — qui porte désormais son propre
    // `lg:self-start` — mais atteignait aussi la colonne de droite, et
    // l'empêchait de descendre jusqu'en bas de la fenêtre. La chaîne
    // entière, et non `not.toContain` : le commentaire qui explique le
    // retrait nomme forcément la classe retirée.
    expect(SETTINGS_LAYOUT).toContain(
      '"flex flex-col gap-4 lg:flex-row lg:gap-8"'
    )
    expect(SETTINGS_NAV).toContain("lg:self-start")
  })
})
