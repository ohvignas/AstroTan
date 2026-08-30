import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Enregistrement, Verdict } from "@astrotan/backend/convex/dns"
import type { ResultatResend } from "@astrotan/backend/convex/resendDomain"
import {
  Etiquette,
  TableauDns,
  estCopiable,
  fusionnerResend,
  fusionnerVerdicts,
} from "./domain-check"
import type { Lecture } from "@/routes/_authed/settings/domaine"
import {
  TableauxDns,
  domaineEnregistrable,
  etatDesA,
  etiquetteResend,
  lectureDe,
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
 * qu'un nom DNS s'écrit `resend. _domainkey. illith.com`.
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

  test("chaque situation a son état, et il tient en trois mots", () => {
    expect(etatDesA("exemple.f", null, null)).toEqual({
      signe: "inconnu",
      texte: "Domaine incomplet",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", null)).toEqual({
      signe: "inconnu",
      texte: "A non lu",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_MANQUANT]))).toEqual({
      signe: "ko",
      texte: "A à poser",
    })
    expect(etatDesA("exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_OK]))).toEqual({
      signe: "ok",
      texte: "A en place",
    })
  })

  // Une croix rouge à côté d'un bouton armé, ou l'inverse, est la seule
  // façon dont ces deux-là peuvent mentir. Ils sont dérivés l'un de
  // l'autre pour que ce soit impossible ; ce test le tient.
  test("l'état et le verrou ne divergent jamais", () => {
    const cas: Array<[string, string | null, Lecture | null]> = [
      ["exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_OK])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_OK, A_ADMIN_MANQUANT])],
      ["exemple.fr", "exemple.fr", lue([A_SITE_MUET, A_ADMIN_OK])],
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
    const html = renderToStaticMarkup(<Etiquette signe="ko" texte="A à poser" />)
    expect(texte(html)).toContain("A à poser")
    expect(html).toContain('data-signe="ko"')
    expect(html).not.toContain("aria-label")
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

  test("sans réponse de Resend, le tableau est celui d'avant", () => {
    const html = renderToStaticMarkup(
      <TableauxDns
        plan={{ site: [PLAN_SITE], email: [PLAN_DKIM] }}
        resultat={null}
        resend={null}
      />
    )
    expect(auRepos(html)).not.toContain("Resend ·")
    expect(auRepos(html)).toContain(PLAN_DKIM.attendu)
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
