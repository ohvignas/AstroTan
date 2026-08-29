import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
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
import {
  CleMaitresseBandeau,
  Command,
  SecretHorsPortee,
} from "@/components/settings-secrets"

// ---------------------------------------------------------------------
// L'écran « Envoi des emails », en pièces rendues sans Convex.
//
// Deux raisons de tout garder présentatif — queries et mutations restent
// dans `routes/_authed/settings/emails.tsx` :
//
//   • `vitest.config.ts` est en `environment: "node"` et rend avec
//     `renderToStaticMarkup`. Un composant qui appelle `useQuery` exigerait
//     un client Convex, donc un harnais, pour vérifier une phrase ;
//   • les trois exigences non négociables de cet écran sont toutes des
//     exigences de RENDU — une raison affichée et non masquée, un bandeau
//     et non une note, un refus montré avant le clic. Elles se testent là
//     où elles vivent.
//
// CE QUE CET ÉCRAN REPREND, et pourquoi il existe : `/settings/domaine` a
// été réécrit sans reprendre `RESEND_API_KEY`, dont la seule interface de
// saisie de toute l'administration a disparu avec l'ancienne page. Sans
// cet écran, la clé ne se pose plus que par `npx convex run` ou par
// l'environnement Convex — c'est-à-dire par un terminal, sur un dépôt qui
// se veut un template.
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

// ---------------------------------------------------------------------
// Le bandeau du mode d'essai
// ---------------------------------------------------------------------

/**
 * La panne la plus silencieuse de ce déploiement, dite fort.
 *
 * Tant que `RESEND_TEST_MODE` ne vaut pas exactement `"false"`, Resend
 * **accepte** chaque envoi — code 200, identifiant de message, aucune
 * erreur nulle part — et ne le délivre à personne. Rien dans le dashboard,
 * rien dans les journaux, rien côté expéditeur ne distingue ce cas d'un
 * envoi réussi. Le seul symptôme est du côté du destinataire, qui ne dira
 * rien puisqu'il ne sait pas qu'on lui a écrit.
 *
 * Cette phrase existait déjà — dans l'aide d'une variable « hors de
 * portée », au bas d'une page de réglages. Personne ne l'a jamais lue.
 * C'est la valeur par DÉFAUT : sur un template, elle atteint chaque
 * adoptant, une fois, au pire moment — la première invitation qu'il
 * envoie.
 */
export function BandeauModeEssai({ actif }: { actif: boolean }) {
  if (!actif) {
    return (
      <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        <strong>Envois réels.</strong> Chaque invitation et chaque
        notification part vraiment. Le domaine de l'adresse d'expédition
        doit être vérifié chez Resend, sinon Resend refuse.
      </p>
    )
  }
  return (
    <div
      // `role="alert"` et non un simple encadré : c'est un état du
      // déploiement qui invalide tout ce que la page permet de régler
      // en dessous, et il doit s'annoncer à qui n'a pas le rendu visuel.
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm"
    >
      <p className="font-medium text-destructive">
        Mode d'essai : Resend accepte les envois et ne les délivre pas.
      </p>
      <p className="text-muted-foreground">
        C'est la valeur par défaut. Aucune invitation, aucune notification
        n'arrive à son destinataire — et rien ne le signale : Resend répond
        « envoyé ». Tout ce qui se règle sur cette page reste sans effet
        visible tant que <code className="text-xs">RESEND_TEST_MODE</code>{" "}
        ne vaut pas <code className="text-xs">false</code>.
      </p>
      <p className="text-muted-foreground">
        Lue dans le constructeur du client Resend : elle ne se règle que
        dans l'environnement Convex, jamais depuis cet écran.
      </p>
      <Command>
        cd packages/backend && npx convex env set RESEND_TEST_MODE false
      </Command>
    </div>
  )
}

// ---------------------------------------------------------------------
// La clé, l'origine des liens, l'adresse d'expédition
// ---------------------------------------------------------------------

/**
 * `RESEND_API_KEY` — reprise de l'ancienne page « Domaine & emails ».
 *
 * `resend.configured` dit ce que porte l'ENVIRONNEMENT ; `secrets` ce qui
 * est rangé en base, chiffré. C'est la comparaison des deux que
 * `SecretField` affiche, avec la règle de précédence.
 */
