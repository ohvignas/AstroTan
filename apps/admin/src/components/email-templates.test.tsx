// L'écran « Envoi des emails » : la clé, l'adresse d'expédition, la liste
// de ce qui part, et l'éditeur d'un gabarit.
//
// Trois de ces tests gardent des décisions qui ne se voient pas dans le
// code — elles se voient à l'écran, ou nulle part :
//
//   1. l'interrupteur de l'invitation est inerte ET dit pourquoi. Le
//      serveur refuse déjà (`emails.setActif` lève `EMAIL_NON_DESACTIVABLE`),
//      mais un interrupteur grisé sans phrase se lit « c'est cassé » ;
//   2. le mode d'essai est un BANDEAU. Le texte existait déjà, enterré dans
//      l'aide d'une variable hors de portée (`settings-environment.tsx`),
//      là où personne ne l'a jamais lu — et c'est la panne la plus
//      silencieuse de ce déploiement : Resend accepte tout et ne délivre
//      rien ;
//   3. le refus d'un gabarit s'affiche AVANT l'enregistrement. Le serveur
//      refuse de toute façon, mais découvrir le refus après le clic fait
//      perdre le texte qu'on vient d'écrire.
//
// Comme le reste d'`apps/admin`, on rend en `renderToStaticMarkup` et on
// lit le HTML : `vitest.config.ts` est en `environment: "node"`, il n'y a
// ni DOM ni Testing Library. Ce qui est vérifié ici est donc ce qui est
// RENDU — exactement ce qui compte pour « la raison est affichée, pas
// masquée ».
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { CATALOGUE } from "@astrotan/backend/convex/lib/catalogueEmails"
import type { CleEmail } from "@astrotan/backend/convex/lib/catalogueEmails"
import {
  BandeauModeEssai,
  ChampAdresseExpedition,
  EditeurGabarit,
  ListeEmails,
  OrigineDesLiens,
  SectionCleResend,
  gabaritEnCoursModifie,
  validationLocale,
} from "./email-templates"
import type { EmailAffiche } from "./email-templates"
import type { SecretsBloc } from "./settings-environment"

// La ligne que `emails.list` rend : le catalogue, plus l'état en base. On
// la construit DEPUIS `CATALOGUE` plutôt qu'à la main — un catalogue qui
// gagnerait une variable obligatoire casserait ces tests là où il faut,
// au lieu de les laisser vérifier un email qui n'existe plus.
function ligne(cle: CleEmail, patch: Partial<EmailAffiche> = {}): EmailAffiche {
  const description = CATALOGUE.find((email) => email.cle === cle)
  if (description === undefined) throw new Error(`clé inconnue : ${cle}`)
  return {
    cle: description.cle,
    titre: description.titre,
    quand: description.quand,
    destinataire: description.destinataire,
    desactivable: description.desactivable,
    raisonNonDesactivable: description.raisonNonDesactivable ?? null,
    variables: [...description.variables],
    variablesObligatoires: [...description.variablesObligatoires],
    objetParDefaut: description.objetParDefaut,
    corpsParDefaut: description.corpsParDefaut,
    objet: description.objetParDefaut,
    corps: description.corpsParDefaut,
    actif: true,
    personnalise: false,
    probleme: null,
    enregistre: null,
    majAt: null,
    majParNom: null,
    ...patch,
  }
}

/**
 * Ce que `renderToStaticMarkup` fait des apostrophes.
 *
 * Les textes du catalogue en sont pleins (« l'administration »,
 * « quelqu'un »), et React les échappe en `&#x27;`. Sans ce passage, une
 * assertion « la carte contient le titre » échoue sur une différence
 * d'encodage et non sur ce qu'elle voulait vérifier.
 */
function echappe(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")
}

const INVITATION = ligne("invitation")
const NOTIFICATION = ligne("leadNotification")
const LISTE = [INVITATION, NOTIFICATION]

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

