import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Enregistrement, Verdict } from "@astrotan/backend/convex/dns"
import type { ResultatResend } from "@astrotan/backend/convex/resendDomain"
import {
  EtatVerification,
  Etiquette,
  TableauDns,
  TTL_DNS_RECOMMANDE,
  estCopiable,
  fusionnerResend,
  fusionnerVerdicts,
  valeurAffichee,
} from "./domain-check"
import type { ActionsDomaine, Lecture } from "@/routes/_authed/settings/domaine"
import {
  TableauxDns,
  domaineEnregistrable,
  etatDesA,
  etiquetteResend,
  lectureDe,
  lireLeDomaine,
} from "@/routes/_authed/settings/domaine"

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

/**
 * Le texte réellement lisible : balises retirées, entités rendues.
 *
 * `<wbr>` part À VIDE et non remplacé par une espace : c'est un point de
 * coupure sans largeur — il n'ajoute rien à l'œil, ni au copier-coller
 * (voir `NomDns`). Le remplacer par une espace ferait croire à ces tests
 * qu'un nom DNS s'écrit `resend. _domainkey. exemple.fr`.
 */
function texte(html: string): string {
  return html
    .replace(/<wbr\s*\/?>/g, "")
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

  test("un A déjà lu affiche l'attendu, le lookup public va en info s'il diffère", () => {
    const plan = { ...PLAN_SITE, attendu: "203.0.113.7" }
    const html = renderToStaticMarkup(
      <TableauDns
        titre="Le site"
        lignes={fusionnerVerdicts([plan], [{ ...OK, attendu: "203.0.113.7" }])}
        local={false}
      />,
    )
    expect(auRepos(html)).toContain("203.0.113.7")
    expect(auRepos(html)).not.toContain("l'adresse IPv4 publique de votre serveur")
  })

  test("la colonne TTL porte la valeur documentée du template", () => {
    expect(TTL_DNS_RECOMMANDE).toBe(300)
    const html = renderToStaticMarkup(
      <TableauDns titre="Le site" lignes={fusionnerVerdicts([PLAN_SITE], null)} />
    )
    expect(html).toContain(">TTL<")
    expect(auRepos(html)).toContain("300")
  })

  test("le lookup ne rajoute plus un « Trouvé » sous la valeur", () => {
    const html = renderToStaticMarkup(
      <TableauDns titre="Les emails" lignes={fusionnerVerdicts([PLAN_SPF], [DIFFERENT])} />
    )
    expect(auRepos(html)).not.toContain("Trouvé")
    expect(texte(html)).not.toContain("Trouvé")
    expect(texte(html)).not.toContain("brevo-code:b18a7cb6")
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

describe("le verdict d'une ligne", () => {
  function rendu(verdict: Verdict | Enregistrement, arrive: Verdict | null) {
    const plan = "etat" in verdict ? [verdict] : [verdict]
    const html = renderToStaticMarkup(
      <TableauDns
        titre="x"
        lignes={fusionnerVerdicts(plan, arrive === null ? null : [arrive])}
      />
    )
    return html
  }

  test("lookup qui matche → Connecté, et ça reste", () => {
    const html = rendu(OK, OK)
    expect(html).toContain('data-connexion="connecte"')
    expect(html).toContain('data-signe="ok"')
    expect(html).toContain("lucide-circle-check")
    expect(auRepos(html)).toContain("Connecté")
    expect(auRepos(html)).not.toContain("Non connecté")
    expect(auRepos(html)).not.toContain("À poser")
    expect(auRepos(html)).not.toContain("En place")
  })

  test("mismatch, absence, lookup raté, pas encore lu → Non connecté", () => {
    expect(rendu(MANQUANT, MANQUANT)).toContain('data-connexion="non_connecte"')
    expect(rendu(DIFFERENT, DIFFERENT)).toContain('data-connexion="non_connecte"')
    expect(rendu(INDISPONIBLE, INDISPONIBLE)).toContain('data-connexion="non_connecte"')
    expect(rendu(PLAN_DMARC, null)).toContain('data-connexion="non_connecte"')
    expect(auRepos(rendu(MANQUANT, MANQUANT))).toContain("Non connecté")
  })

  test("après le check, V vert ou croix rouge — pas le mot seul", () => {
    expect(rendu(OK, OK)).toContain('data-signe="ok"')
    expect(rendu(OK, OK)).toContain("lucide-circle-check")
    expect(rendu(MANQUANT, MANQUANT)).toContain('data-signe="ko"')
    expect(rendu(MANQUANT, MANQUANT)).toContain("lucide-circle-x")
    expect(rendu(DIFFERENT, DIFFERENT)).toContain('data-signe="ko"')
  })

  test("après le lookup, le verdict change — il n'est pas figé", () => {
    const avant = rendu(PLAN_SITE, null)
    expect(avant).toContain('data-etat="attente"')
    expect(avant).toContain('data-connexion="non_connecte"')
    const apresOk = rendu(PLAN_SITE, OK)
    expect(apresOk).toContain('data-etat="ok"')
    expect(apresOk).toContain('data-connexion="connecte"')
    const apresKo = rendu(PLAN_SITE, { ...PLAN_SITE, trouve: [], etat: "manquant" })
    expect(apresKo).toContain('data-etat="manquant"')
    expect(apresKo).toContain('data-connexion="non_connecte"')
  })

  test("data-etat sépare encore manquant et indisponible", () => {
    expect(rendu(MANQUANT, MANQUANT)).toContain('data-etat="manquant"')
    expect(rendu(INDISPONIBLE, INDISPONIBLE)).toContain('data-etat="indisponible"')
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

  test("l'icône de copie est à côté de la valeur, pas un bouton « Copier »", () => {
    const avec = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_DMARC], null)} />
    )
    const sans = renderToStaticMarkup(
      <TableauDns titre="x" lignes={fusionnerVerdicts([PLAN_SITE], null)} />
    )
    expect(avec).toContain('aria-label="Copier la valeur"')
    expect(auRepos(avec)).not.toContain("Copier")
    expect(sans).not.toContain('aria-label="Copier la valeur"')
    // Collée au texte : pas de `grow` qui pousserait l'icône au bout
    // de la cellule, loin de la valeur.
    expect(avec).not.toMatch(/grow basis-32/)
  })

  test("une IPv4 et un hôte local se copient", () => {
    expect(estCopiable("203.0.113.7")).toBe(true)
    expect(estCopiable("localhost:4321")).toBe(true)
    expect(estCopiable("localhost:3001")).toBe(true)
  })
})

describe("valeurAffichee", () => {
  test("en prod, la valeur est l'attendu — pas le lookup recyclé en vérité", () => {
    const [ligne] = fusionnerVerdicts(
      [{ ...PLAN_SITE, attendu: "203.0.113.7" }],
      [{ ...OK, attendu: "203.0.113.7" }],
    )
    expect(valeurAffichee(ligne!, { local: false })).toBe("203.0.113.7")
    expect(valeurAffichee(ligne!, { local: false })).not.toMatch(/adresse IPv4/i)
  })

  test("sans lookup, c'est l'attendu — localhost en local, pas une phrase", () => {
    const local = { ...PLAN_SITE, attendu: "localhost:4321" }
    const [ligne] = fusionnerVerdicts([local], null)
    expect(valeurAffichee(ligne!, { local: true })).toBe("localhost:4321")
  })

  test("DEV + lookup 198.x n'affiche pas cette IP et pas Connecté", () => {
    const plan = { ...PLAN_SITE, attendu: "localhost:4321" }
    const verdict: Verdict = {
      ...plan,
      trouve: ["198.202.211.1"],
      etat: "ok",
    }
    const [ligne] = fusionnerVerdicts([plan], [verdict])
    expect(valeurAffichee(ligne!, { local: true })).toBe("localhost:4321")
    expect(valeurAffichee(ligne!, { local: true })).not.toContain("198.202.211.1")

    const html = renderToStaticMarkup(
      <TableauDns titre="Le site" lignes={fusionnerVerdicts([plan], [verdict])} local />,
    )
    expect(auRepos(html)).toContain("localhost:4321")
    expect(auRepos(html)).not.toContain("DNS public")
    expect(auRepos(html)).not.toContain("198.202.211.1")
    expect(html).toContain('data-connexion="non_connecte"')
    expect(html).not.toContain('data-signe="ok"')
    expect(auRepos(html)).toMatch(/\bLocal\b/)
    expect(auRepos(html)).not.toMatch(/(?<!Non )Connecté/)
  })

  test("en prod, le lookup différent de l'attendu n'écrit pas « DNS public : »", () => {
    const plan = { ...PLAN_SITE, attendu: "203.0.113.7" }
    const verdict: Verdict = {
      ...plan,
      trouve: ["104.21.5.9"],
      etat: "different",
    }
    const html = renderToStaticMarkup(
      <TableauDns
        titre="Le site"
        lignes={fusionnerVerdicts([plan], [verdict])}
        local={false}
      />,
    )
    expect(auRepos(html)).toContain("203.0.113.7")
    expect(auRepos(html)).not.toContain("DNS public")
    expect(auRepos(html)).not.toContain("104.21.5.9")
  })

  test("prod + attendu 198.x + lookup 198.x → Connecté", () => {
    const plan = { ...PLAN_SITE, attendu: "198.202.211.1" }
    const verdict: Verdict = {
      ...plan,
      trouve: ["198.202.211.1"],
      etat: "ok",
    }
    const [ligne] = fusionnerVerdicts([plan], [verdict])
    expect(valeurAffichee(ligne!, { local: false })).toBe("198.202.211.1")

    const html = renderToStaticMarkup(
      <TableauDns
        titre="Le site"
        lignes={fusionnerVerdicts([plan], [verdict])}
        local={false}
      />,
    )
    expect(html).toContain('data-connexion="connecte"')
    expect(html).toContain('data-signe="ok"')
    expect(auRepos(html)).toContain("Connecté")
    expect(auRepos(html)).not.toContain("DNS public")
  })

  test("un TXT garde sa valeur de plan", () => {
    const [ligne] = fusionnerVerdicts([PLAN_DMARC], [MANQUANT])
    expect(valeurAffichee(ligne!)).toBe("v=DMARC1; p=none;")
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
  test("les enregistrements du site sont visibles avant toute vérification", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DMARC, PLAN_SPF] }}
        resultat={null}
      />
    )
    expect(html).toContain('data-testid="verdict-site"')
    // Sans lecture Resend, le tableau emails ne s'affiche pas : en local
    // la clé est absente, et coller SPF/DKIM n'y change rien.
    expect(html).not.toContain('data-testid="verdict-dmarc"')
    expect(html).not.toContain("Les emails")
    expect(html).toContain('data-etat="attente"')
    expect(html).not.toContain('data-etat="manquant"')
  })

  test("un verdict arrivé remplace « attente » par le vrai état, ligne par ligne", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DMARC] }}
        resultat={{ site: [OK], email: [MANQUANT] }}
        // `absent` : clé présente, domaine pas encore déclaré — le tableau
        // emails s'affiche, sans les lignes extra de Resend qui resteraient
        // en « attente » (checkEmail ne les lit pas).
        resend={{ etat: "absent" }}
      />
    )
    expect(html).toContain('data-etat="ok"')
    expect(html).toContain('data-etat="manquant"')
    expect(html).not.toContain('data-etat="attente"')
  })

  test("clé Resend absente : le tableau emails n'existe pas", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DMARC, PLAN_SPF] }}
        resultat={null}
        resend={{ etat: "sans_cle" }}
      />
    )
    expect(html).toContain('data-testid="verdict-site"')
    expect(html).not.toContain("Les emails")
    expect(html).not.toContain('data-testid="verdict-dmarc"')
    expect(html).not.toContain('data-testid="verdict-spf"')
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
    expect(mots.length).toBeLessThan(40)
  })
})