export function SectionCleResend({
  secrets,
  resend,
}: {
  secrets: SecretsBloc
  resend: { configured: boolean }
}) {
  if (secrets.cleMaitresse === null) {
    return (
      <SettingsGroup title="La clé Resend">
        <p className="text-sm text-muted-foreground">
          La clé d'envoi est réservée au propriétaire et aux
          administrateurs — y compris son état. Le reste de cette page est
          consultable.
        </p>
      </SettingsGroup>
    )
  }
  return (
    <SettingsGroup title="La clé Resend">
      <CleMaitresseBandeau etat={secrets.cleMaitresse} />
      <ChampSecret bloc={secrets} nom="RESEND_API_KEY">
        Sans elle, une invitation est bien créée mais son email ne part pas,
        et une notification de lead non plus. Le lead, lui, est enregistré
        quoi qu'il arrive. <strong>La base est lue</strong> :{" "}
        <code className="text-xs">convex/lib/resend.ts</code> construit le
        client via le lecteur unique{" "}
        <code className="text-xs">secrets.lireSecret</code>, qui préfère la
        variable d'environnement quand elle existe et retombe sinon sur la
        valeur saisie ici, une fois déchiffrée.
        {resend.configured
          ? " Une valeur est posée dans l'environnement : c'est elle qui sert."
          : " Aucune valeur dans l'environnement de ce déploiement."}
      </ChampSecret>
    </SettingsGroup>
  )
}

/**
 * `SITE_URL`, parce que c'est elle qui compose les liens DANS les emails.
 *
 * L'invitation ne contient qu'un lien, et c'est tout son contenu utile ;
 * la notification de lead en porte un vers le dashboard. Fausse ou
 * absente, les emails partent bien et ne mènent nulle part — un défaut
 * qui ne se voit qu'en cliquant, donc chez quelqu'un d'autre.
 *
 * Lue au chargement des modules Convex (`baseURL` de Better Auth) : une
 * valeur saisie à l'écran arriverait toujours trop tard, d'où
 * `SecretHorsPortee` plutôt qu'un champ.
 */
export function OrigineDesLiens({ adminUrl }: { adminUrl: string | null }) {
  return (
    <SecretHorsPortee
      nom="SITE_URL"
      raison={
        <>
          L'origine du <strong>dashboard</strong>, et donc celle des liens
          contenus dans les emails : celui d'une invitation, et le
          « répondre depuis le dashboard » d'une notification de lead. Lue
          au chargement des modules Convex, pas au moment de l'usage — une
          valeur saisie ici arriverait toujours trop tard.{" "}
          {adminUrl === null ? (
            <Badge variant="destructive">Absente</Badge>
          ) : (
            <>
              Actuellement <code className="text-xs">{adminUrl}</code>.
            </>
          )}
        </>
      }
      commande="cd packages/backend && npx convex env set SITE_URL https://admin.exemple.fr"
    />
  )
}

/**
 * L'adresse d'expédition — le premier champ de ce dépôt qui règle
 * `settings.emailFrom`.
 *
 * Elle ne s'enregistre pas toute seule, et c'est le même raisonnement
 * qu'`/settings/webhook` : `bonjour@exemple.f` est une saisie en route
 * vers `bonjour@exemple.fr`, et enregistrée ne serait-ce qu'une seconde
 * elle devient l'expéditeur de tout ce qui part pendant cette seconde.
 * La barre d'enregistrement l'attend donc au clic (`SettingsFormShell`).
 *
 * Le repli est affiché quand le champ est vide, et il n'est pas décoratif :
 * `choisirExpediteur` retombe sur le bac à sable de Resend, qui ne délivre
 * qu'aux adresses de test du compte. Sans cette phrase, on ne le découvre
 * que par ses destinataires — c'est-à-dire jamais.
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
      <FieldLabel htmlFor="email-from">Adresse d'expédition</FieldLabel>
      <Input
        id="email-from"
        type="text"
        placeholder="Nom <adresse@votredomaine.fr>"
        value={valeur}
        disabled={!canWrite}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <FieldDescription>
        <code className="text-xs">Nom &lt;adresse@votredomaine.fr&gt;</code>,
        ou l'adresse seule. Le domaine doit être{" "}
        <strong>vérifié chez Resend</strong>, sinon Resend refuse l'envoi —
        les enregistrements DNS à créer se vérifient depuis{" "}
        {lienDomaine ?? <>l'écran Domaine &amp; emails</>}.
      </FieldDescription>
      {saisie.length === 0 ? (
        <FieldDescription>
          Champ vide : les emails partent de{" "}
          <code className="text-xs">{EXPEDITEUR_BAC_A_SABLE}</code>, le bac à
          sable de Resend — il ne délivre qu'aux adresses de test de votre
          compte et ne doit pas rester en production.
        </FieldDescription>
      ) : null}
      {invalide ? (
        <p role="alert" className="text-sm text-destructive">
          Ce n'est pas une adresse : écrivez{" "}
          <code className="text-xs">bonjour@exemple.fr</code> ou{" "}
          <code className="text-xs">Nom &lt;bonjour@exemple.fr&gt;</code>. En
          l'état, le serveur refuserait l'enregistrement.
        </p>
      ) : null}
    </Field>
  )
}

// ---------------------------------------------------------------------
// La liste des envois
// ---------------------------------------------------------------------

/**
 * Une carte par email du catalogue — pas une par ligne enregistrée.
 *
 * `emails.list` rend toujours le catalogue entier : l'écran montre ce que
 * le site PEUT envoyer, pas ce que quelqu'un a déjà modifié. C'est ce qui
 * lui permet d'écrire « par défaut » sans avoir à le deviner.
 */
