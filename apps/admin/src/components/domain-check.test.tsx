import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Enregistrement, Verdict } from "@astrotan/backend/convex/dns"
import { TableauDns, estCopiable, fusionnerVerdicts } from "./domain-check"
import { TableauxDns } from "@/routes/_authed/settings/domaine"

const PLAN_SITE: Enregistrement = {
  cle: "site",
  libelle: "Le site public",
  type: "A",
  nom: "exemple.fr",
  attendu: "l'adresse IPv4 publique de votre serveur",
}

const PLAN_DMARC: Enregistrement = {
  cle: "dmarc",
  libelle: "DMARC — ce qu'un serveur doit faire d'un message non signé",
  type: "TXT",
  nom: "_dmarc.exemple.fr",
  attendu: "v=DMARC1; p=none;",
}

const PLAN_SPF: Enregistrement = {
  cle: "spf",
  libelle: "SPF — qui a le droit d'envoyer en votre nom",
  type: "TXT",
  nom: "exemple.fr",
  attendu: "v=spf1 include:amazonses.com ~all",
}

const OK: Verdict = { ...PLAN_SITE, trouve: ["203.0.113.7"], etat: "ok" }

const MANQUANT: Verdict = { ...PLAN_DMARC, trouve: [], etat: "manquant" }

const DIFFERENT: Verdict = {
  ...PLAN_SPF,
  trouve: [
    "google-site-verification=Z5Zzkmzt",
    "brevo-code:b18a7cb6",
    "v=spf1 include:_spf.google.com ~all",
  ],
  etat: "different",
}

const INDISPONIBLE: Verdict = { ...PLAN_DMARC, trouve: [], etat: "indisponible" }

/** Le texte réellement lisible : balises retirées, entités rendues. */
function texte(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

/** Ce qu'on voit sans cliquer : le panneau d'un `<details>` fermé est retiré. */
function auRepos(html: string): string {
  return texte(
    html.replace(
      /<details(?![^>]*\sopen)[^>]*>([\s\S]*?)<\/details>/g,
      (_tout, dedans: string) =>
        ` ${/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(dedans)?.[1] ?? ""} `
    )
  )
}

// ---------------------------------------------------------------------
// fusionnerVerdicts
// ---------------------------------------------------------------------

describe("fusionnerVerdicts", () => {
  test("sans verdicts, chaque ligne du plan reste — à l'état « attente »", () => {
    const lignes = fusionnerVerdicts([PLAN_SITE, PLAN_DMARC], null)
    expect(lignes).toHaveLength(2)
    expect(lignes.every((l) => l.etat === "attente")).toBe(true)
    expect(lignes.every((l) => l.trouve.length === 0)).toBe(true)
    // Le plan est repris tel quel : type, nom et valeur ne sont pas perdus.
    expect(lignes[0]).toMatchObject({
      cle: "site",
      type: "A",
      nom: "exemple.fr",
      attendu: PLAN_SITE.attendu,
    })
  })

  test("fusion par clé, pas par position", () => {
    const lignes = fusionnerVerdicts([PLAN_SITE, PLAN_DMARC], [MANQUANT, OK])
    const parCle = Object.fromEntries(lignes.map((l) => [l.cle, l.etat]))
    expect(parCle.site).toBe("ok")
    expect(parCle.dmarc).toBe("manquant")
  })

  test("un enregistrement du plan sans verdict correspondant reste en attente", () => {
    const lignes = fusionnerVerdicts([PLAN_SITE, PLAN_DMARC], [OK])
    const dmarc = lignes.find((l) => l.cle === "dmarc")
    expect(dmarc?.etat).toBe("attente")
  })
})

// ---------------------------------------------------------------------
// Le tableau
// ---------------------------------------------------------------------

describe("TableauDns", () => {
  test("chaque enregistrement est une ligne de tableau, pas un paragraphe", () => {
    const html = renderToStaticMarkup(
      <TableauDns
        titre="Les emails"
        lignes={fusionnerVerdicts([PLAN_SPF, PLAN_DMARC], [DIFFERENT, MANQUANT])}
      />
    )
    expect(html).toContain("<table")
    expect((html.match(/data-testid="verdict-/g) ?? []).length).toBe(2)
    expect(html).toContain('data-testid="verdict-spf"')
    expect(html).toContain('data-testid="verdict-dmarc"')
  })

  test("le type et le nom DNS sont des colonnes, pas une phrase", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" lignes={fusionnerVerdicts([PLAN_DMARC], null)} />
    )
    expect(auRepos(html)).toContain("TXT")
    expect(auRepos(html)).toContain("_dmarc.exemple.fr")
  })

  test("la valeur à poser est visible sans déplier", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" lignes={fusionnerVerdicts([PLAN_DMARC], null)} />
    )
    expect(auRepos(html)).toContain("v=DMARC1; p=none;")
  })

  // La régression que cet écran a corrigée une première fois : huit TXT
  // concaténés dans le flux. Ils restent atteignables, mais repliés.
  test("les valeurs trouvées ne sont pas dans le flux, seulement dans le repli", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" lignes={fusionnerVerdicts([PLAN_SPF], [DIFFERENT])} />
    )
    expect(auRepos(html)).not.toContain("brevo-code:b18a7cb6")
    expect(texte(html)).toContain("brevo-code:b18a7cb6")
  })

  test("le libellé ne s'affiche pas dans le flux ; il passe en infobulle", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" lignes={fusionnerVerdicts([PLAN_SPF], null)} />
    )
    expect(auRepos(html)).not.toContain("qui a le droit d'envoyer en votre nom")
    expect(html).toContain('title="SPF — qui a le droit d&#x27;envoyer en votre nom"')
  })
})

