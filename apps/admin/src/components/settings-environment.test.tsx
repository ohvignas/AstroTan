// Les trois pages qui portent les JETONS et les variables de déploiement —
// Mesure & pixels, IA, et Envoi des emails.
//
// La troisième vit dans `email-templates.tsx` et est importée ici quand
// même, parce que les invariants gardés plus bas — jamais un jeton en
// clair, jamais un champ pré-rempli, la précédence écrite à l'écran —
// appartiennent aux PAGES qui portent des jetons, pas au fichier où elles
// sont écrites. Les laisser derrière en déménageant la page aurait été la
// façon la plus discrète de les perdre.
//
// Ces tests gardaient une idée : « une page qui ne peut rien enregistrer ne
// doit afficher aucun champ ». Elle avait raison, et la moitié qui reste
// vraie est la seule qui comptait : **on n'affiche un champ que là où le
// saisir change quelque chose**. Les jetons ont maintenant un logement
// (`convex/secrets.ts`, chiffré), donc ils ont un champ ; les variables
// `PUBLIC_*` d'`apps/web` sont figées au build de l'image du site et n'en
// auront jamais, parce qu'un champ qui n'a aucun effet en silence est le
// faux réglage exact que ce dépôt refuse de fabriquer.
//
// D'où la forme d'assertion : ce n'est plus « aucun `<input>` », c'est
// « aucun `<input>` pour une variable qui ne peut pas être écrite ».
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { describe, expect, test } from "vitest"
import { AiPage, MeasurementPage } from "./settings-environment"
import { SectionCleResend } from "./email-templates"
import type { SecretsBloc } from "./settings-environment"
import type { SecretEtat } from "./settings-secrets"

function etat(nom: string, patch: Partial<SecretEtat> = {}): SecretEtat {
  return {
    nom,
    environnement: false,
    base: false,
    illisible: false,
    quatreDerniers: null,
    majAt: null,
    source: "aucune",
    ...patch,
  }
}