export function ListeEmails({
  emails,
  onToggle,
  onModifier,
  canWrite = true,
  cleOuverte = null,
  /** L'éditeur du gabarit ouvert, rendu dans sa propre carte. */
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
    <div className="flex flex-col gap-4">
      {emails.map((email) => (
        <CarteEmail
          key={email.cle}
          email={email}
          onToggle={onToggle}
          onModifier={onModifier}
          canWrite={canWrite}
          ouvert={cleOuverte === email.cle}
          editeur={editeur}
        />
      ))}
    </div>
  )
}

function CarteEmail({
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
  const interrupteurId = `email-actif-${email.cle}`
  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base leading-snug font-medium">
            {email.titre}
          </h2>
          <p className="text-sm text-muted-foreground">{email.quand}</p>
          <p className="text-sm text-muted-foreground">
            <strong>Destinataire :</strong> {email.destinataire}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={email.personnalise ? "secondary" : "outline"}>
            {email.personnalise ? "Texte personnalisé" : "Texte par défaut"}
          </Badge>
          <label
            htmlFor={interrupteurId}
            className="flex items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">
              {email.actif ? "Actif" : "Désactivé"}
            </span>
            <Switch
              id={interrupteurId}
              checked={email.actif}
              // Deux refus distincts, et le second n'est pas cosmétique :
              // `emails.setActif` LÈVE sur un email non désactivable, dans
              // les deux sens. L'interrupteur inerte n'est donc pas une
              // politesse d'interface, c'est la seule façon de ne pas
              // proposer un geste dont le serveur ne veut pas.
              disabled={!canWrite || !email.desactivable}
              onCheckedChange={(actif: boolean) => onToggle(email.cle, actif)}
            />
          </label>
        </div>
      </div>

      {/* La raison, AFFICHÉE. Pas une infobulle, pas un `title=` : un
          interrupteur grisé sans phrase se lit « c'est cassé », et la
          personne qui le lit ainsi ouvre un ticket au lieu de comprendre
          qu'on lui épargne un verrouillage irréversible. */}
      {email.desactivable ? null : (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <strong>Cet envoi ne se coupe pas.</strong>{" "}
          {email.raisonNonDesactivable}
        </p>
      )}

      {email.desactivable && !email.actif ? (
        <p className="text-sm text-muted-foreground">
          Coupé : cet email ne part plus. Le reste continue — un lead est
          enregistré même quand sa notification est désactivée.
        </p>
      ) : null}

      {/* Un texte enregistré que la relecture a écarté. L'envoi n'échoue
          pas — `gabaritPour` repart du texte du code — et c'est
          précisément pour cela qu'il faut le dire ici : rien d'autre ne le
          dira. */}
      {email.probleme === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          <strong>Votre texte enregistré a été écarté</strong> et n'est pas
          celui qui part aujourd'hui : {email.probleme} Le texte du code est
          envoyé à sa place. Ouvrez l'éditeur pour le corriger.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={!canWrite}
          onClick={() => onModifier?.(email.cle)}
        >
          {ouvert ? "Fermer l'éditeur" : "Modifier le texte"}
        </Button>
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

      {ouvert && editeur ? editeur(email) : null}
    </SettingsGroup>
  )
}

// ---------------------------------------------------------------------
// L'éditeur d'un gabarit
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

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-input p-3">
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
        <FieldDescription>
          Une seule ligne. Un saut de ligne dans un objet ajoute des
          en-têtes à l'email : le serveur le refuse.
        </FieldDescription>
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
        <FieldDescription>
          Du texte simple : le code compose le HTML autour. Les valeurs
          insérées à la place des variables sont échappées.
        </FieldDescription>
      </Field>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Variables disponibles pour cet email — cliquer en insère une dans
          le corps, à l'endroit du curseur.
          {email.variablesObligatoires.length > 0 ? (
            <>
              {" "}
              <strong>
                {email.variablesObligatoires
                  .map((nom) => `{{${nom}}}`)
                  .join(", ")}
              </strong>{" "}
              {email.variablesObligatoires.length > 1
                ? "sont obligatoires"
                : "est obligatoire"}{" "}
              : sans elle, la personne qui reçoit cet email ne peut rien en
              faire.
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {email.variables.map((nom) => (
            <Button
              key={nom}
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer font-mono text-xs"
              disabled={!canWrite}
              onClick={() => inserer(nom)}
            >
              {`{{${nom}}}`}
            </Button>
          ))}
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
      </div>
    </div>
  )
}