// ---------------------------------------------------------------------
// L'ORDRE D'OPÉRATIONS : le DNS d'abord, l'enregistrement ensuite.
//
// Enregistrer un domaine dont les A ne pointent pas encore ici fait
// échouer l'émission du certificat, et chaque échec compte dans le quota
// Let's Encrypt — 5 par jeu d'identifiants tous les 7 jours, sans remise à
// zéro possible. Le verrou est ce qui empêche d'y entrer.
//
// CE QUE CES TESTS DISCRIMINENT, vérifié en retirant la garde :
//   - `domaineEnregistrable` qui rend `true` sans regarder → 6 échecs.
//   - le filtre `type === "A"` retiré → l'admin non pointé n'arme plus
//     rien, mais un domaine sans A du tout passerait : 1 échec.
//   - la comparaison `lecture.hote === cible` retirée → 2 échecs.
// ---------------------------------------------------------------------

const PLAN_ADMIN: Enregistrement = {
  cle: "admin",
  libelle: "Le tableau de bord",
  type: "A",
  nom: "admin.exemple.fr",
  attendu: "l'adresse IPv4 publique de votre serveur",
}

const A_SITE_OK: Verdict = { ...PLAN_SITE, trouve: ["203.0.113.7"], etat: "ok" }
const A_ADMIN_OK: Verdict = { ...PLAN_ADMIN, trouve: ["203.0.113.7"], etat: "ok" }
const A_ADMIN_MANQUANT: Verdict = { ...PLAN_ADMIN, trouve: [], etat: "manquant" }
const A_SITE_MUET: Verdict = { ...PLAN_SITE, trouve: [], etat: "indisponible" }

