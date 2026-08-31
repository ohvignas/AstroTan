import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ChevronRightIcon, ExternalLinkIcon, LockIcon } from "lucide-react"
import type {
  CleEmail,
  DescriptionEmail,
} from "@astrotan/backend/convex/lib/catalogueEmails"
import type { LigneEmail } from "@astrotan/backend/convex/emails"
import {
  MAX_CORPS,
  MAX_OBJET,
  validerGabarit,
} from "@astrotan/backend/convex/lib/gabarit"
import {
  EXPEDITEUR_BAC_A_SABLE,
  estAdresseValide,
} from "@astrotan/backend/convex/lib/expediteur"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { SettingsGroup } from "@/components/settings-nav"
import { ChampSecret } from "@/components/settings-environment"
import type { SecretsBloc } from "@/components/settings-environment"

// ---------------------------------------------------------------------
// L'écran « Envoi des emails », en pièces rendues sans Convex.
//
// CE QUE CET ÉCRAN NE FAIT PAS : expliquer.
//
// Il s'adresse à quelqu'un qui vient d'installer ce template et veut que
// ses emails partent. Cette personne n'est pas développeuse, n'ouvrira
// jamais `convex/lib/resend.ts`, et n'a aucune décision à prendre à partir
// de ce qu'elle y lirait. Trois formes sont donc admises à l'écran, et
// rien d'autre :
//
//   • un ÉTAT — « Absent », « Personnalisé » ;
//   • une ÉTIQUETTE — « Clé Resend », « Adresse d'expédition » ;
//   • une ACTION — « Enregistrer », « Modifier le texte ».
//
// Un ÉTAT est ce qui s'écarte de la normale. « Par défaut » est la normale
// de tout déploiement neuf : la pastille ne s'affiche donc que quand un
// texte a été personnalisé. Nommer la normalité trois fois de suite dans
// une liste de trois lignes n'ajoute rien à ce que l'absence de pastille
// dit déjà.
//
// Une phrase qui n'est aucun des trois est un commentaire de code qui a
// fui dans l'interface. Elle redescend ici. La version précédente de cet
// écran faisait 1 066 lignes pour poser une clé et une adresse ; l'essentiel
// de ce volume était de la documentation d'architecture affichée à
// quelqu'un qui n'en a pas l'usage.
//
// CE QUI A ÉTÉ RETIRÉ DE L'ÉCRAN, ET QUI EST VRAI QUAND MÊME :
//
//   • `RESEND_TEST_MODE` — tant qu'elle ne vaut pas exactement `"false"`,
//     Resend ACCEPTE chaque envoi (code 200, identifiant de message, aucune
//     erreur) et ne le délivre à personne. C'est la valeur par DÉFAUT, donc
//     la panne atteint chaque adoptant, une fois, au pire moment. Elle est
//     lue dans le constructeur du client Resend : elle ne se règle que dans
//     l'environnement Convex, jamais depuis un champ. L'écran n'en dit plus
//     rien du tout — ni la variable, ni sa conséquence : retrait demandé
//     après explication du risque (le mode d'essai est le défaut de tout
//     déploiement neuf, et rien à l'écran ne le signale plus). `EtatEnvoi`,
//     qui portait cette ligne et celle de la clé Resend absente, a disparu
//     avec elle ;
//   • la PRÉCÉDENCE environnement / base — `convex/lib/resend.ts` construit
//     son client via le lecteur unique `secrets.lireSecret`, qui préfère la
//     variable d'environnement quand elle existe et retombe sinon sur la
//     valeur saisie ici, une fois déchiffrée. La seule occurrence où cette
//     règle change ce que quelqu'un doit faire — les deux valeurs existent,
//     et c'est l'environnement qui sert — est déjà dite par `SecretField`,
//     au moment où elle se produit. Le reste était une leçon ;
//   • le chiffrement — un jeton saisi ici est chiffré (AES-GCM) sous
//     `SECRETS_KEY`, qui vit dans l'environnement Convex. Rassurant, sans
//     conséquence sur un geste. Voir `convex/secrets.ts` ;
//   • `SITE_URL` — l'origine du dashboard, donc celle des liens contenus
//     DANS les emails (celui d'une invitation, le « répondre depuis le
//     dashboard » d'une notification). Lue au chargement des modules Convex
//     (`baseURL` de Better Auth), jamais au moment de l'usage : une valeur
//     saisie à l'écran arriverait toujours trop tard. Elle ne se réglait
//     donc pas ici, et un bloc qui n'est qu'explication et commande n'a pas
//     sa place sur un écran de réglages. Voir la réserve du rapport ;
//   • les COMMANDES shell. Un `npx convex env set …` affiché dans un
//     dashboard dit à la personne qui le lit que l'écran ne sait pas faire
//     son travail. Elles vivent dans `docker/README.md` ;
//   • la JUSTIFICATION d'un email verrouillé — « Sans lui, personne ne peut
//     créer de compte. », « Sans lui, un mot de passe perdu ne se récupère
//     plus. ». Deux phrases qui plaidaient une décision déjà prise, et que
//     personne ne peut défaire depuis cet écran. Le cadenas et la mention
//     « Toujours actif » disent le FAIT, qui est tout ce dont un geste
//     dépend ; le raisonnement reste sur `raisonNonDesactivable`
//     (`lib/catalogueEmails.ts`), à côté du code qui l'applique ;
//   • `quand` et `destinataire` — les blocs « Part … » / « Vers … » du
//     panneau déplié. Deux phrases par email, soit six pour trois lignes,
//     qui redisaient ce que le titre porte déjà : une invitation part à qui
//     l'on invite, une notification de contact arrive à l'équipe, une
//     réinitialisation va à qui l'a demandée. Ils restent dans le catalogue
//     et dans `LigneEmail` — `validationLocale` en a besoin pour
//     reconstruire une `DescriptionEmail` — mais l'écran ne les rend plus.
//     Si un jour un titre ne suffit plus, c'est le TITRE qu'il faut réécrire
//     (dans le catalogue), pas ces blocs qu'il faut ressusciter.
//
// Deux raisons de tout garder présentatif — queries et mutations restent
// dans `routes/_authed/settings/emails.tsx` :
//
//   • `vitest.config.ts` est en `environment: "node"` et rend avec
//     `renderToStaticMarkup`. Un composant qui appelle `useQuery` exigerait
//     un client Convex, donc un harnais, pour vérifier une phrase ;
//   • les exigences non négociables de cet écran sont toutes des exigences
//     de RENDU — une raison affichée et non masquée, un état et non un
//     paragraphe, un refus montré avant le clic. Elles se testent là où
//     elles vivent.
// ---------------------------------------------------------------------

