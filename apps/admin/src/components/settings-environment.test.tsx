// Les quatre sections des réglages qui décrivent l'ENVIRONNEMENT au lieu
// de le modifier — IA, Emails, Domaine, Mesure & pixels.
//
// Ces tests gardent une seule idée, et c'est la plus facile à perdre au
// prochain passage : **une section qui ne peut rien enregistrer ne doit
// afficher aucun champ**. Un `<input>` posé là pour « faire complet »
// avalerait une clé OpenRouter ou un identifiant de pixel et ne ferait
// rien du tout, en silence — c'est le faux réglage exact que ce dépôt
// refuse de fabriquer. Le test le dit en une assertion mécanique plutôt
// qu'en commentaire.
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { describe, expect, test } from "vitest"
import {
  AiSection,
  DomainSection,
  EmailsSection,
  MeasurementSection,
} from "./settings-environment"

/** Tout ce par quoi une valeur pourrait être saisie puis perdue. */
function containsFormControl(html: string): boolean {
  return /<(input|textarea|select)\b/.test(html)
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element)
}

describe("AiSection", () => {
  test("n'offre aucun moyen de saisir la clé", () => {
    for (const configured of [true, false]) {
      const html = render(<AiSection configured={configured} />)
      expect(containsFormControl(html)).toBe(false)
    }
  })

  test("donne la commande à lancer, puisque l'écran ne peut pas le faire", () => {
    const html = render(<AiSection configured={false} />)
    expect(html).toContain("convex env set OPENROUTER_API_KEY")
  })

  test("distingue « posée » de « absente »", () => {
    expect(render(<AiSection configured />)).toContain("Configurée")
    expect(render(<AiSection configured={false} />)).toContain("Absente")
  })
})

describe("EmailsSection", () => {
  test("n'offre aucun champ : ni la clé, ni les destinataires", () => {
    const html = render(
      <EmailsSection
        resend={{ configured: true, testMode: false }}
        adminUrl="https://admin.exemple.fr"
      />
    )
    expect(containsFormControl(html)).toBe(false)
  })

  test("dit que le mode d'essai n'envoie rien — la panne la plus silencieuse", () => {
    const essai = render(
      <EmailsSection resend={{ configured: true, testMode: true }} adminUrl={null} />
    )
    expect(essai).toContain("RESEND_TEST_MODE")
    expect(essai).toMatch(/mode d(&#x27;|')essai/i)

    const reel = render(
      <EmailsSection resend={{ configured: true, testMode: false }} adminUrl={null} />
    )
    expect(reel).toMatch(/envois r[ée]els/i)
  })

  test("nomme l'adresse d'expédition réellement utilisée, telle qu'elle est écrite dans le code", () => {
    // Écrite en dur dans `convex/leads.ts` et `convex/invitations.ts`. La
    // montrer est le seul moyen qu'un opérateur découvre qu'il envoie
    // depuis le bac à sable de Resend avant que ses clients le lui
    // apprennent.
    const html = render(
      <EmailsSection resend={{ configured: true, testMode: false }} adminUrl={null} />
    )
    expect(html).toContain("onboarding@resend.dev")
  })
})

describe("DomainSection", () => {
  test("n'offre aucun champ : le domaine se règle chez le DNS et dans Traefik", () => {
    const html = render(
      <DomainSection adminUrl="https://admin.exemple.fr" webUrl="https://exemple.fr" />
    )
    expect(containsFormControl(html)).toBe(false)
  })

  test("montre les deux origines, et signale celle qui manque", () => {
    const html = render(<DomainSection adminUrl="https://admin.exemple.fr" webUrl={null} />)
    expect(html).toContain("https://admin.exemple.fr")
    expect(html).toContain("WEB_SITE_URL")
    expect(html).toContain("Absente")
  })
})

describe("MeasurementSection", () => {
  test("n'offre aucun champ pour les pixels : ils sont figés au build", () => {
    const html = render(
      <MeasurementSection umamiApi={{ configured: true, url: "https://stats.exemple.fr", shared: false }} />
    )
    expect(containsFormControl(html)).toBe(false)
  })

  test("nomme les deux variables de pixel et dit qu'un rebuild est nécessaire", () => {
    const html = render(
      <MeasurementSection umamiApi={{ configured: false, url: null, shared: false }} />
    )
    expect(html).toContain("PUBLIC_META_PIXEL_ID")
    expect(html).toContain("PUBLIC_GOOGLE_TAG_ID")
    expect(html).toMatch(/reconstru/i)
  })

  test("avoue ce que le dashboard ne peut pas savoir", () => {
    // Les variables `PUBLIC_*` sont figées dans l'image du site public :
    // Convex ne les voit pas. Afficher « non configuré » serait une
    // affirmation que rien ne soutient.
    const html = render(
      <MeasurementSection umamiApi={{ configured: false, url: null, shared: false }} />
    )
    expect(html).toMatch(/ne peut pas (le )?savoir|hors de portée/i)
  })

  test("sépare le script qui compte des identifiants qui lisent les chiffres", () => {
    const html = render(
      <MeasurementSection umamiApi={{ configured: true, url: "https://stats.exemple.fr", shared: true }} />
    )
    expect(html).toContain("PUBLIC_UMAMI_URL")
    expect(html).toContain("UMAMI_API_USERNAME")
    expect(html).toContain("https://stats.exemple.fr")
  })
})