// ---------------------------------------------------------------------
// Les signes — trois, pas quatre
// ---------------------------------------------------------------------

describe("le signe d'une ligne", () => {
  function signe(verdict: Verdict): string {
    const html = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([verdict], [verdict])} />
    )
    return /data-signe="([a-z]+)"/.exec(html)?.[1] ?? ""
  }

  test("en place → vert", () => {
    expect(signe(OK)).toBe("ok")
  })

  test("manquant et différent partagent le rouge : même geste", () => {
    expect(signe(MANQUANT)).toBe("ko")
    expect(signe(DIFFERENT)).toBe("ko")
  })

  // Le cœur de la règle : « le résolveur n'a pas répondu » n'est pas
  // « c'est absent ». Les fondre en rouge fait créer un doublon chez
  // l'hébergeur pour un enregistrement qu'on n'a simplement pas pu lire.
  test("indisponible garde un troisième signe, distinct du rouge", () => {
    expect(signe(INDISPONIBLE)).toBe("inconnu")
    expect(signe(INDISPONIBLE)).not.toBe(signe(MANQUANT))
  })

  test("pas encore vérifié partage le signe d'indisponible, pas celui du rouge", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_DMARC], null)} />
    )
    const s = /data-signe="([a-z]+)"/.exec(html)?.[1]
    expect(s).toBe("inconnu")
    // `data-etat`, lui, garde la distinction : utile pour les tests, pas
    // pour l'œil — les deux se voient pareil, pour la même raison.
    expect(html).toContain('data-etat="attente"')
  })

  test("le mot de l'état reste lisible pour un lecteur d'écran", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_SITE], [OK])} />
    )
    expect(html).toContain('aria-label="En place"')
  })
})

// ---------------------------------------------------------------------
// Le bouton de copie
// ---------------------------------------------------------------------

describe("estCopiable", () => {
  test("une vraie valeur DNS se copie", () => {
    expect(estCopiable("v=spf1 include:amazonses.com ~all")).toBe(true)
    expect(estCopiable("v=DMARC1; p=none;")).toBe(true)
    expect(estCopiable("p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN")).toBe(true)
  })

  // Coller « l'adresse IPv4 publique de votre serveur » dans le champ
  // « valeur » de l'hébergeur serait pire que pas de bouton du tout.
  test("une description ne se copie pas", () => {
    expect(estCopiable("l'adresse IPv4 publique de votre serveur")).toBe(false)
    expect(
      estCopiable("la clé publique fournie par Resend (elle commence par « p= »)")
    ).toBe(false)
  })

  test("le bouton n'apparaît que sur les lignes copiables", () => {
    const avec = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_DMARC], null)} />
    )
    const sans = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_SITE], null)} />
    )
    expect(avec).toContain("Copier")
    expect(sans).not.toContain("Copier")
  })
})

// ---------------------------------------------------------------------
// Le défaut de fond corrigé : le tableau vient du plan, pas de la
// vérification.
//
// `TableauxDns` (routes/_authed/settings/domaine.tsx) est pur et sans
// hook : on peut le rendre directement avec `resultat: null`, exactement
// la situation au montage de l'écran, avant que la vérification lancée
// automatiquement n'ait eu le temps de répondre. Un écran qui cache
// encore le tableau tant que `resultat` est `null` — ce que faisait
// l'ancien code, dans un `{resultat !== null ? (...) : null}` — ne
// rendrait ici AUCUNE des deux lignes ci-dessous : ce test échouerait.
// ---------------------------------------------------------------------

describe("TableauxDns", () => {
  test("les enregistrements du plan sont visibles avant toute vérification", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DMARC, PLAN_SPF] }}
        resultat={null}
      />
    )
    expect(html).toContain('data-testid="verdict-site"')
    expect(html).toContain('data-testid="verdict-dmarc"')
    expect(html).toContain('data-testid="verdict-spf"')
    // Les valeurs à poser sont là, pas seulement les clés.
    expect(texte(html)).toContain("v=DMARC1; p=none;")
    // Et l'état de chaque ligne, faute de verdict, est « attente » — pas
    // « manquant » : on n'a encore rien vérifié, on ne sait juste pas.
    expect(html).toContain('data-etat="attente"')
    expect(html).not.toContain('data-etat="manquant"')
  })

  test("un verdict arrivé remplace « attente » par le vrai état, ligne par ligne", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DMARC] }}
        resultat={{ site: [OK], email: [MANQUANT] }}
      />
    )
    expect(html).toContain('data-etat="ok"')
    expect(html).toContain('data-etat="manquant"')
    expect(html).not.toContain('data-etat="attente"')
  })
})

// ---------------------------------------------------------------------
// Ce que l'écran ne doit plus porter
// ---------------------------------------------------------------------

describe("la prose ne revient pas", () => {
  test("trois lignes tiennent en peu de mots au repos", () => {
    const html = renderToStaticMarkup(
      <TableauDns
        titre="Les emails"
        lignes={fusionnerVerdicts([PLAN_SITE, PLAN_DMARC, PLAN_SPF], [OK, MANQUANT, DIFFERENT])}
      />
    )
    const mots = auRepos(html)
      .split(" ")
      .filter((m) => /[\p{L}\p{N}]/u.test(m))
    expect(mots.length).toBeLessThan(30)
  })
})
