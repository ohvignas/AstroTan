// Les deux choses que cet écran doit tenir : un lien mort explique quoi
// faire sans reprocher quoi que ce soit, et les bornes affichées sont
// celles que le serveur applique.
//
// Même arbitrage de rendu que `forgot-password.test.tsx` : les composants
// porteurs de texte sont exportés et rendus seuls, la page ne l'est pas.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@astrotan/backend/convex/lib/passwordStrength"
import {
  FormulaireReinitialisation,
  ReinitialisationInvalide,
} from "./reset-password"

describe("ReinitialisationInvalide", () => {
  test("un jeton absent ou refusé explique quoi faire, sans blâmer", () => {
    const html = renderToStaticMarkup(<ReinitialisationInvalide />)
    expect(html).toMatch(/expiré|invalide/i)
    expect(html).toContain("/forgot-password")
  })

  test("ne reproche rien à la personne", () => {
    // Un lien qui a passé une heure dans une boîte mail n'est la faute de
    // personne, et quelqu'un sur cette page est déjà contrarié. Aucune
    // formulation ne doit désigner un tort.
    const html = renderToStaticMarkup(<ReinitialisationInvalide />)
    for (const reproche of [
      /vous avez/i,
      /erreur/i,
      /incorrect/i,
      /trop tard/i,
      /auriez/i,
    ]) {
      expect(html, reproche.source).not.toMatch(reproche)
    }
  })

  test("n'explique pas le mécanisme", () => {
    // Ni durée de validité « pour information », ni jeton, ni rien de ce
    // qui se passe derrière : la carte dit quoi faire, un point c'est
    // tout.
    const html = renderToStaticMarkup(<ReinitialisationInvalide />)
    for (const mecanisme of [/jeton|token/i, /heure|minute|délai/i]) {
      expect(html, mecanisme.source).not.toMatch(mecanisme)
    }
  })
})

describe("FormulaireReinitialisation", () => {
  test("les bornes affichées sont celles que le serveur applique", () => {
    // Écrites à partir des mêmes constantes que `auth.ts` passe à
    // `minPasswordLength`/`maxPasswordLength` : si elles bougent, ce test
    // suit, et une valeur recopiée en dur à l'écran le fait échouer.
    const html = renderToStaticMarkup(
      <FormulaireReinitialisation token="peu-importe" />
    )
    expect(html).toContain(
      `Entre ${MIN_PASSWORD_LENGTH} et ${MAX_PASSWORD_LENGTH} caractères`
    )
  })

  test("le bouton part désactivé — un champ vide n'est pas soumissible", () => {
    const html = renderToStaticMarkup(
      <FormulaireReinitialisation token="peu-importe" />
    )
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  test("le jeton n'apparaît jamais dans le rendu", () => {
    // Il vit dans l'URL, il n'a rien à faire dans un champ, un attribut ou
    // un texte — donc rien qui puisse partir dans un `Referer`, une
    // capture d'écran ou un rapport d'erreur du navigateur.
    const html = renderToStaticMarkup(
      <FormulaireReinitialisation token="jeton-de-test-0123456789" />
    )
    expect(html).not.toContain("jeton-de-test-0123456789")
  })
})
