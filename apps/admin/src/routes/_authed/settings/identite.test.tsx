import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { EtatImage } from "./identite"

describe("EtatImage", () => {
  test("sans réglage, annonce l'image du dépôt", () => {
    const html = renderToStaticMarkup(<EtatImage etat="defaut" noun="logo" />)
    expect(html).toContain("du dépôt")
    expect(html).not.toContain("n’existe plus")
  })

  test("référence morte : dit ce qui s'est passé ET ce que le site sert", () => {
    // Le défaut corrigé : le message remplaçait l'image. Or il y a toujours
    // un logo en ligne — celui du dépôt — et l'écran doit le montrer.
    const html = renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />)
    expect(html).toContain("n’existe plus")
    expect(html).toContain("du dépôt")
  })

  test("le ton n'est pas alarmant : ce n'est pas une panne du site", () => {
    // Rouge sur toute la largeur laissait croire que le site était cassé.
    const html = renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />)
    expect(html).not.toContain("text-destructive")
  })
})