/**
 * Le cas de quota le plus fréquent : un A qui EXISTE, qui est une IPv4
 * publique parfaitement valide, et qui mène ailleurs — un proxy
 * Cloudflare, l'ancien hébergeur, une page de parking du registrar.
 *
 * `convex/dns.ts` le rend `different` depuis qu'il compare à l'adresse de
 * l'hôte web courant au lieu de vérifier une forme. Ce qui se joue ici est
 * l'autre bout : que `different` ferme le verrou aussi sûrement que
 * `manquant`. Les deux appellent le même geste — aller chez l'hébergeur —
 * et aucun des deux n'est un certificat qu'on peut demander.
 */
const A_SITE_AILLEURS: Verdict = { ...PLAN_SITE, trouve: ["104.21.5.9"], etat: "different" }

/**
 * LE MÊME A, SUR UN DÉPLOIEMENT QUI N'A PERSONNE À QUI LE COMPARER.
 *
 * Adresse identique à `A_SITE_AILLEURS` — un proxy Cloudflare — et
 * pourtant `forme` et non `different` : `convex/dns.ts` n'a pas d'hôte
 * courant (`ReferenceServeur.aucune`), donc il ne sait rien de plus que
 * « c'est une IPv4 publique ». C'est le point de rencontre des deux
 * correctifs : avant le routage de secours, cet état était inatteignable ;
 * depuis, l'écran s'ouvre dessus, et le verrou y est dégradé au contrôle
 * de forme.
 */