function bloc(patch: Partial<SecretsBloc> = {}): SecretsBloc {
  return {
    cleMaitresse: "posee",
    etats: {},
    canWrite: true,
    onSave: async () => {},
    onClear: async () => {},
    ...patch,
  }
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

function pages(secrets: SecretsBloc): [string, ReactElement][] {
  return [
    ["IA", <AiPage secrets={secrets} />],
    ["Envoi des emails", <SectionCleResend secrets={secrets} />],
    [
      "Mesure & pixels",
      <MeasurementPage umamiApi={UMAMI_CONFIGURE} secrets={secrets} />,
    ],
  ]
}

describe("le corps d'une page", () => {
  test.each(pages(bloc()))("%s ne pose aucun h1 : la page en a déjà un", (
    _nom,
    element
  ) => {
    // Le plan des titres est celui de la PAGE : `h1` dans l'en-tête, `h2`
    // pour les groupes. Un `h1` de plus dans le corps le casserait.
    expect(render(element)).not.toContain("<h1")
  })

  test.each(pages(bloc()))(
    "%s n'offre aucun champ en clair : un jeton se tape en type=password",
    (_nom, element) => {
      const html = render(element)
      const champs = html.match(/<input[^>]*>/g) ?? []
      for (const champ of champs) {
        expect(champ, champ).toContain('type="password"')
      }
    }
  )

  test.each(pages(bloc()))(
    "%s ne pré-remplit jamais un champ de jeton",
    (_nom, element) => {
      // Une valeur pré-remplie part dans le HTML de la page, à un clic
      // droit de n'importe qui. Le champ est toujours vide : vide veut dire
      // « ne change rien ».
      const champs = render(element).match(/<input[^>]*>/g) ?? []
      for (const champ of champs) {
        expect(champ, champ).toMatch(/value=""|(?!.*\bvalue=)/)
        expect(champ, champ).not.toMatch(/value="[^"]+"/)
      }
    }
  )
})

describe("les variables hors de portée", () => {
  test("aucune des variables PUBLIC_* n'a de champ", () => {
    // Astro les fige au build de l'image du site : un champ ici n'aurait
    // aucun effet, en silence.
    const html = render(
      <MeasurementPage umamiApi={UMAMI_ABSENT} secrets={bloc()} />
    )
    for (const nom of [
      "PUBLIC_UMAMI_URL",
      "PUBLIC_UMAMI_WEBSITE_ID",
      "PUBLIC_UMAMI_RECORDER",
      "PUBLIC_META_PIXEL_ID",
      "PUBLIC_GOOGLE_TAG_ID",
    ]) {
      expect(html).toContain(nom)
      expect(html).not.toContain(`secret-${nom}`)
    }
    expect(html).toMatch(/reconstru/i)
    expect(html).toMatch(/ne peut pas.*savoir|Ne se règle pas ici/i)
  })

  // `test("SITE_URL se lit, ne se saisit pas")` était ici, et son composant
  // (`OrigineDesLiens`) est parti avec la refonte de « Envoi des emails » :
  // un bloc qui n'était qu'une explication et une commande, sur un écran
  // qui ne doit montrer que des états, des étiquettes et des actions.
  //
  // Ce qu'il gardait reste vrai et n'est plus dit qu'à un seul endroit :
  // `SITE_URL` compose les liens contenus DANS les emails, et une valeur
  // saisie à l'écran arriverait toujours trop tard (elle est lue au
  // chargement des modules Convex) — le raisonnement complet est conservé
  // en commentaire dans `email-templates.tsx`. `OrigineDesLiens` a rejoint
  // `« Domaine et DNS »` (`components/domain-check.tsx`, rendu par
  // `routes/_authed/settings/domaine.tsx`), qui portait déjà la même
  // vérification pour `WEB_SITE_URL` — testé là-bas, pas ici.
})

describe("la précédence, écrite à l'écran", () => {
  // « Envoi des emails » ne l'écrit plus, et c'est une décision, pas un
  // oubli : cet écran s'adresse à quelqu'un qui vient d'installer le
  // template et ne lira jamais `convex/secrets.ts`. Une leçon de
  // précédence affichée en permanence à côté d'un champ n'y change aucun
  // geste.
  //
  // Ce que la règle avait d'ACTIONNABLE est gardé, et au bon moment : dès
  // que les deux valeurs existent, `SecretField` (`settings-secrets.tsx`)
  // écrit que celle saisie est ignorée et donne la façon de la faire
  // servir. C'est le seul cas où quelqu'un pouvait perdre une heure, et il
  // est couvert par le test suivant. Les deux pages qui listent PLUSIEURS
  // jetons gardent la phrase générale, où elle sert d'en-tête à un
  // tableau.
  test("chaque page qui liste plusieurs jetons dit que l'environnement gagne", () => {
    const listes = pages(bloc()).filter(([nom]) => nom !== "Envoi des emails")
    expect(listes.length).toBe(2)
    for (const [nom, element] of listes) {
      expect(render(element), nom).toMatch(
        /variable d(&#x27;|')environnement du même nom l(&#x27;|')emporte/
      )
    }
  })

  test("quand les deux existent, l'écran dit laquelle sert", () => {
    // Le piège que cette phrase évite : quelqu'un saisit une clé, elle
    // n'a aucun effet, et rien à l'écran ne dit pourquoi.
    const html = render(
      <AiPage
        secrets={bloc({
          etats: {
            OPENROUTER_API_KEY: etat("OPENROUTER_API_KEY", {
              environnement: true,
              base: true,
              quatreDerniers: "9876",
              majAt: 1_788_000_000_000,
              source: "environnement",
            }),
          },
        })}
      />
    )
    expect(html).toMatch(/ignorée/)
    expect(html).toContain("npx convex env remove OPENROUTER_API_KEY")
  })

  test("une ligne devenue illisible le dit au lieu de passer pour posée", () => {
    const html = render(
      <AiPage
        secrets={bloc({
          etats: {
            OPENROUTER_API_KEY: etat("OPENROUTER_API_KEY", {
              base: true,
              illisible: true,
              source: "aucune",
            }),
          },
        })}
      />
    )
    expect(html).toContain("Illisible")
    expect(html).toMatch(/ne se déchiffre plus/)
  })
})

describe("la clé maîtresse", () => {
  test("absente, elle bloque la saisie et donne la commande", () => {
    const html = render(<AiPage secrets={bloc({ cleMaitresse: "absente" })} />)
    expect(html).toContain("SECRETS_KEY")
    expect(html).toContain("openssl rand -base64 32")
    // Pas de champ du tout : le serveur refuserait, autant ne pas laisser
    // taper une clé pour rien.
    expect(html).not.toContain("secret-OPENROUTER_API_KEY")
  })

  test("mal formée, c'est un autre message — le remède n'est pas le même", () => {
    const html = render(<AiPage secrets={bloc({ cleMaitresse: "illisible" })} />)
    expect(html).toMatch(/32 octets/)
  })
})

describe("AiPage", () => {
  test("donne la commande à lancer, puisque l'écran ne peut pas le faire", () => {
    expect(render(<AiPage secrets={bloc()} />)).toContain(
      "convex env set OPENROUTER_API_KEY"
    )
  })

  test("avoue qu'aucune fonction ne lit encore la clé", () => {
    // Une pastille verte sur une fonctionnalité inexistante est un
    // mensonge que rien ne viendra corriger, parce que rien ne casse.
    expect(render(<AiPage secrets={bloc()} />)).toMatch(/ne lit encore cette clé/)
  })

  test("un editor voit pourquoi il ne voit rien, plutôt qu'un cadre vide", () => {
    const html = render(
      <AiPage secrets={bloc({ cleMaitresse: null, canWrite: false })} />
    )
    expect(html).toMatch(/réservés au\s+propriétaire/)
    expect(html).not.toContain("<input")
  })
})

// `describe("DomainAndEmailsPage")` était ici. Il est parti avec la page :
// `/settings/domaine` a été réécrit sans elle, et ses six tests gardaient
// donc un composant que plus personne ne rendait — des tests verts sur du
// code injoignable, ce qui est la pire des deux moitiés.
//
// Rien de ce qu'ils gardaient n'a été perdu : la clé Resend, le mode
// d'essai, l'adresse d'expédition et `SITE_URL` sont maintenant testés
// dans `email-templates.test.tsx`, sur les composants que
// `/settings/emails` rend réellement. La seule assertion sans héritière
// est celle de `WEB_SITE_URL` — voir le bloc « Domaine & emails —
// RETIRÉE » de `settings-environment.tsx`.

describe("MeasurementPage", () => {
  test("sépare le script qui compte des identifiants qui lisent les chiffres", () => {
    const rendu = render(
      <MeasurementPage umamiApi={UMAMI_CONFIGURE} secrets={bloc()} />
    )
    expect(rendu).toContain("PUBLIC_UMAMI_URL")
    expect(rendu).toContain("UMAMI_API_USERNAME")
    expect(rendu).toContain("https://stats.exemple.fr")
  })

  test("les quatre identifiants de lecture ont chacun leur champ", () => {
    // « Les quatre ensemble ou rien » : un seul champ manquant rendrait
    // l'intégration insaisissable depuis l'écran.
    const rendu = render(
      <MeasurementPage umamiApi={UMAMI_ABSENT} secrets={bloc()} />
    )
    for (const nom of [
      "UMAMI_API_URL",
      "UMAMI_API_WEBSITE_ID",
      "UMAMI_API_USERNAME",
      "UMAMI_API_PASSWORD",
    ]) {
      expect(rendu, nom).toContain(`secret-${nom}`)
    }
  })

  test("garde la frontière du consentement du bon côté", () => {
    // La seule décision subtile du dossier RGPD : le comptage est exempté,
    // le rejeu de session ne l'est pas. L'écran doit dire laquelle des
    // deux est laquelle.
    const rendu = render(
      <MeasurementPage umamiApi={UMAMI_CONFIGURE} secrets={bloc()} />
    )
    expect(rendu).toContain("PUBLIC_UMAMI_RECORDER")
    expect(rendu).toMatch(/attend le consentement/)
  })

  test("dit que les identifiants Umami sont bien lus depuis la base, derrière l'environnement", () => {
    const rendu = render(
      <MeasurementPage umamiApi={UMAMI_CONFIGURE} secrets={bloc()} />
    )
    expect(rendu).toMatch(/la base est lue/i)
    expect(rendu).toContain("secrets.lireSecret")
  })

  test("dit que la base peut compléter un environnement Umami incomplet", () => {
    // `environment.umamiApi.configured` ne voit que l'ENVIRONNEMENT
    // (c'est une `query`, qui ne peut pas appeler `lireSecret`) : un
    // environnement incomplet ne veut plus dire « non configuré », depuis
    // que `analytics.ts` retombe sur la base pour chaque identifiant
    // manquant.
    const rendu = render(
      <MeasurementPage umamiApi={UMAMI_ABSENT} secrets={bloc()} />
    )
    expect(rendu).toMatch(/si la base ne complète pas/i)
  })
})
