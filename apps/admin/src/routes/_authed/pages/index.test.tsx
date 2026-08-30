// Ce que `lib/slugSync.test.ts` ne peut pas couvrir : le câblage.
//
// Les règles du couple titre/slug sont des fonctions pures, testées là-bas.
// Ici on vérifie le maillon suivant — que l'état calculé arrive bien dans
// les champs, et que le refus de collision s'affiche. `vitest.config.ts`
// est en `environment: "node"` : rendu par `renderToStaticMarkup`, sans
// DOM, donc le corps du dialogue est exporté et rendu seul (même arbitrage
// que `routes/forgot-password.test.tsx`).
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { PAGE_ERROR_MESSAGES } from "@/lib/pageErrors"
import { ETAT_SLUG_INITIAL, saisirTitre } from "@/lib/slugSync"
import { CorpsNouvellePage } from "./index"

const rendu = (
  etat = ETAT_SLUG_INITIAL,
  dejaPris = false,
  error: string | null = null
) =>
  renderToStaticMarkup(
    <CorpsNouvellePage
      etat={etat}
      dejaPris={dejaPris}
      error={error}
      onTitre={() => {}}
      onSlug={() => {}}
    />
  )

describe("le corps du dialogue « Nouvelle page »", () => {
  test("le slug dérivé du titre arrive dans le champ", () => {
    const html = rendu(saisirTitre(ETAT_SLUG_INITIAL, "À propos de nous"))
    expect(html).toContain('id="page-slug"')
    expect(html).toContain('value="a-propos-de-nous"')
    expect(html).toContain('value="À propos de nous"')
  })

  test("un slug déjà pris est refusé à l'écran, pas seulement au clic", () => {
    const html = rendu(saisirTitre(ETAT_SLUG_INITIAL, "Contact"), true)
    expect(html).toContain(PAGE_ERROR_MESSAGES.SLUG_ALREADY_EXISTS)
    expect(html).toContain('aria-invalid="true"')
  })

  test("sans collision, rien n'est signalé", () => {
    const html = rendu(saisirTitre(ETAT_SLUG_INITIAL, "Tarifs"))
    expect(html).not.toContain(PAGE_ERROR_MESSAGES.SLUG_ALREADY_EXISTS)
    expect(html).not.toContain(`aria-invalid="true"`)
  })

  test("le refus serveur reste affiché tel quel", () => {
    const html = rendu(ETAT_SLUG_INITIAL, false, "Votre session a expiré.")
    expect(html).toContain("Votre session a expiré.")
  })
})
