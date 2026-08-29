// L'écran « Envoi des emails » : la clé, l'adresse d'expédition, et
// l'accordéon de ce qui part.
//
// Quatre de ces tests gardent des décisions qui ne se voient pas dans le
// code — elles se voient à l'écran, ou nulle part :
//
//   1. l'interrupteur d'un email non désactivable est inerte, et cette
//      inertie se VOIT — cadenas, mention « Toujours actif ». Le serveur
//      refuse déjà (`emails.setActif` lève `EMAIL_NON_DESACTIVABLE`) ;
//      l'écran ne doit ni proposer le geste, ni plaider la décision ;
//   2. le mode d'essai est visible sans rien déplier — c'est la panne la
//      plus silencieuse de ce déploiement : Resend accepte tout et ne
//      délivre rien, et c'est la valeur par défaut ;
//   3. le refus d'un gabarit s'affiche AVANT l'enregistrement. Le serveur
//      refuse de toute façon, mais découvrir le refus après le clic fait
//      perdre le texte qu'on vient d'écrire ;
//   4. replier une ligne modifiée passe par une question. C'est la seconde
//      porte par laquelle un texte se perdait, et elle ne traverse aucun
//      routeur — `useUnsavedChangesGuard` ne la voit pas.
//
// Un cinquième garde la refonte elle-même : cet écran ne montre que des
// ÉTATS, des ÉTIQUETTES et des ACTIONS. Aucune commande shell, aucune
// leçon d'architecture. C'est ce qui se réintroduit le plus facilement, une
// phrase à la fois, et un test est la seule chose qui le remarque.
//
// Comme le reste d'`apps/admin`, on rend en `renderToStaticMarkup` et on
// lit le HTML : `vitest.config.ts` est en `environment: "node"`, il n'y a
// ni DOM ni Testing Library. Ce qui est vérifié ici est donc ce qui est
// RENDU — exactement ce qui compte pour « la raison est affichée, pas
// masquée » — et la logique de l'accordéon, qu'on ne peut pas cliquer, est
// testée par la fonction pure qui la porte (`actionSurLigne`).
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { CATALOGUE } from "@astrotan/backend/convex/lib/catalogueEmails"
import type { CleEmail } from "@astrotan/backend/convex/lib/catalogueEmails"
import {
  ChampAdresseExpedition,
  EditeurGabarit,
  EtatEnvoi,
  ListeEmails,
  SectionCleResend,
  actionSurLigne,
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
 * assertion « la ligne contient le titre » échoue sur une différence
 * d'encodage et non sur ce qu'elle voulait vérifier.
 */
function echappe(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")
}

const INVITATION = ligne("invitation")
const NOTIFICATION = ligne("leadNotification")
const RESET = ligne("passwordReset")
const LISTE = [INVITATION, NOTIFICATION, RESET]

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
// L'état de l'envoi — la première question de l'écran
// ---------------------------------------------------------------------

describe("EtatEnvoi", () => {
  test("le mode d'essai dit la conséquence, sans rien expliquer", () => {
    // Ce qui compte est qu'aucun email n'arrive. Le nom de la variable, le
    // fait que Resend réponde « envoyé » et la commande qui en sort sont
    // vrais et sans effet sur un geste possible depuis ce dashboard : ils
    // vivent en commentaire dans `email-templates.tsx`.
    const html = renderToStaticMarkup(<EtatEnvoi testMode />)
    expect(html).toMatch(/mode d(&#x27;|')essai/i)
    expect(html).toMatch(/aucun email n(&#x27;|')est délivré/i)
  })

  test("une clé absente est un état, au même endroit", () => {
    const html = renderToStaticMarkup(<EtatEnvoi testMode={false} cleAbsente />)
    expect(html).toMatch(/aucune clé resend/i)
  })

  test("les deux pannes tiennent ensemble : en corriger une ne suffit pas", () => {
    // Le piège, sinon : on pose la clé, la ligne rouge disparaît, et rien
    // n'est délivré pour autant.
    const html = renderToStaticMarkup(<EtatEnvoi testMode cleAbsente />)
    expect(html).toMatch(/mode d(&#x27;|')essai/i)
    expect(html).toMatch(/aucune clé resend/i)
  })

  test("tout va bien : une ligne calme, et pas de silence", () => {
    const html = renderToStaticMarkup(<EtatEnvoi testMode={false} />)
    expect(html).toMatch(/envois réels/i)
    expect(html).not.toMatch(/mode d(&#x27;|')essai/i)
  })
})

// ---------------------------------------------------------------------
// La refonte, gardée : des états, des étiquettes, des actions
// ---------------------------------------------------------------------

describe("l'écran n'explique rien", () => {
  const morceaux = (): [string, string][] => [
    ["EtatEnvoi", renderToStaticMarkup(<EtatEnvoi testMode cleAbsente />)],
    [
      "SectionCleResend",
      renderToStaticMarkup(<SectionCleResend secrets={bloc()} />),
    ],
    [
      "ChampAdresseExpedition",
      renderToStaticMarkup(<ChampAdresseExpedition valeur="" />),
    ],
    [
      "ListeEmails",
      renderToStaticMarkup(<ListeEmails emails={LISTE} onToggle={() => {}} />),
    ],
    [
      "EditeurGabarit",
      renderToStaticMarkup(
        <EditeurGabarit
          email={NOTIFICATION}
          objet={NOTIFICATION.objet}
          corps={NOTIFICATION.corps}
          erreur={null}
        />
      ),
    ],
  ]

  test("aucune commande shell nulle part", () => {
    // Une commande affichée dans un dashboard dit à qui la lit que l'écran
    // ne sait pas faire son travail. Celles qui restent utiles sont dans
    // `docker/README.md`, qui s'adresse à qui a un terminal.
    for (const [nom, html] of morceaux()) {
      expect(html, nom).not.toMatch(/npx convex|npm run|pnpm |openssl |cd packages/)
      expect(html, nom).not.toContain("<pre")
    }
  })

  test("aucun nom de module ni de fonction du serveur", () => {
    // Le lecteur de cet écran n'ouvrira jamais ces fichiers, et aucune
    // décision ne dépend de leur nom.
    for (const [nom, html] of morceaux()) {
      expect(html, nom).not.toMatch(
        /convex\/|lireSecret|gabaritPour|catalogueEmails|Better Auth|AES-GCM/
      )
    }
  })

  test("aucune variable d'environnement citée, sauf le nom du champ lui-même", () => {
    // `RESEND_API_KEY` est l'étiquette que `SecretField` pose sur son
    // propre champ : c'est le seul endroit où un nom technique reste utile,
    // parce qu'il désigne ce qu'on est en train de remplir.
    for (const [nom, html] of morceaux()) {
      expect(html, nom).not.toContain("RESEND_TEST_MODE")
      expect(html, nom).not.toContain("SITE_URL")
      expect(html, nom).not.toContain("SECRETS_KEY")
    }
  })
})

// ---------------------------------------------------------------------
// L'accordéon
// ---------------------------------------------------------------------

describe("ListeEmails", () => {
  test("tout est replié à l'arrivée : on vient vérifier, pas réécrire", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).not.toMatch(/aria-expanded="true"/)
    // Aucun champ de texte tant que rien n'est déplié.
    expect(html).not.toContain("<textarea")
  })

  test("une ligne repliée dit quand même qu'un email est coupé", () => {
    // Fermé par défaut ne veut pas dire muet : c'est l'un des deux états
    // qui expliquent pourquoi quelque chose n'arrive pas.
    const html = renderToStaticMarkup(
      <ListeEmails
        emails={[ligne("leadNotification", { actif: false })]}
        onToggle={() => {}}
      />
    )
    expect(html).not.toMatch(/aria-expanded="true"/)
    expect(html).toMatch(/coupé/i)
  })

  test("une ligne repliée dit quand même qu'un texte a été personnalisé", () => {
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
    expect(personnalise).toMatch(/personnalisé/i)
  })

  test("et ne dit RIEN quand le texte est celui du code", () => {
    // L'état normal de tout déploiement neuf. Une pastille « Texte par
    // défaut » sur chacune des trois lignes se relit en entier pour
    // apprendre qu'il ne s'est rien passé ; c'est l'absence de pastille qui
    // porte cette information, gratuitement.
    const parDefaut = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    expect(parDefaut).not.toMatch(/par défaut/i)
    expect(parDefaut).not.toMatch(/personnalisé/i)
  })

  test("un texte enregistré devenu invalide est signalé sans déplier", () => {
    // Le scénario de `emails.gabaritPour` : le catalogue gagne une
    // variable obligatoire, les gabarits écrits avant ne l'ont pas. Ils
    // sont écartés à la lecture — l'envoi continue avec le texte du code —
    // et l'écran est le seul endroit qui puisse le dire. Le cacher
    // derrière un clic ferait de l'accordéon un endroit où l'on range les
    // pannes.
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
    expect(html).not.toMatch(/aria-expanded="true"/)
    expect(html).toContain("ancienne")
    expect(html).toMatch(/écarté/i)
  })

  test("l'interrupteur d'un email non désactivable est inerte", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={[INVITATION]} onToggle={() => {}} />
    )
    // `aria-disabled="true"` et non un simple `/disabled/` : les classes
    // Tailwind des boutons portent `disabled:pointer-events-none`, si bien
    // qu'une recherche du mot seul passe sur n'importe quel rendu et ne
    // vérifie rien du tout.
    expect(html).toMatch(/aria-disabled="true"/)
    expect(html).toMatch(/toujours actif/i)
  })

  test("chaque email verrouillé le montre, sans plaider sa cause", () => {
    // Le catalogue peut en compter d'autres un jour : la boucle vaut pour
    // tous. Ce qu'un email verrouillé doit rendre, c'est son ÉTAT — un
    // interrupteur qui ne bouge pas, et de quoi voir que c'est voulu. La
    // justification, elle, s'adresse au développeur qui voudrait rendre
    // l'interrupteur actif : elle vit sur `raisonNonDesactivable`, à côté
    // du code qui l'applique.
    const verrouilles = CATALOGUE.filter((email) => !email.desactivable)
    expect(verrouilles.length).toBeGreaterThan(0)
    for (const description of verrouilles) {
      const html = renderToStaticMarkup(
        <ListeEmails emails={[ligne(description.cle)]} onToggle={() => {}} />
      )
      expect(html, description.cle).toMatch(/aria-disabled="true"/)
      expect(html, description.cle).toMatch(/toujours actif/i)
      // Ni la démonstration du catalogue, ni la phrase courte qui la
      // résumait. Les deux plaidaient une décision que cet écran ne permet
      // pas de défaire.
      const longue = description.raisonNonDesactivable ?? ""
      expect(longue.length, description.cle).toBeGreaterThan(120)
      expect(html, description.cle).not.toContain(echappe(longue.slice(0, 60)))
      expect(html, description.cle).not.toMatch(/sans lui,/i)
      // Et pas déplacée dans un attribut au passage : une raison dans un
      // `title=` n'existe ni au clavier, ni au doigt.
      expect(html, description.cle).not.toMatch(/title="/i)
    }
  })

  test("un email désactivable, lui, garde un interrupteur vivant", () => {
    const html = renderToStaticMarkup(
      <ListeEmails emails={[NOTIFICATION]} onToggle={() => {}} />
    )
    // La seule ligne rendue est celle qui se coupe : ni l'interrupteur ni
    // sa case cachée ne sont inertes.
    expect(html).not.toMatch(/aria-disabled="true"/)
    expect(html).not.toMatch(/<input[^>]*\sdisabled/)
  })

  test("le titre porte l'email à lui seul, replié comme déplié", () => {
    // `quand` et `destinataire` sont sortis de l'écran : deux phrases par
    // email, six pour trois lignes, qui redisaient ce que le titre dit
    // déjà. Ils restent dans `LigneEmail` — `validationLocale` reconstruit
    // une `DescriptionEmail` avec — mais rien ne les rend. Si un titre
    // cesse un jour de suffire, c'est le TITRE qu'on réécrit, dans le
    // catalogue.
    const panneau = (email: EmailAffiche) => (
      <EditeurGabarit
        email={email}
        objet={email.objet}
        corps={email.corps}
        erreur={null}
      />
    )
    const repliee = renderToStaticMarkup(
      <ListeEmails emails={LISTE} onToggle={() => {}} />
    )
    const depliee = renderToStaticMarkup(
      <ListeEmails
        emails={LISTE}
        onToggle={() => {}}
        cleOuverte="leadNotification"
        editeur={panneau}
      />
    )

    for (const email of LISTE) {
      expect(repliee).toContain(echappe(email.titre))
      expect(depliee).toContain(echappe(email.titre))
      for (const html of [repliee, depliee]) {
        expect(html, email.cle).not.toContain(echappe(email.quand.slice(0, 40)))
        expect(html, email.cle).not.toContain(
          echappe(email.destinataire.slice(0, 40))
        )
      }
    }
  })

  test("la ligne dépliée est celle qu'on a ouverte, et elle seule", () => {
    const html = renderToStaticMarkup(
      <ListeEmails
        emails={LISTE}
        onToggle={() => {}}
        cleOuverte="leadNotification"
        editeur={() => <p>panneau ouvert</p>}
      />
    )
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(1)
    expect(html.match(/panneau ouvert/g)?.length).toBe(1)
  })
})

// ---------------------------------------------------------------------
// Le repli : la seconde porte par laquelle un texte se perd
// ---------------------------------------------------------------------

describe("actionSurLigne", () => {
  test("rien d'ouvert : un clic déplie", () => {
    expect(
      actionSurLigne({ ouverte: null, cible: "invitation", modifie: false })
    ).toBe("ouvrir")
  })

  test("cliquer la ligne ouverte la replie", () => {
    expect(
      actionSurLigne({
        ouverte: "invitation",
        cible: "invitation",
        modifie: false,
      })
    ).toBe("replier")
  })

  test("cliquer une autre ligne la déplie à la place", () => {
    // Une seule à la fois : deux textes ouverts côte à côte, avec un
    // bouton d'enregistrement chacun, est la forme la plus sûre de perdre
    // l'un des deux.
    expect(
      actionSurLigne({
        ouverte: "invitation",
        cible: "leadNotification",
        modifie: false,
      })
    ).toBe("ouvrir")
  })

  test("REPLIER un texte modifié passe par une question", () => {
    // Le défaut que l'accordéon rouvrait : `useUnsavedChangesGuard` ne
    // bloque que la navigation, et replier ne traverse aucun routeur.
    expect(
      actionSurLigne({
        ouverte: "invitation",
        cible: "invitation",
        modifie: true,
      })
    ).toBe("confirmer")
  })

  test("en ouvrir une autre avec un texte modifié aussi", () => {
    // Le même texte se perd, par l'autre bout du même geste.
    expect(
      actionSurLigne({
        ouverte: "invitation",
        cible: "passwordReset",
        modifie: true,
      })
    ).toBe("confirmer")
  })

  test("la question se pose depuis le même signal que le garde-fou de sortie", () => {
    // Une seconde règle « ce texte a-t-il changé ? » écrite ici
    // divergerait de `gabaritEnCoursModifie` à la première retouche, et
    // l'une des deux portes se rouvrirait sans que rien ne le dise.
    const modifie = gabaritEnCoursModifie(INVITATION, "Autre objet", INVITATION.corps)
    expect(modifie).toBe(true)
    expect(
      actionSurLigne({ ouverte: "invitation", cible: "invitation", modifie })
    ).toBe("confirmer")

    const intact = gabaritEnCoursModifie(
      INVITATION,
      INVITATION.objet,
      INVITATION.corps
    )
    expect(intact).toBe(false)
    expect(
      actionSurLigne({ ouverte: "invitation", cible: "invitation", modifie: intact })
    ).toBe("replier")
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

  test("TOUTES les variables du catalogue sont là, pour chaque email", () => {
    // Ce que l'écran n'affiche pas, personne ne le devine : `rendreTexte`
    // remplace par la chaîne vide un `{{quelquechose}}` qui n'existe pas,
    // et `validerGabarit` refuse à l'enregistrement ce qui n'est pas dans
    // cette liste. La boucle part du CATALOGUE, pas d'une copie : une
    // variable ajoutée là-bas et oubliée ici échoue ce test.
    for (const description of CATALOGUE) {
      const email = ligne(description.cle)
      const html = renderToStaticMarkup(
        <EditeurGabarit email={email} objet="o" corps="c" erreur={null} />
      )
      expect(description.variables.length, description.cle).toBeGreaterThan(0)
      for (const nom of description.variables) {
        expect(html, `${description.cle} / ${nom}`).toContain(`{{${nom}}}`)
      }
    }
  })

  test("les obligatoires se distinguent des autres", () => {
    // Les perdre est le seul refus qu'on ne voit pas venir en tapant : un
    // gabarit d'invitation sans `{{lien}}` a l'air fini, et c'est le
    // serveur qui le refuse. La distinction est visuelle (pastille pleine
    // et astérisque) ET dite au nom accessible — un lecteur d'écran qui
    // annonce « lien étoile » n'apprend rien à personne.
    const html = renderToStaticMarkup(
      <EditeurGabarit
        email={INVITATION}
        objet="o"
        corps="c"
        erreur={null}
        onCorps={() => {}}
      />
    )
    expect(INVITATION.variablesObligatoires).toContain("lien")
    expect(html).toMatch(/aria-label="\{\{lien\}\}, obligatoire"/)
    expect(html).toMatch(/obligatoire/)

    // Un email sans aucune obligatoire ne porte pas de légende qui ne
    // désignerait rien.
    const sansObligatoire = renderToStaticMarkup(
      <EditeurGabarit email={NOTIFICATION} objet="o" corps="c" erreur={null} />
    )
    expect(NOTIFICATION.variablesObligatoires).toHaveLength(0)
    expect(sansObligatoire).not.toMatch(/obligatoire/)
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
    // (`lib/gabarit.ts`, `CARACTERE_INTERDIT_DANS_OBJET`). La règle n'est
    // plus écrite sous le champ — elle s'affiche quand elle est enfreinte,
    // par `validationLocale`.
    const html = renderToStaticMarkup(
      <EditeurGabarit email={NOTIFICATION} objet="o" corps="c" erreur={null} />
    )
    expect(html).toContain("<textarea")
    expect(html).toMatch(/<input[^>]*type="text"/)
    expect(validationLocale(NOTIFICATION, "A\nB", "corps")).toMatch(
      /une seule ligne/i
    )
  })

  test("un texte modifié le dit, sous les boutons qui l'enregistrent", () => {
    const html = renderToStaticMarkup(
      <EditeurGabarit
        email={NOTIFICATION}
        objet="Un autre objet"
        corps={NOTIFICATION.corps}
        erreur={null}
        modifie
      />
    )
    expect(html).toMatch(/non enregistrées/i)
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
// Le signal partagé par les deux garde-fous — voir le commentaire de
// `ListeEmailsConnectee` dans `routes/_authed/settings/emails.tsx`. C'est
// CETTE fonction qui nourrit « Modifications non enregistrées » sous
// l'éditeur, le `dirty` du garde-fou de navigation
// (`useUnsavedChangesGuard`) ET la question posée avant de replier
// (`actionSurLigne`). Si elle cesse de détecter une frappe non
// enregistrée, les deux portes se rouvrent en même temps — d'où des tests
// sur le COMPORTEMENT (des textes qui divergent, ou pas), pas sur son
// existence.
// ---------------------------------------------------------------------

describe("gabaritEnCoursModifie", () => {
  test("aucune ligne dépliée : rien n'est en cours, rien n'est modifié", () => {
    expect(gabaritEnCoursModifie(null, "peu importe", "peu importe")).toBe(false)
  })

  test("le texte affiché à l'ouverture n'est pas déjà une modification", () => {
    // L'éditeur s'ouvre sur `enregistre ?? défaut` — si cette même valeur
    // ressortait « modifiée », replier la ligne qu'on vient d'ouvrir
    // poserait une question sans objet.
    expect(
      gabaritEnCoursModifie(INVITATION, INVITATION.objet, INVITATION.corps)
    ).toBe(false)
  })

  test("un objet retouché arme les deux garde-fous", () => {
    expect(
      gabaritEnCoursModifie(INVITATION, "Un nouvel objet", INVITATION.corps)
    ).toBe(true)
  })

  test("un corps retouché aussi", () => {
    expect(
      gabaritEnCoursModifie(INVITATION, INVITATION.objet, "Un nouveau corps")
    ).toBe(true)
  })

  test("un texte tapé puis reproduit à l'identique les désarme", () => {
    // Le scénario qui compte le plus : écrire, se raviser, retaper
    // exactement le texte de départ. Rien à perdre — ni la sortie ni le
    // repli ne doivent plus être retenus.
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
    // le garde-fou sur une ligne qu'on vient d'ouvrir sans y toucher.
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
    // La régression que cet écran a refermée : `/settings/domaine` a été
    // réécrit sans reprendre `RESEND_API_KEY`, qui ne se posait donc plus
    // que par `npx convex run` ou par l'environnement.
    const html = renderToStaticMarkup(<SectionCleResend secrets={bloc()} />)
    expect(html).toContain("secret-RESEND_API_KEY")
  })

  test("le champ dit où l'on fabrique la clé qu'il demande", () => {
    // Sans ce lien, la personne qui vient d'installer ce template a un
    // champ vide et aucune idée d'où sortir ce qu'on lui demande d'y
    // coller. Un lien, pas une phrase : son texte EST l'adresse.
    const html = renderToStaticMarkup(<SectionCleResend secrets={bloc()} />)
    expect(html).toContain('href="https://resend.com/api-keys"')
    expect(html).toContain('target="_blank"')
    // `noopener noreferrer` comme les autres liens sortants du dépôt : la
    // page ouverte ne doit garder aucune prise sur le dashboard.
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test("jamais en clair, jamais pré-remplie", () => {
    const html = renderToStaticMarkup(<SectionCleResend secrets={bloc()} />)
    for (const champ of html.match(/<input[^>]*>/g) ?? []) {
      expect(champ, champ).toContain('type="password"')
      expect(champ, champ).not.toMatch(/value="[^"]+"/)
    }
  })

  test("saisie impossible : on le dit, plutôt que de laisser un cadre vide", () => {
    // Sans clé maîtresse, le serveur refuserait l'écriture et
    // `ChampSecret` masque le champ. La commande qui la pose s'adresse à
    // qui a un terminal : elle est dans `docker/README.md`, pas ici.
    const html = renderToStaticMarkup(
      <SectionCleResend secrets={bloc({ cleMaitresse: "absente" })} />
    )
    expect(html).not.toContain("secret-RESEND_API_KEY")
    expect(html).toMatch(/pas disponible/i)
  })

  test("un editor lit une phrase, pas un cadre vide", () => {
    const html = renderToStaticMarkup(
      <SectionCleResend
        secrets={bloc({ cleMaitresse: null, canWrite: false })}
      />
    )
    expect(html).not.toContain("<input")
    expect(html).toMatch(/propriétaire et aux administrateurs/i)
  })
})

describe("ChampAdresseExpedition", () => {
  test("le format attendu est dans le champ, pas dans un paragraphe", () => {
    // On ne devine pas `Nom <adresse@domaine.fr>`, et un placeholder se lit
    // au moment où l'on écrit — sans prendre de ligne le reste du temps.
    const html = renderToStaticMarkup(<ChampAdresseExpedition valeur="" />)
    expect(html).toMatch(/placeholder="[^"]*votredomaine\.fr/)
  })

  test("une adresse posée renvoie vers la vérification du domaine", () => {
    // Sans domaine vérifié chez Resend, l'envoi échoue sans que rien ne
    // dise pourquoi : c'est l'une des deux seules aides que cet écran garde.
    const html = renderToStaticMarkup(
      <ChampAdresseExpedition
        valeur="Nom <bonjour@exemple.fr>"
        lienDomaine={<a href="/settings/domaine">Domaine</a>}
      />
    )
    expect(html).toMatch(/vérifié chez Resend/i)
    expect(html).toContain('href="/settings/domaine"')
  })

  test("champ vide : l'écran nomme l'expéditeur qui sert à la place", () => {
    // C'est un ÉTAT, celui du champ tel qu'il est. Le bac à sable de Resend
    // ne délivre qu'aux adresses de test du compte — sans cette ligne, on
    // ne le découvre que par ses destinataires, c'est-à-dire jamais.
    const html = renderToStaticMarkup(<ChampAdresseExpedition valeur="" />)
    expect(html).toContain("onboarding@resend.dev")
  })

  test("une adresse mal formée est signalée avant d'être envoyée", () => {
    const html = renderToStaticMarkup(
      <ChampAdresseExpedition valeur="pas une adresse" />
    )
    expect(html).toMatch(/adresse/i)
    expect(html).toContain('role="alert"')
  })
})