/** Une ligne de `emails.list` : le catalogue, plus ce qu'on en a fait. */
export type EmailAffiche = LigneEmail

/**
 * La règle du serveur, appelée avant l'enregistrement.
 *
 * `validerGabarit` vit dans `convex/lib/gabarit.ts` et son commentaire
 * annonce déjà ses deux appelants : « la mutation qui enregistre et
 * l'écran qui prévient avant d'enregistrer ». C'est le second. La
 * réécrire ici en ferait deux règles, et l'écran finirait par promettre
 * ce que le serveur refuse — ou l'inverse, plus vicieux : refuser ce que
 * le serveur accepte, sans qu'aucun test ne s'en aperçoive.
 *
 * L'adaptation est mécanique : `LigneEmail` porte déjà tous les champs de
 * `DescriptionEmail`, à ceci près que `raisonNonDesactivable` y est
 * `null` là où le catalogue la laisse `undefined`.
 */
export function validationLocale(
  email: EmailAffiche,
  objet: string,
  corps: string,
): string | null {
  const description: DescriptionEmail = {
    cle: email.cle,
    titre: email.titre,
    quand: email.quand,
    destinataire: email.destinataire,
    desactivable: email.desactivable,
    ...(email.raisonNonDesactivable === null
      ? {}
      : { raisonNonDesactivable: email.raisonNonDesactivable }),
    variables: email.variables,
    variablesObligatoires: email.variablesObligatoires,
    objetParDefaut: email.objetParDefaut,
    corpsParDefaut: email.corpsParDefaut,
  }
  return validerGabarit(description, objet, corps)
}

