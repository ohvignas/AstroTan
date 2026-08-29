import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Verdict } from "@astrotan/backend/convex/dns"
import {
  TableauDns,
  TableauEtats,
  estCopiable,
  nomEtGlose,
} from "./domain-check"
import { lignesEtat } from "@/routes/_authed/settings/domaine"

const OK: Verdict = {
  cle: "site",
  libelle: "Le site public",
  attendu: "l'adresse IPv4 publique de votre serveur",
  trouve: ["203.0.113.7"],
  etat: "ok",
  instruction:
    "Rien à faire : un enregistrement A sur « exemple.fr », de valeur : l'adresse IPv4 publique de votre serveur — il est en place.",
}

const MANQUANT: Verdict = {
  cle: "dmarc",
  libelle: "DMARC — ce qu'un serveur doit faire d'un message non signé",
  attendu: "v=DMARC1; p=none;",
  trouve: [],
  etat: "manquant",
  instruction:
    "Créez un enregistrement TXT sur « _dmarc.exemple.fr », de valeur : v=DMARC1; p=none;",
}

const DIFFERENT: Verdict = {
  cle: "spf",
  libelle: "SPF — qui a le droit d'envoyer en votre nom",
  attendu: "v=spf1 include:amazonses.com ~all",
  trouve: [
    "google-site-verification=Z5Zzkmzt",
    "brevo-code:b18a7cb6",
    "v=spf1 include:_spf.google.com ~all",
  ],
  etat: "different",
  instruction:
    "« exemple.fr » porte déjà un enregistrement TXT, mais aucun qui convienne. Remplacez sa valeur par : v=spf1 include:amazonses.com ~all",
}

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
// Le tableau
// ---------------------------------------------------------------------

describe("TableauDns", () => {
  test("chaque enregistrement est une ligne de tableau, pas un paragraphe", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[DIFFERENT, MANQUANT]} />
    )
    expect(html).toContain("<table")
    expect((html.match(/data-testid="verdict-/g) ?? []).length).toBe(2)
    expect(html).toContain('data-testid="verdict-spf"')
    expect(html).toContain('data-testid="verdict-dmarc"')
  })

  test("la valeur à poser est visible sans déplier", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[MANQUANT]} />
    )
    expect(auRepos(html)).toContain("v=DMARC1; p=none;")
  })

  // La régression que cet écran vient de corriger : huit TXT concaténés
  // dans le flux. Ils restent atteignables, mais repliés.
  test("les valeurs trouvées ne sont pas dans le flux, seulement dans le repli", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[DIFFERENT]} />
    )
    expect(auRepos(html)).not.toContain("brevo-code:b18a7cb6")
    expect(texte(html)).toContain("brevo-code:b18a7cb6")
  })

  test("l'instruction du serveur n'est pas dans le flux non plus", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[MANQUANT]} />
    )
    expect(auRepos(html)).not.toContain("Créez un enregistrement")
    // Elle n'est pas recomposée ici : celle du serveur, mot pour mot.
    expect(texte(html)).toContain(MANQUANT.instruction)
  })

  test("le libellé perd sa glose ; elle passe en infobulle", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[DIFFERENT]} />
    )
    expect(auRepos(html)).toContain("SPF")
    expect(auRepos(html)).not.toContain("qui a le droit d'envoyer en votre nom")
    expect(html).toContain('title="qui a le droit d&#x27;envoyer en votre nom"')
  })
})

// ---------------------------------------------------------------------
// Les signes — trois, pas deux
// ---------------------------------------------------------------------

describe("le signe d'une ligne", () => {
  function signe(verdict: Verdict): string {
    const html = renderToStaticMarkup(
      <TableauDns titre="x" verdicts={[verdict]} />
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
    const s = signe({ ...MANQUANT, etat: "indisponible" })
    expect(s).toBe("inconnu")
    expect(s).not.toBe(signe(MANQUANT))
  })

  test("« indisponible » ne dit de créer quoi que ce soit nulle part", () => {
    const html = renderToStaticMarkup(
      <TableauDns
        titre="x"
        verdicts={[
          {
            ...MANQUANT,
            etat: "indisponible",
            instruction:
              "Le résolveur DNS n'a pas répondu — réessayez dans un instant, ne créez rien pour l'instant.",
          },
        ]}
      />
    )
    expect(auRepos(html)).not.toMatch(/Créez/)
    expect(texte(html)).toMatch(/réessay/i)
  })

  test("le mot de l'état reste lisible pour un lecteur d'écran", () => {
    const html = renderToStaticMarkup(<TableauDns titre="x" verdicts={[OK]} />)
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
      <TableauDns titre="x" verdicts={[MANQUANT]} />
    )
    const sans = renderToStaticMarkup(<TableauDns titre="x" verdicts={[OK]} />)
    expect(avec).toContain("Copier")
    expect(sans).not.toContain("Copier")
  })
})