const A_SITE_FORME: Verdict = { ...PLAN_SITE, trouve: ["104.21.5.9"], etat: "forme" }
const A_ADMIN_FORME: Verdict = { ...PLAN_ADMIN, trouve: ["104.21.5.9"], etat: "forme" }

/** Une lecture faite sur `exemple.fr`, sauf mention contraire. */
function lue(
  site: Verdict[],
  {
    hote = "exemple.fr",
    resend = { etat: "sans_cle" },
  }: { hote?: string; resend?: ResultatResend } = {}
): Lecture {
  return { hote, site, email: [], resend }
}

describe("le verrou du bouton d'enregistrement", () => {
  test("inerte tant qu'une ligne A n'est pas verte", () => {
    const lecture = lue([A_SITE_OK, A_ADMIN_MANQUANT])
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(false)
  })

  test("armé quand les lignes A le sont", () => {
    const lecture = lue([A_SITE_OK, A_ADMIN_OK])
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(true)
  })

  // Le cas qui rend le verrou nécessaire plutôt que décoratif : avant tout
  // clic, on ne sait rien, et « on ne sait rien » n'est pas « c'est bon ».
  test("aucune lecture : inerte", () => {
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", null)).toBe(false)
  })

  test("un A qui pointe ailleurs qu'ici n'arme rien", () => {
    const lecture = lue([A_SITE_AILLEURS, A_ADMIN_OK])
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(false)
    expect(etatDesA("exemple.fr", "exemple.fr", lecture)).toEqual({
      signe: "ko",
      texte: "Non connecté",
    })
  })

  // Le résolveur muet ne dit pas que l'enregistrement manque — mais il ne
  // dit pas non plus qu'il est là, et c'est ce dernier point qui décide.
  test("un résolveur muet n'arme rien", () => {
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lue([A_SITE_MUET, A_ADMIN_OK]))).toBe(
      false
    )
  })

  // Le verrou porte sur LES LIGNES A, pas sur tout le groupe « Le site ».
  // `controlesSite` n'en rend que deux aujourd'hui, toutes deux A. Le jour
  // où il y ajoute autre chose — un AAAA pour l'IPv6, un CAA —, exiger que
  // cette ligne-là soit verte bloquerait un serveur IPv4 qui fonctionne, et
  // le certificat qu'on protège ici ne dépend pas d'elle.
  test("une ligne du groupe « Le site » qui n'est pas un A ne décide pas", () => {
    const aaaa: Verdict = {
      cle: "site-v6",
      libelle: "Le site public en IPv6",
      type: "AAAA",
      nom: "exemple.fr",
      attendu: "l'adresse IPv6 publique de votre serveur",
      trouve: [],
      etat: "manquant",
    }
    const lecture = lue([A_SITE_OK, A_ADMIN_OK, aaaa])
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(true)
  })

  test("une saisie qui n'est pas encore un hôte n'arme rien", () => {
    expect(domaineEnregistrable("exemple.f", null, null)).toBe(false)
  })

  // Effacer le domaine déclaré ne fait demander aucun certificat : le
  // verrou n'a rien à y dire, et l'y appliquer enfermerait un adoptant
  // dans un domaine mal pointé qu'il ne pourrait même plus retirer.
  test("effacer le domaine reste possible", () => {
    expect(domaineEnregistrable("", null, null)).toBe(true)
    expect(domaineEnregistrable("   ", null, null)).toBe(true)
  })
})

describe("une lecture ne vaut que pour l'hôte qu'elle a interrogé", () => {
  test("lectureDe refuse la lecture d'un autre domaine", () => {
    expect(lectureDe("nouveau.fr", lue([A_SITE_OK, A_ADMIN_OK]))).toBeNull()
    expect(lectureDe("exemple.fr", lue([A_SITE_OK, A_ADMIN_OK]))).not.toBeNull()
  })

  // Sans ce filtre, changer le domaine dans le champ après une
  // vérification laisserait les coches vertes d'`exemple.fr` armer
  // l'enregistrement de `nouveau.fr` — le certificat exact qu'on essaie de
  // ne pas faire échouer.
  test("les verdicts d'un autre domaine n'arment pas le bouton", () => {
    const perimee = lectureDe("nouveau.fr", lue([A_SITE_OK, A_ADMIN_OK]))
    expect(domaineEnregistrable("nouveau.fr", "nouveau.fr", perimee)).toBe(false)
  })
})