/**
 * Le texte en cours d'édition diverge-t-il de ce qui est enregistré ?
 *
 * C'EST le signal qui manquait : la barre d'enregistrement de la page
 * (`SettingsFormShell`) ne surveille que `emailFrom`, jamais ce champ-ci —
 * les deux vivent dans des composants différents et s'écrivent par deux
 * mutations différentes (`settings.update` contre `emails.setTemplate`).
 *
 * Elle nourrit maintenant TROIS choses, et c'est la raison de l'extraction :
 * la mention « Modifications non enregistrées » sous l'éditeur, le
 * garde-fou de navigation (`useUnsavedChangesGuard`), et `actionSurLigne`
 * ci-dessous — le repli de l'accordéon. Une seule règle, jamais trois qui
 * pourraient diverger.
 *
 * `email` à `null` quand aucune ligne n'est dépliée : rien n'est en cours
 * d'édition, donc rien n'est modifié.
 */
export function gabaritEnCoursModifie(
  email: EmailAffiche | null,
  objet: string,
  corps: string,
): boolean {
  if (email === null) return false
  return (
    objet !== (email.enregistre?.objet ?? email.objet) ||
    corps !== (email.enregistre?.corps ?? email.corps)
  )
}

/**
 * Ce qu'un clic sur une ligne de l'accordéon doit déclencher.
 *
 * POURQUOI CETTE FONCTION EXISTE : replier une ligne dont le texte vient
 * d'être retouché la perd, et ce geste ne passe par aucun blocage de
 * routeur. Le garde-fou de sortie ne gardait que la navigation ; l'accordéon
 * a ouvert une seconde porte sur exactement le même défaut. Les deux
 * lisent maintenant le même `gabaritEnCoursModifie`.
 *
 * Extraite plutôt qu'écrite en ligne dans le gestionnaire de clic parce
 * que c'est la seule partie du dispositif qui soit testable ici :
 * `vitest.config.ts` est en `environment: "node"`, on ne peut pas cliquer.
 * Une règle qu'aucun test ne tient est une règle qui se perd à la
 * prochaine retouche — et celle-ci se perd en silence, comme le texte
 * qu'elle protège.
 */
export type ActionLigne = "ouvrir" | "replier" | "confirmer"

export function actionSurLigne({
  ouverte,
  cible,
  modifie,
}: {
  /** La ligne dépliée, ou `null`. */
  ouverte: string | null
  /** Celle sur laquelle on vient de cliquer. */
  cible: string
  /** `gabaritEnCoursModifie` du texte en cours. */
  modifie: boolean
}): ActionLigne {
  // Modifié : peu importe la cible. Replier perd le texte, en ouvrir une
  // autre aussi — les deux passent par la question.
  if (modifie) return "confirmer"
  return ouverte === cible ? "replier" : "ouvrir"
}

// ---------------------------------------------------------------------
// La clé, et l'adresse d'expédition
//
// `EtatEnvoi` vivait juste au-dessus : « Mode d'essai — aucun email n'est
// délivré. » et « Aucune clé Resend — rien ne part. », retirées sur
// décision explicite — prise après avoir dit que plus rien, ensuite, ne
// signalerait le mode d'essai, qui est pourtant le défaut de tout
// déploiement neuf. Voir le rapport de retrait. `cleResendAbsente` (calcul
// de la seconde ligne) est parti avec elle, dans
// `routes/_authed/settings/emails.tsx`.
// ---------------------------------------------------------------------

