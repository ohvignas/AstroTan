import { describe, expect, test } from "vitest"
import {
  escapeHtml,
  rendreHtml,
  rendreTexte,
  singleLine,
  validerGabarit,
  variablesEmployees,
} from "./gabarit"
import { CATALOGUE } from "./catalogueEmails"

const INVITATION = CATALOGUE.find((e) => e.cle === "invitation")!
const LEAD = CATALOGUE.find((e) => e.cle === "leadNotification")!

describe("variablesEmployees", () => {
  test("relève chaque variable une seule fois, dans l'ordre d'apparition", () => {
    expect(variablesEmployees("{{b}} {{a}} {{b}}")).toEqual(["b", "a"])
  })

  test("tolère les espaces intérieurs, comme le rendu", () => {
    expect(variablesEmployees("{{ lien }}")).toEqual(["lien"])
  })
})

describe("validerGabarit", () => {
  test("accepte le gabarit par défaut", () => {
    expect(
      validerGabarit(INVITATION, INVITATION.objetParDefaut, INVITATION.corpsParDefaut),
    ).toBeNull()
  })

  test("accepte l'autre gabarit par défaut du catalogue", () => {
    expect(validerGabarit(LEAD, LEAD.objetParDefaut, LEAD.corpsParDefaut)).toBeNull()
  })

  test("refuse une variable inconnue, en la nommant", () => {
    const message = validerGabarit(INVITATION, "Bonjour", "Voici {{motDePasse}} et {{lien}}")
    expect(message).toContain("motDePasse")
  })

  test("refuse un gabarit d'invitation sans son lien", () => {
    expect(validerGabarit(INVITATION, "Bonjour", "Bienvenue !")).toContain("lien")
  })

  test("refuse un objet sur plusieurs lignes", () => {
    // Un objet contenant un saut de ligne est une injection d'en-têtes :
    // tout ce qui suit devient un en-tête SMTP, `Bcc:` compris.
    expect(validerGabarit(INVITATION, "Bonjour\nBcc: x@y.z", "{{lien}}")).toBeTruthy()
  })

  test("refuse aussi un retour chariot seul, et une tabulation", () => {
    // `\r` suffit à couper un en-tête, et une ligne qui commence par une
    // tabulation est une continuation d'en-tête (RFC 5322, « folding »).
    expect(validerGabarit(INVITATION, "Bonjour\rBcc: x@y.z", "{{lien}}")).toBeTruthy()
    expect(validerGabarit(INVITATION, "Bonjour\tsuite", "{{lien}}")).toBeTruthy()
  })

  test("un corps sur plusieurs lignes reste accepté", () => {
    expect(validerGabarit(INVITATION, "Bonjour", "Bienvenue.\n\n{{lien}}")).toBeNull()
  })

  test("refuse un objet ou un corps vide", () => {
    expect(validerGabarit(INVITATION, "   ", "{{lien}}")).toBeTruthy()
    expect(validerGabarit(INVITATION, "Bonjour", "  \n ")).toBeTruthy()
  })

  test("refuse au-delà des bornes de longueur", () => {
    expect(validerGabarit(INVITATION, "o".repeat(201), "{{lien}}")).toBeTruthy()
    expect(validerGabarit(INVITATION, "Bonjour", "{{lien}}" + "c".repeat(5000))).toBeTruthy()
  })
})

describe("rendreTexte", () => {
  test("substitue les variables", () => {
    expect(rendreTexte("Ouvrez {{lien}}", { lien: "https://x/y" })).toBe("Ouvrez https://x/y")
  })

  test("une variable sans valeur devient vide, pas « undefined »", () => {
    expect(rendreTexte("Bonjour {{nom}}", {})).toBe("Bonjour ")
  })

  test("une valeur ne peut pas introduire une variable", () => {
    // Sinon une valeur venue d'Internet — le nom saisi dans le formulaire
    // de contact — pourrait faire substituer une seconde passe.
    expect(rendreTexte("{{nom}}", { nom: "{{lien}}" })).toBe("{{lien}}")
  })

  test("une valeur ne peut pas introduire une variable QUI EXISTE", () => {
    // La variante précédente passe aussi sur une boucle de `replace`
    // successifs : « lien » n'y est pas une clé. Celle-ci ne passe que si
    // la substitution est faite en une seule passe — une boucle
    // remplacerait `{{nom}}` par `{{lien}}`, puis `{{lien}}` par l'URL.
    expect(rendreTexte("{{nom}} {{lien}}", { nom: "{{lien}}", lien: "https://x/y" })).toBe(
      "{{lien}} https://x/y",
    )
  })

  test("une valeur contenant `$&` n'est pas réinterprétée", () => {
    // `String.replace` traite `$&` dans un remplacement TEXTUEL comme
    // « la correspondance » ; une fonction de remplacement, non.
    expect(rendreTexte("{{nom}}", { nom: "a$&b" })).toBe("a$&b")
  })

  test("une clé héritée d'Object n'est pas une valeur", () => {
    // `{}["constructor"]` rend une fonction, pas `undefined` : sans
    // `hasOwnProperty`, `{{constructor}}` afficherait le code d'Object.
    expect(rendreTexte("{{constructor}}", {})).toBe("")
    expect(rendreTexte("{{toString}}", {})).toBe("")
  })
})

describe("rendreHtml", () => {
  test("échappe les valeurs, jamais le gabarit", () => {
    expect(rendreHtml("<p>{{nom}}</p>", { nom: "<script>x</script>" })).toBe(
      "<p>&lt;script&gt;x&lt;/script&gt;</p>",
    )
  })

  test("une valeur ne peut pas fermer un attribut", () => {
    expect(rendreHtml('<a href="{{lien}}">x</a>', { lien: '"><script>' })).not.toContain(
      "<script>",
    )
  })

  test("une valeur ne peut pas introduire une variable", () => {
    expect(rendreHtml("{{nom}} {{lien}}", { nom: "{{lien}}", lien: "https://x/y" })).toBe(
      "{{lien}} https://x/y",
    )
  })
})

describe("escapeHtml", () => {
  test("échappe les quatre caractères, et pas l'apostrophe", () => {
    // Documenté plutôt que corrigé : `leads.ts` et le rendu HTML des
    // gabarits n'interpolent que dans des attributs à guillemets doubles.
    // Une apostrophe non échappée n'y ouvre rien — mais elle ouvrirait un
    // attribut à guillemets simples, que ce dépôt n'écrit nulle part.
    expect(escapeHtml(`&<>"'`)).toBe(`&amp;&lt;&gt;&quot;'`)
  })
})

describe("singleLine", () => {
  test("réduit tout retour et toute tabulation à une espace, puis élague", () => {
    expect(singleLine(" a\r\n\tb ")).toBe("a b")
  })
})