describe("nomEtGlose", () => {
  test("coupe sur le tiret cadratin", () => {
    expect(nomEtGlose("SPF — qui a le droit d'envoyer en votre nom")).toEqual([
      "SPF",
      "qui a le droit d'envoyer en votre nom",
    ])
  })

  test("un libellé sans glose ressort entier", () => {
    expect(nomEtGlose("Le site public")).toEqual(["Le site public", null])
  })
})

// ---------------------------------------------------------------------
// Les deux lignes d'état
// ---------------------------------------------------------------------

describe("lignesEtat", () => {
  test("tout aligné : deux lignes vertes, une valeur chacune", () => {
    const lignes = lignesEtat(
      "exemple.fr",
      "https://admin.exemple.fr",
      "https://exemple.fr"
    )
    expect(lignes.every((l) => l.ok)).toBe(true)
    expect(lignes.map((l) => l.valeurs.length)).toEqual([1, 1])
  })

  // Les liens des emails partent de `SITE_URL` ; si son hôte n'est pas le
  // domaine déclaré, ils ne mènent nulle part.
  test("une origine d'emails étrangère au domaine passe au rouge, avec les deux valeurs", () => {
    const [liens] = lignesEtat(
      "exemple.fr",
      "http://localhost:3001",
      "https://exemple.fr"
    )
    expect(liens?.ok).toBe(false)
    expect(liens?.valeurs).toEqual(["localhost", "exemple.fr"])
  })

  // `admin.exemple.fr` est un SOUS-domaine d'`exemple.fr` : la convention
  // du dépôt, pas une divergence.
  test("un sous-domaine d'admin n'est pas une divergence", () => {
    const [liens] = lignesEtat(
      "exemple.fr",
      "https://admin.exemple.fr",
      "https://exemple.fr"
    )
    expect(liens?.ok).toBe(true)
  })

  // L'image du site fige `WEB_DOMAIN` au build : divergente, les deux
  // limiteurs de débit comptent tout Internet comme un seul visiteur.
  test("une image construite pour un autre domaine passe au rouge", () => {
    const build = lignesEtat(
      "exemple.fr",
      "https://admin.exemple.fr",
      "http://localhost:4321"
    )[1]
    expect(build?.ok).toBe(false)
    expect(build?.valeurs).toEqual(["localhost", "exemple.fr"])
  })

  test("sans origine du site, la ligne du build n'est pas inventée", () => {
    const lignes = lignesEtat("exemple.fr", "https://admin.exemple.fr", null)
    expect(lignes.map((l) => l.cle)).toEqual(["liens"])
  })

  test("sans domaine déclaré, rien n'est affirmé divergent", () => {
    const lignes = lignesEtat(null, "https://admin.exemple.fr", "https://exemple.fr")
    expect(lignes.every((l) => l.ok)).toBe(true)
  })

  test("une origine absente est nommée, pas laissée vide", () => {
    const [liens] = lignesEtat("exemple.fr", null, null)
    expect(liens?.valeurs).toContain("non réglée")
  })
})

describe("TableauEtats", () => {
  test("une étiquette, les valeurs, un signe — et pas une phrase", () => {
    const html = renderToStaticMarkup(
      <TableauEtats
        lignes={lignesEtat(
          "exemple.fr",
          "http://localhost:3001",
          "http://localhost:4321"
        )}
      />
    )
    expect(html).toContain('data-testid="etat-liens"')
    expect(html).toContain('data-testid="etat-build"')
    expect(html).toContain('data-signe="ko"')
    // Les deux paragraphes retirés, mot pour mot : ils ne reviennent pas.
    expect(texte(html)).not.toMatch(/ne mènent nulle part/)
    expect(texte(html)).not.toMatch(/limiteurs de débit/)
    expect(texte(html)).not.toMatch(/cinq messages de contact/)
  })
})

// ---------------------------------------------------------------------
// Ce que l'écran ne doit plus porter
// ---------------------------------------------------------------------

describe("la prose ne revient pas", () => {
  test("aucune ligne du tableau ne porte de phrase hors du repli", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[OK, MANQUANT, DIFFERENT]} />
    )
    const visible = auRepos(html)
    for (const phrase of [
      "Rien à faire",
      "il est en place",
      "porte déjà un enregistrement",
      "Remplacez sa valeur",
      "Trouvé",
    ]) {
      expect(visible).not.toContain(phrase)
    }
  })

  test("trois lignes tiennent en moins de trente mots au repos", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" verdicts={[OK, MANQUANT, DIFFERENT]} />
    )
    const mots = auRepos(html)
      .split(" ")
      .filter((m) => /[\p{L}\p{N}]/u.test(m))
    expect(mots.length).toBeLessThan(30)
  })
})