/**
 * `RESEND_API_KEY` — la seule interface de saisie de cette clé du dépôt.
 *
 * Aucune PHRASE sous le champ : le titre du groupe traduit le nom
 * technique, et la pastille de `SecretField` donne l'état. Une explication
 * de plus ici ne dirait qu'une seconde fois la même chose.
 *
 * Un LIEN, en revanche, fait quelque chose qu'aucune de ces trois ne fait :
 * il mène à l'endroit où la clé se fabrique. Sans lui, la personne qui
 * vient d'installer ce template a un champ vide et aucune idée d'où sortir
 * ce qu'on lui demande d'y coller — elle quitte le dashboard pour chercher.
 * Son texte est l'URL elle-même : c'est la forme la plus courte qui dise
 * déjà où l'on va.
 */
export function SectionCleResend({
  secrets,
}: {
  secrets: SecretsBloc
}) {
  if (secrets.cleMaitresse === null) {
    return (
      <SettingsGroup title="Clé Resend">
        <p className="text-sm text-muted-foreground">
          Réservée au propriétaire et aux administrateurs.
        </p>
      </SettingsGroup>
    )
  }
  return (
    <SettingsGroup title="Clé Resend">
      {/* Sans clé maîtresse, `ChampSecret` masque le champ (le serveur
          refuserait l'écriture). Sans cette ligne, il ne resterait qu'un
          cadre vide. La commande qui la pose est dans `docker/README.md` :
          elle s'adresse à qui a un terminal, pas à qui a ce dashboard. */}
      {secrets.cleMaitresse === "posee" ? null : (
        <p className="text-sm text-destructive">
          La saisie n&apos;est pas disponible sur ce déploiement.
        </p>
      )}
      <ChampSecret
        bloc={secrets}
        nom="RESEND_API_KEY"
        // Ce que la confirmation de retrait doit dire, et que rien
        // d'autre sur cet écran ne dit : sans cette clé, plus AUCUN email
        // ne part — pas seulement les notifications, aussi les invitations
        // à rejoindre l'administration et les réinitialisations de mot de
        // passe. Un déploiement dont on retire la clé se ferme.
        consequence="Plus aucun email ne part du site : ni les notifications de contact, ni les invitations à rejoindre l'administration, ni les réinitialisations de mot de passe."
      >
        {/* `target="_blank"` : on ne quitte pas un écran de réglages où une
            adresse est peut-être en cours de saisie. `noopener noreferrer`
            comme les autres liens sortants du dépôt (`nav-main.tsx`,
            `site-dashboard.tsx`) — la page ouverte ne doit pas garder de
            prise sur celle-ci. */}
        <a
          href="https://resend.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          resend.com/api-keys
          <ExternalLinkIcon aria-hidden="true" className="size-3" />
        </a>
      </ChampSecret>
    </SettingsGroup>
  )
}

/**
 * L'adresse d'expédition — le seul champ de ce dépôt qui règle
 * `settings.emailFrom`.
 *
 * Elle ne s'enregistre pas toute seule, et c'est le même raisonnement
 * qu'`/settings/webhook` : `bonjour@exemple.f` est une saisie en route
 * vers `bonjour@exemple.fr`, et enregistrée ne serait-ce qu'une seconde
 * elle devient l'expéditeur de tout ce qui part pendant cette seconde.
 * La barre d'enregistrement l'attend donc au clic (`SettingsFormShell`).
 *
 * Deux phrases seulement sous le champ, et chacune tient parce qu'on
 * resterait bloqué sans elle :
 *
 *   • le domaine doit être vérifié chez Resend, sinon l'envoi échoue sans
 *     que rien ne dise pourquoi ;
 *   • champ vide, l'expéditeur devient le bac à sable de Resend, qui ne
 *     délivre qu'aux adresses de test du compte. C'est un ÉTAT — celui du
 *     champ tel qu'il est en ce moment — et sans lui on ne le découvre que
 *     par ses destinataires, c'est-à-dire jamais.
 *
 * Le format attendu est dans le placeholder plutôt que sous le champ : il
 * y est lu au moment où on écrit, et il ne prend pas de ligne.
 */