// ---------------------------------------------------------------------
// Le bandeau
// ---------------------------------------------------------------------

describe("BandeauModeEssai", () => {
  test("le mode d'essai s'affiche en bandeau, pas en note de bas de page", () => {
    const html = renderToStaticMarkup(<BandeauModeEssai actif />)
    expect(html).toMatch(/ne les délivre pas/)
  })

  test("il nomme la variable et donne la commande — sinon il n'y a rien à faire", () => {
    // Un avertissement qui ne dit pas comment en sortir se lit deux fois
    // et s'oublie. `RESEND_TEST_MODE` est lue dans le constructeur du
    // client Resend : elle ne se règle que dans l'environnement Convex.
    const html = renderToStaticMarkup(<BandeauModeEssai actif />)
    expect(html).toContain("RESEND_TEST_MODE")
    expect(html).toContain("npx convex env set RESEND_TEST_MODE false")
  })

  test("hors mode d'essai, il ne crie plus — et il ne ment pas non plus", () => {
    const html = renderToStaticMarkup(<BandeauModeEssai actif={false} />)
    expect(html).not.toMatch(/ne les délivre pas/)
    expect(html).toMatch(/envois r[ée]els/i)
  })
})

// ---------------------------------------------------------------------
// La liste
// ---------------------------------------------------------------------

describe("ListeEmails", () => {
  test("l'interrupteur de l'invitation est désactivé et dit pourquoi", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    // `aria-disabled="true"` et non un simple `/disabled/` : les classes
    // Tailwind des boutons portent `disabled:pointer-events-none`, si bien
    // qu'une recherche du mot seul passe sur n'importe quel rendu et ne
    // vérifie rien du tout.
    expect(html).toMatch(/aria-disabled="true"/)
    expect(html).toMatch(/seul chemin/i)
  })

  test("la raison est du texte affiché, jamais une infobulle", () => {
    // Une raison dans un `title=` n'existe pas au clavier, pas au doigt,
    // et pas pour un lecteur d'écran qui survole. Elle doit être lisible
    // sans rien survoler.
    const html = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    const raison = INVITATION.raisonNonDesactivable ?? ""
    expect(raison.length).toBeGreaterThan(0)
    // La phrase complète, dans le flux du document — et non tronquée dans
    // un attribut.
    expect(html).toContain(echappe(raison.slice(0, 60)))
    expect(html).not.toMatch(/title="[^"]*seul chemin/i)
  })

  test("un email désactivable, lui, garde un interrupteur vivant", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={[NOTIFICATION]} onToggle={() => {}} />
    )
    // La seule carte rendue est celle qui se coupe : ni l'interrupteur
    // ni sa case cachée ne sont inertes.
    expect(html).not.toMatch(/aria-disabled="true"/)
    expect(html).not.toMatch(/<input[^>]*\sdisabled/)
  })

  test("chaque carte dit quand l'email part et à qui", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    for (const email of LISTE) {
      expect(html).toContain(echappe(email.titre))
      expect(html).toContain(echappe(email.quand.slice(0, 40)))
    }
  })

  test("« personnalisé » et « par défaut » se distinguent", () => {
    const parDefaut = renderToStaticMarkup(
      <ListeEmails emails={[NOTIFICATION]} onToggle={() => {}} />
    )
    const personnalise = renderToStaticMarkup(
      <ListeEmails
        emails={[
          ligne("leadNotification", {
            personnalise: true,
            enregistre: { objet: "Un message", corps: "de {{nom}}" },
          }),
        ]}
        onToggle={() => {}}
      />
    )
    expect(parDefaut).toMatch(/par défaut/i)
    expect(personnalise).toMatch(/personnalisé/i)
  })

  test("un texte enregistré devenu invalide est signalé, pas effacé en silence", () => {
    // Le scénario de `emails.gabaritPour` : le catalogue gagne une
    // variable obligatoire, les gabarits écrits avant ne l'ont pas. Ils
    // sont écartés à la lecture — l'envoi continue avec le texte du code —
    // et l'écran est le seul endroit qui puisse le dire.
    const html = renderToStaticMarkup(
      <ListeEmails
        emails={[
          ligne("leadNotification", {
            probleme: "La variable {{ancienne}} n'existe pas pour cet email.",
            enregistre: { objet: "x", corps: "{{ancienne}}" },
          }),
        ]}
        onToggle={() => {}}
      />
    )
    expect(html).toContain("ancienne")
    expect(html).toMatch(/écarté|pas encore|n(&#x27;|')est pas celui qui part/i)
  })

  test("un email coupé le dit en toutes lettres", () => {
    const html = renderToStaticMarkup(
      <ListeEmails
        emails={[ligne("leadNotification", { actif: false })]}
        onToggle={() => {}}
      />
    )
    expect(html).toMatch(/ne part plus|désactivé/i)
  })
})

