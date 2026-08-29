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

describe("EtatImage — l'accord de genre", () => {
  // Le texte que ce composant a remplacé accordait « Choisissez-en une
  // autre » pour l'icône ; en devenant un composant, il a perdu l'accord et
  // dit « un autre » à tout le monde. Visible sur Réglages → Identité dès
  // qu'une référence d'icône est morte.
  test("l'icône est féminine, le logo masculin — référence morte", () => {
    expect(
      renderToStaticMarkup(<EtatImage etat="introuvable" noun="icône" />),
    ).toContain("une autre")
    expect(
      renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />),
    ).toContain("un autre")
  })

  // Le même défaut, une phrase plus loin et resté deux relectures de plus :
  // « Le site sert le icône du dépôt en attendant ». Il ne se voyait pas
  // tant que la phrase voisine était fausse elle aussi ; la corriger a
  // rendu celui-ci voyant.
  test("l'article s'élide devant « icône » — référence morte", () => {
    expect(
      renderToStaticMarkup(<EtatImage etat="introuvable" noun="icône" />),
    ).toContain("sert l’icône du dépôt")
    expect(
      renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />),
    ).toContain("sert le logo du dépôt")
  })

  test("l'icône est féminine, le logo masculin — aucun réglage", () => {
    const icone = renderToStaticMarkup(<EtatImage etat="defaut" noun="icône" />)
    expect(icone).toContain("Aucune icône choisie")
    expect(icone).toContain("celle du dépôt")
    const logo = renderToStaticMarkup(<EtatImage etat="defaut" noun="logo" />)
    expect(logo).toContain("Aucun logo choisi")
    expect(logo).toContain("celui du dépôt")
  })
})