describe("l'état affiché à côté du bouton", () => {
  test("le champ vide n'a pas d'état", () => {
    expect(etatDesA("", null, null)).toBeNull()
  })

  test("en local, un lookup 198.x se dit Local, pas Connecté", () => {
    const lecture = lue([
      { ...A_SITE_OK, trouve: ["198.202.211.1"] },
      { ...A_ADMIN_OK, trouve: ["198.202.211.1"] },
    ])
    expect(etatDesA("illith.com", "illith.com", lecture, { local: true })).toEqual({
      signe: "inconnu",
      texte: "Local",
    })
    expect(domaineEnregistrable("illith.com", "illith.com", lecture, { local: true })).toBe(
      true,
    )
  })

  test("chaque situation a son état, et il tient en trois mots", () => {
    expect(etatDesA("exemple.f", null, null)).toEqual({
      signe: "inconnu",
      texte: "Domaine incomplet",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", null)).toEqual({
      signe: "inconnu",
      texte: "Non connecté",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_MANQUANT]))).toEqual({
      signe: "ko",
      texte: "Non connecté",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_OK]))).toEqual({
      signe: "ok",
      texte: "Connecté",
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // DEUX FAÇONS D'ÊTRE VERT, ET UNE SEULE EST UNE COMPARAISON.
  //
  // Le résidu que ces trois tests ferment : `jugerA` rendait `ok` quand il
  // n'existait aucun serveur de référence, si bien qu'un « A en place »
  // vert pouvait vouloir dire « il mène ici » OU « il a la bonne forme,
  // personne n'a vérifié où il mène ». Indiscernables à l'écran, alors que
  // le second est exactement la configuration qui brûle le quota Let's
  // Encrypt.
  //
  // CE QU'ILS DISCRIMINENT, vérifié en mutant `etatDesA` :
  //   - la branche `forme` qui rend « A en place » → 1 échec.
  //   - `forme` laissé dans le fourre-tout « A non lu » (`etat !== "ok"`
  //     seul) → 1 échec.
  //   - la branche `forme` placée AVANT ce fourre-tout → 1 échec (le cas
  //     mixte : un A non lu à côté d'un A plausible n'arme rien).
  // ─────────────────────────────────────────────────────────────────

  test("un A sans IP connue n'est pas Connecté et n'arme rien", () => {
    const compare = etatDesA("exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_OK]))
    const sansReference = etatDesA(
      "exemple.fr",
      "exemple.fr",
      lue([A_SITE_FORME, A_ADMIN_FORME])
    )
    expect(compare).toEqual({ signe: "ok", texte: "Connecté" })
    expect(sansReference).toEqual({ signe: "inconnu", texte: "Non connecté" })
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lue([A_SITE_FORME, A_ADMIN_FORME]))).toBe(
      false,
    )
  })

  test("un A plausible à côté d'un A non lu n'arme rien", () => {
    const lecture = lue([A_SITE_FORME, { ...A_ADMIN_FORME, etat: "indisponible" }])
    expect(etatDesA("exemple.fr", "exemple.fr", lecture)).toEqual({
      signe: "inconnu",
      texte: "Non connecté",
    })
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(false)
  })

  test("un A plausible à côté d'un A manquant reste Non connecté", () => {
    const lecture = lue([A_SITE_FORME, A_ADMIN_MANQUANT])
    expect(etatDesA("exemple.fr", "exemple.fr", lecture)).toEqual({
      signe: "ko",
      texte: "Non connecté",
    })
    expect(domaineEnregistrable("exemple.fr", "exemple.fr", lecture)).toBe(false)
  })

  // Une croix rouge à côté d'un bouton armé, ou l'inverse, est la seule
  // façon dont ces deux-là peuvent mentir. Ils sont dérivés l'un de
  // l'autre pour que ce soit impossible ; ce test le tient.
  test("l'état et le verrou ne divergent jamais", () => {
    const cas: Array<[string, string | null, Lecture | null]> = [
      ["exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_OK])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_MANQUANT])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_MUET, A_ADMIN_OK])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_FORME, A_ADMIN_FORME])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_FORME, A_ADMIN_MANQUANT])],
      ["exemple.fr", "exemple.fr", null],
      ["exemple.f", null, null],
    ]
    for (const [saisie, cible, lecture] of cas) {
      expect(domaineEnregistrable(saisie, cible, lecture)).toBe(
        etatDesA(saisie, cible, lecture)?.signe === "ok"
      )
    }
  })

  test("l'étiquette écrit le mot et ne le fait pas annoncer deux fois", () => {
    const html = renderToStaticMarkup(<Etiquette signe="ko" texte="Non connecté" />)
    expect(texte(html)).toContain("Non connecté")
    expect(html).toContain('data-signe="ko"')
    expect(html).not.toContain("aria-label")
  })

  test("après Vérifier, Connecté porte CircleCheck — pas le mot seul", () => {
    const html = renderToStaticMarkup(
      <EtatVerification signe="ok" texte="Connecté" />,
    )
    expect(texte(html)).toContain("Connecté")
    expect(html).toContain("lucide-circle-check")
    expect(html).not.toContain("lucide-circle-x")
  })

  test("après Vérifier, Non connecté porte CircleX — pas le mot seul", () => {
    const html = renderToStaticMarkup(
      <EtatVerification signe="ko" texte="Non connecté" />,
    )
    expect(texte(html)).toContain("Non connecté")
    expect(html).toContain("lucide-circle-x")
    expect(html).not.toContain("lucide-circle-check")
  })

  test("Local garde CircleHelp et le mot", () => {
    const html = renderToStaticMarkup(
      <EtatVerification signe="inconnu" texte="Local" />,
    )
    expect(texte(html)).toContain("Local")
    expect(html).toContain("lucide-circle-question-mark")
  })
})

