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
    expect(rendreHtml("<p>{{nom}}</p>", { nom: "<script>x</script>" }, "leadNotification")).toBe(
      "<p>&lt;script&gt;x&lt;/script&gt;</p>",
    )
  })

  test("une valeur ne peut pas fermer un attribut", () => {
    expect(
      rendreHtml('<a href="{{lien}}">x</a>', { lien: '"><script>' }, "invitation"),
    ).not.toContain("<script>")
  })

  test("une valeur ne peut pas introduire une variable", () => {
    // Toujours vrai MAINTENANT QUE LE RENDU MET EN LIEN : le `{{lien}}`
    // rendu par la valeur de `{{nom}}` reste du texte, et seule la vraie
    // variable `{{lien}}` devient une ancre.
    expect(
      rendreHtml("{{nom}} {{lien}}", { nom: "{{lien}}", lien: "https://x/y" }, "invitation"),
    ).toBe('{{lien}} <a href="https://x/y">https://x/y</a>')
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

// ---------------------------------------------------------------------------
// Mise en lien : ce qui devient cliquable, et ce qui ne le devient jamais.
// ---------------------------------------------------------------------------

const RESET = CATALOGUE.find((e) => e.cle === "passwordReset")!

describe("rendreHtml — mise en lien", () => {
  test("LE test : une URL écrite par un visiteur ne produit AUCUN lien", () => {
    // Le scénario complet, avec le vrai gabarit du catalogue et les vraies
    // valeurs que `leads.notifyStaff` compose : `nom`, `email`, `sujet` et
    // `message` sont saisis par un anonyme dans le formulaire de contact
    // public, et l'email part du domaine du site vers un owner ou un admin.
    // Mettre en lien ce qu'il écrit, ce serait lui offrir l'hameçonnage de
    // ses propres administrateurs, depuis le domaine du site.
    const html = rendreHtml(
      LEAD.corpsParDefaut,
      {
        nom: "https://phishing.example/nom",
        email: "https://phishing.example/email",
        sujet: "https://phishing.example/sujet",
        message: "Urgent : connectez-vous sur https://phishing.example/login",
        lien: "https://admin.exemple.fr/leads",
      },
      "leadNotification",
    )

    // Aucune ancre ne pointe vers le domaine du visiteur.
    expect(html).not.toMatch(/<a[^>]*phishing\.example/)
    // Son URL reste dans le corps, en texte : elle n'est pas censurée, elle
    // n'est pas cliquable.
    expect(html).toContain("https://phishing.example/login")
    // Et le seul lien cliquable de tout l'email est celui que le serveur a
    // construit.
    expect([...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "https://admin.exemple.fr/leads",
    ])
  })

  test("les quatre champs du visiteur sont hors confiance, un par un", () => {
    // Le test précédent les met tous dans le même rendu : celui-ci
    // échouerait encore si un seul d'entre eux passait de confiance.
    for (const champ of ["nom", "email", "sujet", "message"]) {
      const html = rendreHtml(
        `{{${champ}}}`,
        { [champ]: "https://phishing.example/x" },
        "leadNotification",
      )
      expect(html, champ).not.toContain("<a")
    }
  })

  test("le lien légitime est cliquable dans les trois emails", () => {
    // `${SITE_URL}/accept-invite?token=…`, `${SITE_URL}/leads` et l'URL de
    // réinitialisation : trois valeurs construites par le serveur, dans les
    // trois gabarits livrés.
    for (const email of CATALOGUE) {
      const html = rendreHtml(
        email.corpsParDefaut,
        {
          nom: "Ada",
          email: "ada@exemple.fr",
          sujet: "Bonjour",
          message: "Bonjour",
          lien: "https://admin.exemple.fr/x",
        },
        email.cle,
      )
      expect(html, email.cle).toContain(
        '<a href="https://admin.exemple.fr/x">https://admin.exemple.fr/x</a>',
      )
    }
  })

  test("une URL à paramètres garde son `&` échappé, dans le href comme dans le texte", () => {
    // `&amp;` est la forme CORRECTE d'un `&` dans un attribut : le
    // navigateur le décode avant de suivre le lien. Vérifié pour de vrai,
    // en collant le résultat dans un navigateur — voir le rapport.
    const html = rendreHtml("{{lien}}", { lien: "https://x.fr/a?b=1&c=2" }, "passwordReset")
    expect(html).toBe('<a href="https://x.fr/a?b=1&amp;c=2">https://x.fr/a?b=1&amp;c=2</a>')
  })

  test("la ponctuation finale reste hors du lien", () => {
    // L'URL et le point sont dans LE MÊME segment : c'est le seul cas où
    // la question se pose. « Ouvrez {{lien}}. » ne prouverait rien — le
    // point y est un segment de gabarit distinct de la valeur, et il
    // resterait dehors même sans élagage.
    const html = rendreHtml("Ouvrez https://exemple.fr/x.", {}, "passwordReset")
    expect(html).toBe('Ouvrez <a href="https://exemple.fr/x">https://exemple.fr/x</a>.')
  })

  test("une parenthèse fermante appariée reste DANS le lien", () => {
    // L'autre moitié de l'élagage : retirer aveuglément la parenthèse
    // finale amputerait une URL qui l'a ouverte elle-même.
    const html = rendreHtml("Voir https://x.fr/w/A_(b).", {}, "passwordReset")
    expect(html).toBe('Voir <a href="https://x.fr/w/A_(b)">https://x.fr/w/A_(b)</a>.')
  })

  test("https uniquement : ni http, ni mailto, ni javascript", () => {
    // `javascript:` traverse l'échappement HTML intact — c'est la raison
    // pour laquelle la mise en lien passe par `isSafeHref`, et pour laquelle
    // le motif d'URL ne connaît qu'un seul schéma.
    for (const url of ["http://x.fr/y", "mailto:a@x.fr", "javascript:alert(1)", "//x.fr/y"]) {
      const html = rendreHtml("{{lien}}", { lien: url }, "passwordReset")
      expect(html, url).not.toContain("<a")
    }
  })

  test("un caractère de contrôle dans l'URL la refuse : c'est `isSafeHref` qui le dit", () => {
    // Le motif d'URL s'arrête aux blancs, pas aux autres caractères de
    // contrôle : `https://exemple.fr/\u0001x` le traverse entier. C'est
    // `isSafeHref` qui l'arrête — retirer cet appel rend ce test rouge, ce
    // qui est la seule preuve que la parade du dépôt porte vraiment quelque
    // chose ici.
    const html = rendreHtml("{{lien}}", { lien: "https://exemple.fr/\u0001x" }, "passwordReset")
    expect(html).not.toContain("<a")
  })

  test("le texte du gabarit est mis en lien : son auteur a un compte", () => {
    const html = rendreHtml("Notre site : https://exemple.fr", {}, "invitation")
    expect(html).toBe('Notre site : <a href="https://exemple.fr">https://exemple.fr</a>')
  })

  test("une URL déjà dans un attribut du gabarit n'est pas re-liée", () => {
    // Un adoptant qui écrit son ancre à la main obtiendrait sinon une ancre
    // dans une ancre — du HTML cassé là où sa version marchait.
    const html = rendreHtml('<a href="https://exemple.fr">clic</a>', {}, "invitation")
    expect(html).toBe('<a href="https://exemple.fr">clic</a>')
  })
})

describe("rendreTexte — inchangé", () => {
  test("rend l'URL nue, sans ancre : un email en texte n'a pas d'ancres", () => {
    const texte = rendreTexte(RESET.corpsParDefaut, { lien: "https://x.fr/y" })
    expect(texte).toContain("https://x.fr/y")
    expect(texte).not.toContain("<a")
  })
})
