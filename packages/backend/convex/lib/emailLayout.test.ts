import { describe, expect, test } from "vitest"
import { CATALOGUE } from "./catalogueEmails"
import {
  composerMessage,
  envelopperHtml,
  valeursExemple,
} from "./emailLayout"
import { rendreHtml } from "./gabarit"

const INVITATION = CATALOGUE.find((e) => e.cle === "invitation")!

describe("envelopperHtml", () => {
  test("entoure le corps du gabarit, sans le réécrire", () => {
    const corps = rendreHtml("Bonjour {{lien}}", { lien: "https://admin.exemple.fr/x" }, "invitation")
    const html = envelopperHtml(corps, { siteName: "Cabinet Nord" }, { cle: "invitation" })

    expect(html).toContain("Bonjour")
    expect(html).toContain("https://admin.exemple.fr/x")
    expect(html).toContain("Cabinet Nord")
    expect(html).toContain("<table")
    expect(html).toContain("Accepter l'invitation")
  })

  test("échappe le nom du site : ce n'est pas du balisage", () => {
    const html = envelopperHtml("corps", { siteName: "<script>x</script>" }, { cle: "invitation" })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  test("un logo n'entre que s'il est une URL https publique", () => {
    const refuse = envelopperHtml("x", {
      siteName: "Nord",
      logoUrl: "javascript:alert(1)",
    })
    expect(refuse).not.toContain("<img")

    const local = envelopperHtml("x", {
      siteName: "Nord",
      logoUrl: "http://localhost:4321/logo",
    })
    expect(local).not.toContain("<img")

    const storage = envelopperHtml("x", {
      siteName: "Nord",
      logoUrl: "https://happy-animal-123.convex.cloud/api/storage/kg",
    })
    expect(storage).not.toContain("<img")
    expect(storage).toContain(">N<")

    const accepte = envelopperHtml("x", {
      siteName: "Nord",
      logoUrl: "https://cdn.exemple.fr/logo.png",
    })
    expect(accepte).toContain("<img")
    expect(accepte).toContain("https://cdn.exemple.fr/logo.png")
    expect(accepte).not.toMatch(/alt="Nord"/)
  })

  test("le pied est le domaine, pas un second nom de site", () => {
    const html = envelopperHtml("corps", {
      siteName: "AstroTan",
      footerLine: "illith.com",
    }, { cle: "invitation" })
    expect(html).toContain("illith.com")
    const sansTitre = html.replace(/<title>[\s\S]*?<\/title>/, "")
    expect(sansTitre.match(/AstroTan/g)?.length ?? 0).toBe(1)
    expect(html).toContain("#f60f74")
  })

  test("chaque type du catalogue passe par le même chrome", () => {
    for (const { cle } of CATALOGUE) {
      const html = envelopperHtml("corps", { siteName: "Cabinet Nord", footerLine: "nord.fr" }, { cle })
      expect(html).toContain("<table")
      expect(html).toContain("Cabinet Nord")
      expect(html).toContain("nord.fr")
      expect(html).not.toContain("height:4px")
    }
  })

  test("la mention de relance reste au-dessus du corps, échappée", () => {
    const html = envelopperHtml("corps", { siteName: "Nord" }, {
      cle: "leadNotification",
      preface: "2e message <b>x</b>",
    })
    expect(html).toContain("2e message")
    expect(html).toContain("&lt;b&gt;")
    expect(html.indexOf("2e message")).toBeLessThan(html.indexOf("corps"))
  })
})

describe("composerMessage", () => {
  test("l'objet, le texte et le HTML viennent du gabarit, pas d'une copie figée", () => {
    const message = composerMessage(
      { objet: "Rejoignez {{nom_du_site}}", corps: "Ouvrez {{lien}}" },
      { nom_du_site: "Atelier", lien: "https://admin.exemple.fr/i" },
      "invitation",
      { siteName: "Atelier" },
    )
    expect(message.subject).toBe("Rejoignez Atelier")
    expect(message.text).toBe("Ouvrez https://admin.exemple.fr/i")
    expect(message.html).toContain("Ouvrez")
    expect(message.html).toContain("Atelier")
    expect(message.html).toContain("https://admin.exemple.fr/i")
  })

  test("un saut de ligne dans une valeur n'atteint pas l'objet", () => {
    const message = composerMessage(
      { objet: "De {{nom}}", corps: "{{message}}" },
      { nom: "Camille\nBcc: x@y.z", message: "ok" },
      "leadNotification",
      { siteName: "Nord" },
    )
    expect(message.subject).not.toMatch(/[\r\n]/)
  })
})

describe("valeursExemple", () => {
  test("chaque email du catalogue a un exemplaire qui passe sa propre validation", () => {
    for (const email of CATALOGUE) {
      const valeurs = valeursExemple(email.cle, {
        siteName: "Cabinet Nord",
        adminUrl: "https://admin.exemple.fr",
      })
      for (const obligatoire of email.variablesObligatoires) {
        expect(valeurs[obligatoire], email.cle).toBeTruthy()
      }
    }
  })

  test("l'invitation d'exemple porte le nom du site, pas AstroTan", () => {
    const valeurs = valeursExemple("invitation", {
      siteName: "Cabinet Nord",
      adminUrl: "https://admin.exemple.fr",
    })
    expect(valeurs.nom_du_site).toBe("Cabinet Nord")
    expect(valeurs.lien).toContain("https://admin.exemple.fr")
  })
})

describe("le défaut du catalogue se compose avec le nom du site", () => {
  test("l'invitation livrée n'écrit plus AstroTan en dur", () => {
    expect(INVITATION.objetParDefaut).toContain("{{nom_du_site}}")
    expect(INVITATION.corpsParDefaut).toContain("{{nom_du_site}}")
    expect(INVITATION.variables).toContain("nom_du_site")
  })
})