// ---------------------------------------------------------------------
// Le domaine d'expédition chez Resend — six issues, six états.
// ---------------------------------------------------------------------

const RESEND_MX: Enregistrement = {
  cle: "resend-send.exemple.fr-mx",
  libelle: "MX — la réception des messages",
  type: "MX",
  nom: "send.exemple.fr",
  attendu: "feedback-smtp.eu-west-1.amazonses.com (priorité 10)",
}

const RESEND_SPF: Enregistrement = {
  cle: "resend-send.exemple.fr-txt",
  libelle: "SPF — qui a le droit d'envoyer en votre nom (fourni par Resend)",
  type: "TXT",
  nom: "send.exemple.fr",
  attendu: "v=spf1 include:amazonses.com ~all",
}

const RESEND_DKIM: Enregistrement = {
  cle: "resend-resend._domainkey.exemple.fr-txt",
  libelle: "DKIM — la signature de vos messages (fournie par Resend)",
  type: "TXT",
  nom: "resend._domainkey.exemple.fr",
  attendu: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDb",
}

const PLAN_DKIM: Enregistrement = {
  cle: "dkim",
  libelle: "DKIM — la signature de vos messages",
  type: "TXT",
  nom: "resend._domainkey.exemple.fr",
  attendu: "la clé publique fournie par Resend (elle commence par « p= »)",
}

const RESEND_OK: ResultatResend = {
  etat: "ok",
  dejaDeclare: true,
  statut: "pending",
  enregistrements: [RESEND_MX, RESEND_SPF, RESEND_DKIM],
  ignores: 0,
}

