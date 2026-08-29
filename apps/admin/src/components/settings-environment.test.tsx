// Les trois pages de réglages qui décrivent l'ENVIRONNEMENT au lieu de le
// modifier — Domaine & emails, Mesure & pixels, IA.
//
// Ces tests gardent une seule idée, et c'est la plus facile à perdre au
// prochain passage : **une page qui ne peut rien enregistrer ne doit
// afficher aucun champ**. Un `<input>` posé là pour « faire complet »
// avalerait une clé OpenRouter ou un identifiant de pixel et ne ferait
// rien du tout, en silence — c'est le faux réglage exact que ce dépôt
// refuse de fabriquer. Le test le dit en une assertion mécanique plutôt
// qu'en commentaire.
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { describe, expect, test } from "vitest"
import {
  AiPage,
  DomainAndEmailsPage,
  MeasurementPage,
} from "./settings-environment"

/** Tout ce par quoi une valeur pourrait être saisie puis perdue. */
function containsFormControl(html: string): boolean {
  return /<(input|textarea|select)\b/.test(html)
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element)
}

const UMAMI_CONFIGURE = {
  configured: true,
  url: "https://stats.exemple.fr",
  shared: true,
}
const UMAMI_ABSENT = { configured: false, url: null, shared: false }

describe("le corps d'une page en lecture seule", () => {
  const pages: [string, ReactElement][] = [
    ["IA", <AiPage configured={false} />],
    [
      "Domaine & emails",
      <DomainAndEmailsPage
        resend={{ configured: true, testMode: false }}
        adminUrl="https://admin.exemple.fr"
        webUrl="https://exemple.fr"
      />,
    ],
    ["Mesure & pixels", <MeasurementPage umamiApi={UMAMI_CONFIGURE} />],
  ]

  test.each(pages)("%s n'offre aucun champ de saisie", (_nom, element) => {
    expect(containsFormControl(render(element))).toBe(false)
  })

  test.each(pages)("%s ne pose aucun h1 : la page en a déjà un", (_nom, element) => {
    // Le plan des titres est celui de la PAGE : `h1` dans l'en-tête, `h2`
    // pour les groupes. Un `h1` de plus dans le corps le casserait.
    const html = render(element)
    expect(html).not.toContain("<h1")
  })
})

describe("AiPage", () => {
  test("donne la commande à lancer, puisque l'écran ne peut pas le faire", () => {
    expect(render(<AiPage configured={false} />)).toContain(
      "convex env set OPENROUTER_API_KEY"
    )
  })

  test("distingue « posée » de « absente »", () => {
    expect(render(<AiPage configured />)).toContain("Configurée")
    expect(render(<AiPage configured={false} />)).toContain("Absente")
  })

  test("avoue qu'aucune fonction ne lit encore la clé", () => {
    // Une pastille verte sur une fonctionnalité inexistante est un
    // mensonge que rien ne viendra corriger, parce que rien ne casse.
    expect(render(<AiPage configured />)).toMatch(/ne lit encore cette clé/)
  })
})

describe("DomainAndEmailsPage", () => {
  // `??` ne conviendrait pas : `null` est une valeur que ces tests
  // passent exprès (« la variable est absente »), et il la remplacerait
  // par le défaut.
  function html(
    overrides: {
      testMode?: boolean
      adminUrl?: string | null
      webUrl?: string | null
    } = {}
  ) {
    return render(
      <DomainAndEmailsPage
        resend={{ configured: true, testMode: overrides.testMode ?? false }}
        adminUrl={
          "adminUrl" in overrides ? overrides.adminUrl! : "https://admin.exemple.fr"
        }
        webUrl={"webUrl" in overrides ? overrides.webUrl! : "https://exemple.fr"}
      />
    )
  }

  test("montre les deux origines une seule fois chacune", () => {
    // La raison de la fusion : séparées, les pages « Domaine » et
    // « Emails » affichaient toutes deux `SITE_URL`, sans que rien ne dise
    // que c'était le même réglage.
    const rendu = html()
    // `>SITE_URL<` et non `SITE_URL` : `WEB_SITE_URL` le contient, et un
    // comptage naïf trouverait deux occurrences de la première variable
    // alors qu'il n'y en a qu'une.
    expect(rendu.match(/>SITE_URL</g) ?? []).toHaveLength(1)
    expect(rendu.match(/>WEB_SITE_URL</g) ?? []).toHaveLength(1)
    expect(rendu).toContain("https://admin.exemple.fr")
    expect(rendu).toContain("https://exemple.fr")
  })

  test("signale une origine manquante", () => {
    expect(html({ webUrl: null })).toContain("Absente")
  })

  test("dit que le mode d'essai n'envoie rien — la panne la plus silencieuse", () => {
    const essai = html({ testMode: true })
    expect(essai).toContain("RESEND_TEST_MODE")
    expect(essai).toMatch(/mode d(&#x27;|')essai/i)
    expect(html({ testMode: false })).toMatch(/envois r[ée]els/i)
  })

  test("nomme l'adresse d'expédition réellement utilisée, telle qu'elle est écrite dans le code", () => {
    // Écrite en dur dans `convex/leads.ts` et `convex/invitations.ts`. La
    // montrer est le seul moyen qu'un opérateur découvre qu'il envoie
    // depuis le bac à sable de Resend avant que ses clients le lui
    // apprennent.
    expect(html()).toContain("onboarding@resend.dev")
  })

  test("dit que les destinataires se règlent par les rôles, pas par une liste", () => {
    expect(html()).toMatch(/propriétaire/)
    expect(html()).toMatch(/Utilisateurs/)
  })
})

describe("MeasurementPage", () => {
  test("nomme les deux variables de pixel et dit qu'un rebuild est nécessaire", () => {
    const rendu = render(<MeasurementPage umamiApi={UMAMI_ABSENT} />)
    expect(rendu).toContain("PUBLIC_META_PIXEL_ID")
    expect(rendu).toContain("PUBLIC_GOOGLE_TAG_ID")
    expect(rendu).toMatch(/reconstru/i)
  })

  test("avoue ce que le dashboard ne peut pas savoir", () => {
    // Les variables `PUBLIC_*` sont figées dans l'image du site public :
    // Convex ne les voit pas. Afficher « non configuré » serait une
    // affirmation que rien ne soutient.
    const rendu = render(<MeasurementPage umamiApi={UMAMI_ABSENT} />)
    expect(rendu).toMatch(/ne peut pas (le )?savoir|hors de portée/i)
  })

  test("sépare le script qui compte des identifiants qui lisent les chiffres", () => {
    const rendu = render(<MeasurementPage umamiApi={UMAMI_CONFIGURE} />)
    expect(rendu).toContain("PUBLIC_UMAMI_URL")
    expect(rendu).toContain("UMAMI_API_USERNAME")
    expect(rendu).toContain("https://stats.exemple.fr")
  })

  test("garde la frontière du consentement du bon côté", () => {
    // La seule décision subtile du dossier RGPD : le comptage est exempté,
    // le rejeu de session ne l'est pas. L'écran doit dire laquelle des
    // deux est laquelle.
    const rendu = render(<MeasurementPage umamiApi={UMAMI_CONFIGURE} />)
    expect(rendu).toContain("PUBLIC_UMAMI_RECORDER")
    expect(rendu).toMatch(/attend le consentement/)
  })
})