// ---------------------------------------------------------------------
// L'éditeur
// ---------------------------------------------------------------------

describe("EditeurGabarit", () => {
  test("une variable inconnue est signalée avant l'enregistrement", () => {
    const html = renderToStaticMarkup(
      <EditeurGabarit
        email={INVITATION}
        objet="x"
        corps="{{motDePasse}}"
        erreur={validationLocale(INVITATION, "x", "{{motDePasse}}")}
      />
    )
    expect(html).toContain("motDePasse")
  })

  test("le bouton d'enregistrement est inerte tant que le refus tient", () => {
    // Sinon on clique, le serveur refuse, et le texte qu'on vient
    // d'écrire est déjà parti de l'écran.
    const html = renderToStaticMarkup(
      <EditeurGabarit
        email={INVITATION}
        objet="x"
        corps="{{motDePasse}}"
        erreur="La variable {{motDePasse}} n'existe pas pour cet email."
        modifie
        onEnregistrer={() => {}}
      />
    )
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  test("les variables disponibles sont là, une par bouton", () => {
    const html = renderToStaticMarkup(
      <EditeurGabarit email={NOTIFICATION} objet="o" corps="c" erreur={null} />
    )
    for (const nom of NOTIFICATION.variables) {
      expect(html).toContain(`{{${nom}}}`)
    }
  })

  test("on peut revenir au texte du code", () => {
    const html = renderToStaticMarkup(
      <EditeurGabarit
        email={NOTIFICATION}
        objet="o"
        corps="c"
        erreur={null}
        onReinitialiser={() => {}}
      />
    )
    expect(html).toMatch(/texte par défaut/i)
  })

  test("le corps se tape dans un textarea, l'objet dans un champ d'une ligne", () => {
    // L'objet sur une seule ligne n'est pas une préférence de mise en
    // forme : un saut de ligne y ajouterait des en-têtes à l'email
    // (`lib/gabarit.ts`, `CARACTERE_INTERDIT_DANS_OBJET`).
    const html = renderToStaticMarkup(
      <EditeurGabarit email={NOTIFICATION} objet="o" corps="c" erreur={null} />
    )
    expect(html).toContain("<textarea")
    expect(html).toMatch(/<input[^>]*type="text"/)
  })
})

// ---------------------------------------------------------------------
// La validation, avant l'enregistrement
// ---------------------------------------------------------------------

describe("validationLocale", () => {
  test("c'est la règle du serveur, pas une seconde copie", () => {
    // `validerGabarit` (`convex/lib/gabarit.ts`) sert les deux appelants :
    // la mutation qui enregistre et cet écran qui prévient. Une règle
    // réécrite ici divergerait, et l'écran promettrait ce que le serveur
    // refuse.
    expect(validationLocale(INVITATION, "Bonjour", "{{motDePasse}}")).toContain(
      "motDePasse"
    )
    expect(validationLocale(INVITATION, "Bonjour", "Sans lien")).toContain(
      "{{lien}}"
    )
    expect(validationLocale(INVITATION, "A\nB", "{{lien}}")).toMatch(
      /une seule ligne/i
    )
    expect(validationLocale(INVITATION, "Bonjour", "Voici {{lien}}")).toBeNull()
  })

  test("un gabarit vide est refusé des deux côtés", () => {
    expect(validationLocale(NOTIFICATION, "", "corps")).toMatch(/objet/i)
    expect(validationLocale(NOTIFICATION, "objet", "   ")).toMatch(/corps/i)
  })
})

// ---------------------------------------------------------------------
// Le garde-fou de sortie de l'éditeur — voir le commentaire de
// `ListeEmailsConnectee` dans `routes/_authed/settings/emails.tsx` : c'est
// CETTE fonction qui nourrit à la fois « Modifications non enregistrées »
// sous l'éditeur et le `dirty` du garde-fou de navigation
// (`useUnsavedChangesGuard`). Si elle cesse de détecter une frappe non
// enregistrée, quitter la page ne prévient plus de rien — d'où des tests
// sur le COMPORTEMENT (des textes qui divergent, ou pas), pas sur son
// existence.
// ---------------------------------------------------------------------

describe("gabaritEnCoursModifie", () => {
  test("aucun éditeur ouvert : rien n'est en cours, rien n'est modifié", () => {
    expect(gabaritEnCoursModifie(null, "peu importe", "peu importe")).toBe(false)
  })

  test("le texte affiché à l'ouverture n'est pas déjà une modification", () => {
    // `EditeurGabarit` s'ouvre sur `enregistre ?? défaut` — si cette
    // même valeur ressortait « modifiée », le garde-fou s'armerait sans
    // qu'on ait tapé un seul caractère.
    expect(
      gabaritEnCoursModifie(INVITATION, INVITATION.objet, INVITATION.corps)
    ).toBe(false)
  })

  test("un objet retouché arme le garde-fou", () => {
    expect(
      gabaritEnCoursModifie(INVITATION, "Un nouvel objet", INVITATION.corps)
    ).toBe(true)
  })

  test("un corps retouché arme le garde-fou", () => {
    expect(
      gabaritEnCoursModifie(INVITATION, INVITATION.objet, "Un nouveau corps")
    ).toBe(true)
  })

  test("un texte tapé puis reproduit à l'identique désarme le garde-fou", () => {
    // Le scénario qui compte le plus : écrire, se raviser, retaper
    // exactement le texte de départ. Rien à perdre — la sortie ne doit
    // plus être bloquée.
    const objetInitial = INVITATION.objet
    const corpsInitial = INVITATION.corps
    expect(gabaritEnCoursModifie(INVITATION, "Brouillon", corpsInitial)).toBe(
      true
    )
    expect(
      gabaritEnCoursModifie(INVITATION, objetInitial, corpsInitial)
    ).toBe(false)
  })

  test("un gabarit déjà personnalisé compare au texte ENREGISTRÉ, pas au défaut du code", () => {
    // `enregistre` porte ce qui est en base ; `objetParDefaut`/`corpsParDefaut`
    // ne sont que le repli du code. Comparer au mauvais des deux armerait
    // le garde-fou sur un écran qu'on vient d'ouvrir sans y toucher.
    const personnalise = ligne("invitation", {
      personnalise: true,
      enregistre: { objet: "Objet personnalisé", corps: "Corps personnalisé" },
    })
    expect(
      gabaritEnCoursModifie(personnalise, "Objet personnalisé", "Corps personnalisé")
    ).toBe(false)
    expect(
      gabaritEnCoursModifie(
        personnalise,
        personnalise.objetParDefaut,
        personnalise.corpsParDefaut
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------
// La clé, et l'adresse d'expédition
// ---------------------------------------------------------------------

describe("SectionCleResend", () => {
  test("la clé se saisit ici — c'est la seule interface de saisie du dépôt", () => {
    // La régression que cet écran referme : `/settings/domaine` a été
    // réécrit sans reprendre `RESEND_API_KEY`, qui ne se posait donc plus
    // que par `npx convex run` ou par l'environnement.
    const html = renderToStaticMarkup(
      <SectionCleResend secrets={bloc()} resend={{ configured: false }} />
    )
    expect(html).toContain("secret-RESEND_API_KEY")
    // Et l'écran dit d'où la clé est LUE : `lib/resend.ts` passe par
    // `secrets.lireSecret`, qui préfère l'environnement et retombe sur la
    // base. Sans cette phrase, on saisit une clé qui n'a aucun effet parce
    // qu'une variable du déploiement l'emporte, et rien ne le dit.
    expect(html).toMatch(/la base est lue/i)
    expect(html).toContain("secrets.lireSecret")
  })

  test("jamais en clair, jamais pré-remplie", () => {
    const html = renderToStaticMarkup(
      <SectionCleResend secrets={bloc()} resend={{ configured: false }} />
    )
    for (const champ of html.match(/<input[^>]*>/g) ?? []) {
      expect(champ, champ).toContain('type="password"')
      expect(champ, champ).not.toMatch(/value="[^"]+"/)
    }
  })

  test("un editor lit une phrase, pas un cadre vide", () => {
    const html = renderToStaticMarkup(
      <SectionCleResend
        secrets={bloc({ cleMaitresse: null, canWrite: false })}
        resend={{ configured: false }}
      />
    )
    expect(html).not.toContain("<input")
    expect(html).toMatch(/propriétaire et aux administrateurs/i)
  })
})

describe("ChampAdresseExpedition", () => {
  test("dit la forme attendue et renvoie vers la vérification du domaine", () => {
    const html = renderToStaticMarkup(
      <ChampAdresseExpedition
        valeur="Nom <bonjour@exemple.fr>"
        lienDomaine={<a href="/settings/domaine">Domaine</a>}
      />
    )
    expect(html).toContain("votredomaine.fr")
    expect(html).toMatch(/vérifié chez Resend/i)
    expect(html).toContain('href="/settings/domaine"')
  })

  test("champ vide : l'écran nomme le repli qui sert à la place", () => {
    // Le repli est le bac à sable de Resend, qui ne délivre qu'aux
    // adresses de test. Sans cette phrase, on ne le découvre que par ses
    // destinataires — c'est-à-dire jamais.
    const html = renderToStaticMarkup(<ChampAdresseExpedition valeur="" />)
    expect(html).toContain("onboarding@resend.dev")
  })

  test("une adresse mal formée est signalée avant d'être envoyée", () => {
    const html = renderToStaticMarkup(
      <ChampAdresseExpedition valeur="pas une adresse" />
    )
    expect(html).toMatch(/adresse/i)
    expect(html).toContain("role=\"alert\"")
  })
})

describe("OrigineDesLiens", () => {
  test("SITE_URL se lit, ne se saisit pas — et on dit ce qu'elle compose", () => {
    // Les liens contenus DANS les emails en sortent (l'invitation, et le
    // « répondre depuis le dashboard » d'une notification de lead). Lue au
    // chargement des modules Convex : une valeur saisie ici arriverait
    // toujours trop tard.
    const html = renderToStaticMarkup(
      <OrigineDesLiens adminUrl="https://admin.exemple.fr" />
    )
    expect(html).toContain("SITE_URL")
    expect(html).not.toContain("secret-SITE_URL")
    expect(html).toContain("https://admin.exemple.fr")
  })

  test("absente, elle est signalée : les liens des emails ne mènent nulle part", () => {
    expect(renderToStaticMarkup(<OrigineDesLiens adminUrl={null} />)).toContain(
      "Absente"
    )
  })
})