describe("l'état de Resend", () => {
  // LE refus à ne pas confondre. Une clé « Sending access » s'authentifie
  // et envoie les emails ; `secretCheck` l'accepte à raison. La ranger
  // sous « clé invalide » enverrait l'adoptant régénérer une clé en
  // service.
  test("une clé limitée à l'envoi n'est pas une clé absente ni une clé refusée", () => {
    const restreinte = etiquetteResend({ etat: "cle_restreinte" })
    expect(restreinte.texte).toBe("Resend · clé limitée à l'envoi")
    expect(restreinte.texte).not.toBe(etiquetteResend({ etat: "sans_cle" }).texte)
    expect(restreinte.texte).not.toBe(etiquetteResend({ etat: "refuse" }).texte)
  })

  // Un domaine déclaré sur un autre compte ne se répare pas chez
  // l'hébergeur : aucun enregistrement créé n'y changera rien.
  test("introuvable a son propre état, distinct de refusé", () => {
    expect(etiquetteResend({ etat: "introuvable" }).texte).toBe(
      "Resend · domaine sur un autre compte"
    )
    expect(etiquetteResend({ etat: "introuvable" }).texte).not.toBe(
      etiquetteResend({ etat: "refuse" }).texte
    )
  })

  test("les six issues rendent six états distincts", () => {
    const issues: ResultatResend[] = [
      RESEND_OK,
      { etat: "sans_cle" },
      { etat: "cle_restreinte" },
      { etat: "refuse" },
      { etat: "introuvable" },
      { etat: "injoignable" },
    ]
    const textes = issues.map((issue) => etiquetteResend(issue).texte)
    expect(new Set(textes).size).toBe(6)
    // Aucun n'est un paragraphe : six mots au plus, séparateur exclu.
    for (const t of textes) {
      expect(t.replace("·", " ").split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(6)
    }
  })

  // « Resend n'a pas répondu » n'est pas « Resend a dit non » : la même
  // partition que `dns.ts` tient entre `indisponible` et `manquant`.
  test("une panne de service ne met pas la clé en cause", () => {
    expect(etiquetteResend({ etat: "injoignable" }).signe).toBe("inconnu")
    expect(etiquetteResend({ etat: "cle_restreinte" }).signe).toBe("ko")
  })

  test("le statut de vérification est un état, pas un mot d'API", () => {
    expect(etiquetteResend({ ...RESEND_OK, statut: "verified" })).toEqual({
      signe: "ok",
      texte: "Resend · vérifié",
    })
    expect(etiquetteResend({ ...RESEND_OK, statut: "pending" }).texte).toBe(
      "Resend · en attente"
    )
    expect(etiquetteResend({ ...RESEND_OK, statut: "failure" }).signe).toBe("ko")
  })

  // Le jour où l'API rend un type que `Enregistrement` ne porte pas, la
  // ligne manque au tableau. Le compte est ce qui empêche cette absence
  // d'être silencieuse.
  test("les lignes que Resend a rendues sans qu'on sache les lire se comptent", () => {
    expect(etiquetteResend({ ...RESEND_OK, ignores: 0 }).texte).not.toContain("illisible")
    expect(etiquetteResend({ ...RESEND_OK, ignores: 1 }).texte).toContain("1 ligne illisible")
    expect(etiquetteResend({ ...RESEND_OK, ignores: 2 }).texte).toContain("2 lignes illisibles")
  })
})

describe("les enregistrements de Resend rejoignent le tableau", () => {
  test("la vraie clé DKIM remplace la description, sur la même ligne", () => {
    const lignes = fusionnerResend([PLAN_SPF, PLAN_DKIM, PLAN_DMARC], [RESEND_DKIM])
    const dkim = lignes.find((ligne) => ligne.cle === "dkim")
    expect(dkim?.attendu).toBe(RESEND_DKIM.attendu)
    // Une ligne, pas deux : le même enregistrement de zone.
    expect(lignes.filter((ligne) => ligne.nom === PLAN_DKIM.nom)).toHaveLength(1)
    expect(lignes).toHaveLength(3)
  })

  // La clé du plan est conservée exprès : `fusionnerVerdicts` recolle les
  // verdicts PAR clé, et prendre celle de Resend ferait perdre son état à
  // cette ligne pour toujours.
  test("la ligne fusionnée retrouve son verdict", () => {
    const fusionnees = fusionnerResend([PLAN_DKIM], [RESEND_DKIM])
    const verdict: Verdict = { ...PLAN_DKIM, trouve: ["p=MIGf"], etat: "ok" }
    const lignes = fusionnerVerdicts(fusionnees, [verdict])
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.etat).toBe("ok")
    expect(lignes[0]?.attendu).toBe(RESEND_DKIM.attendu)
  })

  test("les lignes que le plan ne connaît pas s'ajoutent à la suite", () => {
    const lignes = fusionnerResend([PLAN_SPF, PLAN_DKIM], [RESEND_MX, RESEND_SPF, RESEND_DKIM])
    expect(lignes.map((ligne) => ligne.cle)).toEqual([
      "spf",
      "dkim",
      RESEND_MX.cle,
      RESEND_SPF.cle,
    ])
  })

  // Le SPF de Resend vit sur `send.<domaine>`, celui du plan sur l'apex :
  // deux noms, donc deux enregistrements, donc deux lignes.
  test("un même type sur deux noms reste deux lignes", () => {
    const lignes = fusionnerResend([PLAN_SPF], [RESEND_SPF])
    expect(lignes).toHaveLength(2)
  })

  test("elles prennent des lignes du tableau des emails, pas un second tableau", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_SPF, PLAN_DKIM, PLAN_DMARC] }}
        resultat={null}
        resend={RESEND_OK}
      />
    )
    expect((html.match(/<table/g) ?? []).length).toBe(2)
    expect(html).toContain(`data-testid="verdict-${RESEND_MX.cle}"`)
    expect(auRepos(html)).toContain("send.exemple.fr")
    expect(auRepos(html)).toContain("feedback-smtp.eu-west-1.amazonses.com (priorité 10)")
    // Et l'état de Resend est là, en étiquette.
    expect(auRepos(html)).toContain("Resend · en attente")
  })

  test("sans réponse de Resend, le tableau emails n'apparaît pas", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DKIM] }}
        resultat={null}
        resend={null}
      />
    )
    expect(auRepos(html)).not.toContain("Resend ·")
    expect(auRepos(html)).not.toContain("Les emails")
    expect(auRepos(html)).not.toContain(PLAN_DKIM.attendu)
  })

  test("quand Resend répond, une ligne dit de copier chez le registrar", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_SPF, PLAN_DKIM, PLAN_DMARC] }}
        resultat={null}
        resend={RESEND_OK}
      />
    )
    expect(auRepos(html)).toContain("Les emails")
    expect(auRepos(html)).toMatch(/Resend les affiche/)
    expect(auRepos(html)).toMatch(/registrar/)
  })

  test("un refus de Resend n'ajoute aucune ligne, seulement son état", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DKIM] }}
        resultat={null}
        resend={{ etat: "cle_restreinte" }}
      />
    )
    expect((html.match(/data-testid="verdict-/g) ?? []).length).toBe(2)
    expect(auRepos(html)).toContain("Resend · clé limitée à l'envoi")
  })
})