export function ChampAdresseExpedition({
  valeur,
  onChange,
  canWrite = true,
  /** Vers `/settings/domaine`, qui sait vérifier les enregistrements DNS. */
  lienDomaine,
}: {
  valeur: string
  onChange?: (valeur: string) => void
  canWrite?: boolean
  lienDomaine?: ReactNode
}) {
  const saisie = valeur.trim()
  // Le serveur refuse déjà (`INVALID_EMAIL_FROM`) avec la MÊME fonction :
  // ce contrôle-ci ne décide de rien, il nomme la faute avant le clic.
  const invalide = saisie.length > 0 && !estAdresseValide(saisie)

  return (
    <Field>
      <FieldLabel htmlFor="email-from">Adresse d&apos;expédition</FieldLabel>
      <Input
        id="email-from"
        type="text"
        placeholder="Nom <adresse@votredomaine.fr>"
        value={valeur}
        disabled={!canWrite}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {saisie.length === 0 ? (
        <FieldDescription>
          Vide : les emails partent de{" "}
          <code className="text-xs">{EXPEDITEUR_BAC_A_SABLE}</code>, qui ne
          délivre qu&apos;aux adresses de test de votre compte Resend.
        </FieldDescription>
      ) : (
        <FieldDescription>
          Le domaine doit être vérifié chez Resend —{" "}
          {lienDomaine ?? <>voir Domaine &amp; DNS</>}.
        </FieldDescription>
      )}
      {invalide ? (
        <p role="alert" className="text-sm text-destructive">
          Ce n&apos;est pas une adresse.
        </p>
      ) : null}
    </Field>
  )
}

// ---------------------------------------------------------------------
// La liste : un accordéon, replié à l'arrivée
// ---------------------------------------------------------------------

/**
 * Une ligne par email du catalogue, repliée.
 *
 * REPLIÉE À L'ARRIVÉE, et c'est le cœur de la refonte : on ne vient
 * presque jamais ici pour réécrire un texte, on vient pour vérifier que
 * l'envoi peut partir. Les trois emails tiennent alors dans un coup d'œil,
 * et on les lit les uns par rapport aux autres — voir que celui du dessus
 * est coupé pendant qu'on modifie celui du dessous est précisément ce
 * qu'un panneau latéral aurait empêché.
 *
 * CE QUI RESTE LISIBLE SANS DÉPLIER : qu'un email est coupé, qu'un texte a
 * été personnalisé, et qu'un texte enregistré a été écarté. Ce sont les
 * trois états qui expliquent pourquoi quelque chose n'arrive pas ; les
 * cacher derrière un clic ferait de l'accordéon un endroit où l'on range
 * les pannes.
 *
 * Chacun des trois ne s'affiche QUE quand il tient : un déploiement neuf
 * montre donc trois titres, deux cadenas et un interrupteur, et rien
 * d'autre. « Par défaut », « aucun problème » et « actif » sont l'état
 * normal, et une liste qui les nomme est une liste qu'on relit en entier
 * pour découvrir qu'il ne s'y passe rien.
 *
 * Un `<button>` et un rendu conditionnel plutôt qu'un composant
 * d'accordéon : l'ouverture est décidée par la route (une seule à la fois,
 * et un texte modifié pose une question avant de replier — voir
 * `actionSurLigne`). Un accordéon piloté de l'extérieur avec une ouverture
 * annulable revient à réécrire la même logique par-dessus la sienne, et
 * son panneau ne se rend pas en `renderToStaticMarkup` — ces tests-ci ne
 * verraient plus rien.
 */
