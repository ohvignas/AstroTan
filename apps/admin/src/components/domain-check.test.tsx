import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ResultatsDns } from "./domain-check"

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
