import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { OrigineDesLiens, ResultatsDns } from "./domain-check"

const OK = {
  cle: "site",
  libelle: "Le site",
  attendu: "Une adresse IPv4",
  trouve: ["203.0.113.7"],
  etat: "ok" as const,
  instruction: "",
}
const MANQUANT = {
  cle: "dmarc",
  libelle: "DMARC",
  attendu: "v=DMARC1",
  trouve: [],
  etat: "manquant" as const,
  instruction: "Créez un TXT sur _dmarc.exemple.fr valant v=DMARC1; p=none",
}

describe("ResultatsDns", () => {
  test("une ligne manquante affiche l'enregistrement à créer", () => {
    const html = renderToStaticMarkup(<ResultatsDns verdicts={[MANQUANT]} />)
    expect(html).toContain("_dmarc.exemple.fr")
    expect(html).toContain("v=DMARC1")
  })

  test("une ligne satisfaite n'affiche aucune instruction", () => {
    // Une instruction affichée à côté d'une coche verte fait douter de la
    // coche, et fait recréer un enregistrement qui existe.
    const html = renderToStaticMarkup(<ResultatsDns verdicts={[OK]} />)
    expect(html).not.toContain("Créez")
  })

  test("« indisponible » ne dit pas de créer quoi que ce soit", () => {
    const html = renderToStaticMarkup(
      <ResultatsDns verdicts={[{ ...MANQUANT, etat: "indisponible" }]} />,
    )
    expect(html).not.toContain("Créez")
    expect(html).toMatch(/réessay/i)
  })
})

// ---------------------------------------------------------------------
// L'origine des liens des emails
// ---------------------------------------------------------------------

describe("OrigineDesLiens", () => {
  test("quand l'origine correspond, elle s'affiche sans avertissement", () => {
    const html = renderToStaticMarkup(
      <OrigineDesLiens
        adminUrl="https://admin.exemple.fr"
        hote="admin.exemple.fr"
        correspond
        declare="exemple.fr"
      />,
    )
    expect(html).toContain("https://admin.exemple.fr")
    expect(html).not.toMatch(/mènent nulle part/)
  })

  // La discrimination qui compte : le même hôte, avec `correspond` à
  // `false`, doit basculer sur l'avertissement — sinon ce test passerait
  // pour n'importe quel rendu qui contient la chaîne cherchée.
  test("quand l'origine ne correspond pas, l'avertissement remplace l'état calme", () => {
    const html = renderToStaticMarkup(
      <OrigineDesLiens
        adminUrl="http://localhost:3001"
        hote="localhost"
        correspond={false}
        declare="exemple.fr"
      />,
    )
    expect(html).toContain("localhost")
    expect(html).toContain("exemple.fr")
    expect(html).toMatch(/mènent nulle part/)
    expect(html).not.toContain("Origine des liens des emails")
  })

  test("aucune origine réglée est nommée, pas laissée vide", () => {
    const html = renderToStaticMarkup(
      <OrigineDesLiens adminUrl={null} hote={null} correspond={false} declare="exemple.fr" />,
    )
    expect(html).toMatch(/aucune origine réglée/)
  })
})