export function ListeEmails({
  emails,
  onToggle,
  onModifier,
  canWrite = true,
  cleOuverte = null,
  /** L'éditeur du gabarit déplié, rendu dans sa propre ligne. */
  editeur,
}: {
  emails: readonly EmailAffiche[]
  onToggle: (cle: CleEmail, actif: boolean) => void
  onModifier?: (cle: CleEmail) => void
  canWrite?: boolean
  cleOuverte?: CleEmail | null
  editeur?: (email: EmailAffiche) => ReactNode
}) {
  return (
    <ul className="divide-y divide-foreground/10">
      {emails.map((email) => (
        <LigneEmailAffichee
          key={email.cle}
          email={email}
          onToggle={onToggle}
          onModifier={onModifier}
          canWrite={canWrite}
          ouvert={cleOuverte === email.cle}
          editeur={editeur}
        />
      ))}
    </ul>
  )
}

function LigneEmailAffichee({
  email,
  onToggle,
  onModifier,
  canWrite,
  ouvert,
  editeur,
}: {
  email: EmailAffiche
  onToggle: (cle: CleEmail, actif: boolean) => void
  onModifier?: (cle: CleEmail) => void
  canWrite: boolean
  ouvert: boolean
  editeur?: (email: EmailAffiche) => ReactNode
}) {
  const panneauId = `gabarit-${email.cle}`
  const interrupteurId = `email-actif-${email.cle}`

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
        {/* Le titre EST le bouton de dépliage : la cible est large, et
            l'interrupteur reste dehors — un contrôle dans un bouton n'est
            ni cliquable ni annonçable correctement. */}
        {/* `w-full` en dessous de `sm` : le titre prend sa ligne, la
            pastille et l'interrupteur passent dessous. Partagée, la ligne
            coupait « Invitation à rejoindre l'administration » en trois
            morceaux autour d'une pastille. */}
        <button
          type="button"
          aria-expanded={ouvert}
          aria-controls={panneauId}
          disabled={!canWrite}
          onClick={() => onModifier?.(email.cle)}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default sm:w-auto sm:flex-1"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
              ouvert ? "rotate-90" : ""
            }`}
          />
          <span className="font-heading text-sm leading-snug font-medium">
            {email.titre}
          </span>
        </button>

        <div className="flex w-full items-center gap-3 pl-6 sm:w-auto sm:pl-0">
          {/* Rien quand le texte est celui du code : c'est l'état de tout
              déploiement neuf, et une pastille par ligne pour dire « il ne
              s'est rien passé » se lit trois fois avant de ne rien
              apprendre. Ce qui compte est qu'un texte AIT ÉTÉ changé —
              c'est ce qui explique qu'un email ne ressemble plus à ce que
              le dépôt envoie. */}
          {email.personnalise ? <Badge variant="secondary">Personnalisé</Badge> : null}

          {email.desactivable ? (
            <label
              htmlFor={interrupteurId}
              className="flex shrink-0 cursor-pointer items-center gap-2 text-sm sm:ml-auto"
            >
              <span
                className={
                  email.actif ? "text-muted-foreground" : "text-destructive"
                }
              >
                {email.actif ? "Actif" : "Coupé"}
              </span>
              <Switch
                id={interrupteurId}
                checked={email.actif}
                disabled={!canWrite}
                onCheckedChange={(actif: boolean) => onToggle(email.cle, actif)}
              />
            </label>
          ) : (
            // Deux refus distincts, et le second n'est pas cosmétique :
            // `emails.setActif` LÈVE sur un email non désactivable, dans
            // les deux sens. L'interrupteur inerte n'est pas une politesse
            // d'interface, c'est la seule façon de ne pas proposer un geste
            // dont le serveur ne veut pas. Il reste affiché, en position
            // « actif » : le retirer ferait perdre l'information que
            // l'email, lui, part bien.
            //
            // Le cadenas remplace la phrase qui plaidait la décision. Il
            // dit la même chose de l'extérieur — ceci ne s'ouvre pas — sans
            // demander à personne de lire un argument sur un geste qui n'est
            // de toute façon pas proposé.
            <label
              htmlFor={interrupteurId}
              className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground sm:ml-auto"
            >
              <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>Toujours actif</span>
              <Switch id={interrupteurId} checked disabled />
            </label>
          )}
        </div>
      </div>

      {/* Un texte enregistré que la relecture a écarté. L'envoi n'échoue
          pas — `gabaritPour` repart du texte du code — et c'est
          précisément pour cela qu'il faut le dire ici : rien d'autre ne le
          dira. */}
      {email.probleme === null ? null : (
        <p role="alert" className="pb-2.5 pl-6 text-sm text-destructive">
          Texte enregistré écarté, le texte par défaut part à sa place :{" "}
          {email.probleme}
        </p>
      )}

      <div id={panneauId} hidden={!ouvert} className="pb-3">
        {ouvert && editeur ? editeur(email) : null}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------
// L'éditeur d'un gabarit, déplié dans sa ligne
// ---------------------------------------------------------------------

/**
 * Objet, corps, les variables, et le refus AVANT le clic.
 *
 * `erreur` est calculée par l'appelant avec `validationLocale` et affichée
 * à côté du champ. Le serveur refuse de toute façon (`setTemplate` valide
 * avant d'insérer), mais découvrir le refus après avoir cliqué fait perdre
 * le texte qu'on vient d'écrire — l'écran se recharge sur la valeur en
 * base, qui est l'ancienne.
 *
 * Le bouton d'enregistrement est inerte tant que le refus tient : proposer
 * un geste dont on sait déjà qu'il échouera n'est pas de la permissivité,
 * c'est un piège.
 *
 * LES VARIABLES SONT TOUTES LÀ, et c'est une exigence, pas une commodité :
 * `email.variables` est rendu en entier, sans tri ni sélection. Ce que
 * l'écran n'affiche pas, personne ne le devine — `rendreTexte` remplace
 * silencieusement par la chaîne vide un `{{quelquechose}}` qui n'existe
 * pas, et `validerGabarit` refuse à l'enregistrement ce qui n'est pas dans
 * cette liste. Elle fait autorité : elle vient du catalogue
 * (`lib/catalogueEmails.ts`), qui est aussi la liste que les trois envois
 * interpolent réellement.
 *
 * Les OBLIGATOIRES se distinguent — pastille pleine et astérisque — parce
 * que les perdre est le seul refus qu'on ne voit pas venir en tapant : un
 * gabarit d'invitation sans `{{lien}}` a l'air fini, et c'est le serveur
 * qui le refusera.
 */
export function EditeurGabarit({
  email,
  objet,
  corps,
  erreur,
  erreurServeur = null,
  modifie = false,
  enregistrement = "repos",
  canWrite = true,
  onObjet,
  onCorps,
  onEnregistrer,
  onReinitialiser,
}: {
  email: EmailAffiche
  objet: string
  corps: string
  /** Le refus connu d'avance, ou `null`. Voir `validationLocale`. */
  erreur: string | null
  /** Le refus renvoyé par le serveur, quand il y en a eu un. */
  erreurServeur?: string | null
  modifie?: boolean
  enregistrement?: "repos" | "envoi"
  canWrite?: boolean
  onObjet?: (valeur: string) => void
  onCorps?: (valeur: string) => void
  onEnregistrer?: () => void
  onReinitialiser?: () => void
}) {
  const corpsRef = useRef<HTMLTextAreaElement>(null)
  // Où replacer le curseur après une insertion. Un état plutôt qu'un appel
  // direct : le champ est contrôlé, et `setSelectionRange` avant que React
  // n'ait réécrit la valeur viserait l'ancien texte.
  const [curseur, setCurseur] = useState<number | null>(null)

  useEffect(() => {
    if (curseur === null) return
    const champ = corpsRef.current
    if (champ !== null) {
      champ.focus()
      champ.setSelectionRange(curseur, curseur)
    }
    setCurseur(null)
  }, [curseur])

  /**
   * Insérer `{{variable}}` là où est le curseur, pas à la fin.
   *
   * Le corps par défaut d'une notification fait sept lignes ; ajouter en
   * queue obligerait à couper-coller à chaque fois.
   */
  function inserer(nom: string) {
    if (onCorps === undefined) return
    const jeton = `{{${nom}}}`
    const champ = corpsRef.current
    const debut = champ?.selectionStart ?? corps.length
    const fin = champ?.selectionEnd ?? debut
    onCorps(corps.slice(0, debut) + jeton + corps.slice(fin))
    setCurseur(debut + jeton.length)
  }

  const bloque = erreur !== null || !modifie || enregistrement === "envoi"
  const obligatoires = email.variablesObligatoires

  return (
    <div className="ml-6 flex flex-col gap-4 rounded-lg bg-muted/40 p-4">
      <Field>
        <FieldLabel htmlFor={`objet-${email.cle}`}>Objet</FieldLabel>
        <Input
          id={`objet-${email.cle}`}
          type="text"
          value={objet}
          maxLength={MAX_OBJET}
          disabled={!canWrite}
          onChange={(event) => onObjet?.(event.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`corps-${email.cle}`}>Corps</FieldLabel>
        <Textarea
          id={`corps-${email.cle}`}
          ref={corpsRef}
          rows={8}
          value={corps}
          maxLength={MAX_CORPS}
          disabled={!canWrite}
          onChange={(event) => onCorps?.(event.target.value)}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>Variables</span>
          {/* La légende n'apparaît que s'il y a quelque chose à légender :
              la notification de contact n'a aucune variable obligatoire, et
              une note en bas de son panneau ne désignerait rien. */}
          {obligatoires.length > 0 ? (
            <span className="text-xs">
              <span aria-hidden="true">*</span> obligatoire
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {email.variables.map((nom) => {
            const requise = obligatoires.includes(nom)
            return (
              <Button
                key={nom}
                type="button"
                // Pleine contre contour : la distinction se voit avant
                // d'être lue, et l'astérisque la nomme pour qui ne
                // distingue pas les deux remplissages.
                variant={requise ? "secondary" : "outline"}
                size="sm"
                className="cursor-pointer font-mono text-xs"
                disabled={!canWrite}
                // L'astérisque est décoratif à l'oral : le mot entier passe
                // par le nom accessible, sinon un lecteur d'écran annonce
                // « lien étoile » et la personne ne sait pas ce qui est
                // obligatoire.
                aria-label={requise ? `{{${nom}}}, obligatoire` : `{{${nom}}}`}
                onClick={() => inserer(nom)}
              >
                {`{{${nom}}}`}
                {requise ? <span aria-hidden="true">*</span> : null}
              </Button>
            )
          })}
        </div>
      </div>

      {erreur === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}

      {erreurServeur === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {erreurServeur}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="cursor-pointer"
          disabled={!canWrite || bloque}
          onClick={() => onEnregistrer?.()}
        >
          {enregistrement === "envoi"
            ? "Enregistrement…"
            : "Enregistrer le texte"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          // Rétablir le texte du code n'efface PAS l'interrupteur :
          // `resetTemplate` le dit, et l'écran ne doit pas laisser croire
          // le contraire en enchaînant les deux.
          disabled={!canWrite || enregistrement === "envoi"}
          onClick={() => onReinitialiser?.()}
        >
          Revenir au texte par défaut
        </Button>
        {modifie && erreur === null ? (
          <span role="status" className="text-sm text-muted-foreground">
            Modifications non enregistrées.
          </span>
        ) : null}
        {email.majAt === null ? null : (
          <span className="text-xs text-muted-foreground">
            Modifié le{" "}
            {new Intl.DateTimeFormat("fr-FR", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(email.majAt))}
            {email.majParNom === null ? "" : ` par ${email.majParNom}`}
          </span>
        )}
      </div>
    </div>
  )
}