// ---------------------------------------------------------------------
// OUVRIR L'ÉCRAN NE DÉCLARE RIEN CHEZ RESEND.
//
// Le montage appelait `resendDomain.declarer`, qui postait chez Resend
// quand le domaine y manquait : le seul AFFICHAGE de `/settings/domaine`
// créait une ressource chez un tiers, sous le compte de l'adoptant, sans
// qu'aucun clic ne l'ait demandé.
//
// `lireLeDomaine` est ce que le montage — et le bouton « Vérifier » —
// appellent désormais. Elle reçoit LES QUATRE actions de l'écran, y
// compris celle qui écrit, et n'en appelle que trois : ne lui passer que
// les lectures rendrait son innocence vraie par signature, donc
// invérifiable.
//
// CE QUE CES TESTS DISCRIMINENT, vérifié en retirant la garde :
//   - `declarerResend` remise dans le `Promise.all` de `lireLeDomaine`
//     (le code d'avant) → 2 échecs.
//   - `etatResend` dont le refus ne serait plus rattrapé → 1 échec.
// ---------------------------------------------------------------------

describe("lireLeDomaine", () => {
  /**
   * Les quatre actions, tracées — et celle qui écrit LÈVE.
   *
   * Elle lève plutôt que de rendre une valeur : un appel oublié fait alors
   * échouer le test par où il fait mal, sans dépendre de ce qu'on assure
   * ensuite sur la liste.
   */
  function actionsTracees(resend: ResultatResend = { etat: "absent" }) {
    const appels: string[] = []
    const actions: ActionsDomaine = {
      checkSite: async () => {
        appels.push("checkSite")
        return []
      },
      checkEmail: async () => {
        appels.push("checkEmail")
        return []
      },
      etatResend: async () => {
        appels.push("etatResend")
        return resend
      },
      declarerResend: async () => {
        appels.push("declarerResend")
        throw new Error("Ouvrir l'écran ne doit rien déclarer chez Resend.")
      },
    }
    return { actions, appels }
  }

  test("ouvrir l'écran lit, et n'écrit pas chez Resend", async () => {
    const { actions, appels } = actionsTracees()
    const lecture = await lireLeDomaine(actions, "exemple.fr")
    expect(appels).not.toContain("declarerResend")
    expect([...appels].sort()).toEqual(["checkEmail", "checkSite", "etatResend"])
    expect(lecture.hote).toBe("exemple.fr")
    expect(lecture.resend).toEqual({ etat: "absent" })
  })

  test("l'hôte lu est celui qu'on a demandé, sur les trois appels", async () => {
    const demandes: string[] = []
    const actions: ActionsDomaine = {
      checkSite: async ({ domaine }) => {
        demandes.push(domaine)
        return []
      },
      checkEmail: async ({ domaine }) => {
        demandes.push(domaine)
        return []
      },
      etatResend: async ({ domaine }) => {
        demandes.push(domaine)
        return { etat: "absent" }
      },
      declarerResend: async () => {
        throw new Error("Ouvrir l'écran ne doit rien déclarer chez Resend.")
      },
    }
    await lireLeDomaine(actions, "exemple.fr")
    expect(demandes).toEqual(["exemple.fr", "exemple.fr", "exemple.fr"])
  })

  // Une panne côté Resend n'a rien à dire sur les enregistrements A, et ce
  // sont eux qui décident du bouton d'enregistrement. La laisser emporter
  // la lecture entière fermerait le verrou pour une raison sans rapport.
  test("un refus de Resend n'emporte pas la lecture DNS", async () => {
    const actions: ActionsDomaine = {
      checkSite: async () => [A_SITE_OK],
      checkEmail: async () => [],
      etatResend: async () => {
        throw new Error("api.resend.com injoignable")
      },
      declarerResend: async () => {
        throw new Error("Ouvrir l'écran ne doit rien déclarer chez Resend.")
      },
    }
    const lecture = await lireLeDomaine(actions, "exemple.fr")
    expect(lecture.site).toEqual([A_SITE_OK])
    expect(lecture.resend).toEqual({ etat: "injoignable" })
  })

  // L'étiquette de l'issue que seule la lecture rend : rouge, parce que
  // Resend refuse les envois tant que le domaine n'est pas déclaré — et
  // nommée, parce qu'un rond rouge seul ne désigne rien.
  test("« absent » est une étiquette rouge et nommée", () => {
    expect(etiquetteResend({ etat: "absent" })).toEqual({
      signe: "ko",
      texte: "Resend · domaine non déclaré",
    })
  })
})
