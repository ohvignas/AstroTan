import { useState } from "react"
import type { ReactNode } from "react"
import type { Verdict } from "@astrotan/backend/convex/secretCheck"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingsGroup } from "@/components/settings-nav"

// ---------------------------------------------------------------------
// La saisie des jetons.
//
// CE QUE CET ÉCRAN NE PEUT PAS FAIRE, et qui explique tout le reste : une
// mutation Convex ne peut pas écrire une variable d'environnement Convex.
// Celles-ci ne se posent qu'au déploiement, par la CLI. Un jeton saisi ici
// finit donc en base — chiffré (`convex/secrets.ts`), sous une clé
// maîtresse qui, elle, reste dans l'environnement.
//
// D'où la règle de PRÉCÉDENCE, écrite à l'écran et pas seulement en
// commentaire : si la variable d'environnement existe, c'est elle qui sert.
// Sans cette phrase, quelqu'un saisit une clé, elle n'a aucun effet, et
// rien à l'écran ne dit pourquoi.
//
// Trois règles de construction, que `settings-secrets.test.tsx` tient :
//
//   1. le champ est en `type="password"` et n'est JAMAIS pré-rempli avec le
//      jeton — une valeur pré-remplie part dans le HTML de la page. Un
//      jeton posé se signale par un MASQUE (`MASQUE` ci-dessous), une
//      suite de points de longueur fixe qui ne dit rien de la valeur ;
//   2. **vider le champ demande à effacer, et il faut l'avoir vidé.**
//
//      La règle disait l'inverse jusqu'ici — « vide veut dire ne change
//      rien, jamais efface : pour retirer, il faut un geste distinct » —
//      et elle avait une raison, qu'il faut nommer avant de la retirer :
//      le champ ARRIVAIT VIDE au chargement. « Vide » n'était donc pas un
//      geste, c'était l'état de repos, et une sauvegarde distraite aurait
//      effacé une clé en service sans que personne le remarque.
//
//      Depuis la règle 1, le champ n'arrive plus vide : il arrive masqué.
//      Le vider demande d'effacer un masque qu'on voit, et devient une
//      action délibérée — la raison de l'ancienne règle est tombée avec
//      l'état de repos qui la portait. Ce qui reste du danger, une clé en
//      service qui disparaît, est traité par une CONFIRMATION qui nomme
//      la conséquence, et non par un bouton de retrait toujours affiché à
//      côté d'« Enregistrer », où le geste le plus destructeur de l'écran
//      tenait en un clic sans question.
//
//      Trois états, donc, et non deux — `gesteDuChamp` les nomme : masque
//      intact (ne rien faire), champ vidé (supprimer, après
//      confirmation), champ retapé (remplacer) ;
//   3. rien ne s'enregistre tout seul. Un jeton à demi tapé, envoyé à
//      chaque pause de frappe, écraserait le bon.
//
// Composants purement présentatifs : les queries et les mutations restent
// dans les routes, ce qui rend ce fichier rendu-testable sans monter de
// client Convex.
// ---------------------------------------------------------------------

export type SecretSource = "environnement" | "base" | "aucune"

export interface SecretEtat {
  nom: string
  /** La variable existe sur le déploiement Convex. */
  environnement: boolean
  /** Une ligne chiffrée existe en base. */
  base: boolean
  /** La ligne existe mais ne se déchiffre plus — la clé maîtresse a changé. */
  illisible: boolean
  source: SecretSource
}

// `quatreDerniers` et `majAt` VIVAIENT ICI, et n'y sont plus. Ils
// n'existaient que pour trois mentions affichées à côté du nom — une
// pastille « Saisi ici, chiffré », un fragment « …9876 », une date de
// saisie — que les points du champ rendent inutiles ou qui ne
// répondaient à aucune question posée devant ce champ.
//
// `quatreDerniers` est un MORCEAU DE SECRET : quatre caractères de la
// clé, déchiffrés côté serveur, sérialisés, envoyés au navigateur. Une
// donnée qu'on cesse d'afficher n'a plus de raison de traverser le
// réseau. `secrets.status` les rend encore tous les deux ; les retirer
// de la query est un changement de backend, hors du périmètre de ce
// commit, et il est signalé dans le rapport.

export type CleMaitresseEtat = "posee" | "absente" | "illisible"

/**
 * Ce qu'affiche le champ d'un jeton déjà posé.
 *
 * Un REMPLAÇANT, jamais la valeur : le jeton est chiffré en base sous une
 * clé maîtresse qui vit dans l'environnement Convex, aucune query ne le
 * rend, et il ne quitte donc jamais le serveur
 * (`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`).
 *
 * Longueur FIXE, et c'est le point : un masque calé sur la longueur réelle
 * serait déjà une fuite. Il dirait quel format de clé est posé — une clé
 * Resend, un identifiant Umami, un mot de passe court — et rétrécirait
 * d'autant ce qu'il reste à deviner. Douze points, quelle que soit la clé.
 */
export const MASQUE = "••••••••••••"

/**
 * Le masque est atomique : douze points ne sont pas douze caractères
 * qu'on éditerait un à un.
 *
 * Toute frappe dans un champ masqué fait donc disparaître le masque
 * ENTIER, et ce qui reste est ce que l'opérateur a tapé. Effacer un seul
 * point vide le champ — visiblement, à l'écran — ce qui est exactement le
 * geste qu'on veut rendre délibéré plutôt que subreptice.
 *
 * Le point médian est retiré sans hésiter : aucune clé d'API n'en
 * contient, et le seul endroit d'où il puisse venir est le masque.
 */
export function sansMasque(valeur: string): string {
  return valeur.replaceAll("•", "")
}

/** Ce qu'un clic sur le bouton ferait, vu l'état du champ. */
export type Geste = "aucun" | "enregistrer" | "supprimer"

/**
 * Le champ a TROIS états, et les confondre coûte cher dans les deux sens :
 * une clé perdue sans qu'on l'ait voulu, ou une clé qu'on ne peut plus
 * retirer du tout.
 *
 *   • **intact** — le masque n'a pas bougé : il n'y a rien à faire ;
 *   • **vidé** — le masque a été effacé alors qu'une ligne existe : c'est
 *     une demande de suppression, et le seul geste de cet écran qui
 *     appelle une confirmation ;
 *   • **saisi** — une valeur a été tapée : elle remplace ce qui est là.
 *
 * Sans jeton posé, un champ vide reste l'état de repos : rien à faire.
 */
export function gesteDuChamp(valeur: string, jetonPose: boolean): Geste {
  if (jetonPose && valeur === MASQUE) return "aucun"
  if (valeur.trim().length === 0) return jetonPose ? "supprimer" : "aucun"
  return "enregistrer"
}

/** La commande à recopier dans un terminal, puisque l'écran ne peut pas la lancer. */
export function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
      <code>{children}</code>
    </pre>
  )
}

export const SECRETS_KEY_COMMANDE =
  'cd packages/backend && npx convex env set SECRETS_KEY "$(openssl rand -base64 32)"'

/**
 * L'état de la clé maîtresse, en tête de chaque page qui porte des jetons.
 *
 * Sans elle rien ne peut être saisi, et le refus vient du serveur : autant
 * le dire avant que l'opérateur ne tape une clé pour rien.
 */
export function CleMaitresseBandeau({ etat }: { etat: CleMaitresseEtat }) {
  if (etat === "posee") {
    return (
      <p className="text-sm text-muted-foreground">
        Les jetons saisis ici sont chiffrés (AES-GCM) avant d'entrer en base,
        sous la clé <code className="text-xs">SECRETS_KEY</code> du
        déploiement. Une copie de la base ne suffit donc pas à les lire.{" "}
        <strong>
          Une variable d'environnement du même nom l'emporte toujours sur ce
          qui est saisi ici.
        </strong>
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-destructive">
        {etat === "absente"
          ? "Aucune clé maîtresse sur ce déploiement : la saisie est refusée. Un jeton stocké sans chiffrement serait lisible dans n'importe quel export de la base — le repli en clair n'existe pas."
          : "La clé maîtresse est présente mais inutilisable (elle doit faire 32 octets en base64). La saisie est refusée, et les jetons déjà rangés ne se déchiffrent plus."}
      </p>
      <Command>{SECRETS_KEY_COMMANDE}</Command>
      <p className="text-sm text-muted-foreground">
        À ne lancer qu'une fois. La régénérer rend illisibles les jetons déjà
        saisis — il faut alors les ressaisir.
      </p>
    </div>
  )
}

/**
 * D'où vient la valeur qui sert — quand ce n'est pas de ce champ-ci.
 *
 * `base` n'y figure plus : les points du champ le disent déjà, et deux
 * façons de dire la même chose sur la même ligne se lisent deux fois pour
 * n'apprendre qu'une chose.
 */
const BADGE: Record<
  Exclude<SecretSource, "base">,
  { texte: string; variant: "secondary" | "destructive" | "outline" }
> = {
  environnement: { texte: "Environnement", variant: "secondary" },
  aucune: { texte: "Absent", variant: "destructive" },
}

/**
 * Ce que l'écran dit d'un essai raté, et rien de plus.
 *
 * `secretCheck.essayer` présente le jeton à son service avant qu'il ne
 * soit rangé (`packages/backend/convex/secretCheck.ts`). Il rend une
 * DÉCISION, jamais le corps d'erreur du service — cette fonction fait le
 * dernier pas : elle en tire une phrase pour l'opérateur.
 *
 * Trois issues, et il faut les tenir séparées :
 *
 *   • **valide** et **sans_verificateur** ne bloquent rien. Un jeton
 *     qu'on ne sait pas essayer s'enregistre comme avant : refuser faute
 *     de vérificateur interdirait de saisir les cinq identifiants Umami ;
 *   • **refuse** — le service a jugé la clé et n'en veut pas. La phrase
 *     dit QUE la clé est refusée, pas POURQUOI : « This API key is
 *     restricted to only send emails » recopié à l'écran n'apprend rien à
 *     qui ne connaît pas l'API, et envoie chercher du côté des
 *     permissions une faute qui est presque toujours un caractère perdu
 *     au collage ;
 *   • **injoignable** — le service n'a pas répondu, donc il n'a rien
 *     jugé. Le dire comme un refus reviendrait à accuser l'opérateur
 *     d'une panne, et à lui faire changer une clé qui n'a rien.
 *
 * Rend `null` quand le jeton peut être rangé.
 */
export function refusDuVerdict(verdict: Verdict): string | null {
  switch (verdict.verdict) {
    case "valide":
    case "sans_verificateur":
      return null
    case "refuse":
      return `${verdict.service} refuse cette clé : rien n'a été enregistré. Vérifiez qu'elle a été collée en entier, et qu'elle est toujours active dans votre compte ${verdict.service}.`
    case "injoignable":
      return `${verdict.service} n'a pas répondu : la clé n'a pas pu être essayée, et rien n'a été enregistré. Réessayez dans un moment.`
  }
}

/** Ce qu'un appel a fait, une fois qu'il est passé. */
export type Fait = "enregistre" | "supprime" | null

/**
 * Le bouton, et lui seul.
 *
 * UN bouton, dont le libellé suit l'état du champ, plutôt que deux dont
 * l'un est toujours là. Un « Enregistrer » qui supprimerait serait le pire
 * des deux mondes : le mot dit une chose, le clic en fait une autre.
 *
 * « Vérifier et enregistrer », pas « Enregistrer » tout court : le clic
 * présente d'abord la clé à son service (`secretCheck.essayer`, appelé par
 * `onSave` — `settings-page.tsx` `useSecretsAccess`) AVANT de la chiffrer
 * et de la ranger. La vérification est légitime au moment d'enregistrer ;
 * c'est le libellé qui doit le dire, plutôt que de le découvrir après coup
 * dans un refus.
 *
 * Extrait de `SecretField` pour être rendu seul dans les tests : l'état
 * « champ vidé » naît d'une frappe, et le rendu statique
 * (`environment: "node"`) ne sait pas frapper.
 */
export function ActionsDuChamp({
  geste,
  enCours,
  fait,
  onEnregistrer,
  onSupprimer,
}: {
  geste: Geste
  enCours: boolean
  fait: Fait
  onEnregistrer: () => void
  onSupprimer: () => void
}) {
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={geste === "supprimer" ? "destructive" : "default"}
        className="cursor-pointer"
        // Le bouton dit en étant inerte qu'il n'y a rien à faire, plutôt
        // qu'en envoyant au serveur une valeur qu'il refuse.
        disabled={geste === "aucun" || enCours}
        onClick={geste === "supprimer" ? onSupprimer : onEnregistrer}
      >
        {geste === "supprimer" ? "Supprimer" : "Vérifier et enregistrer"}
      </Button>
      {fait !== null && (
        <span role="status" className="text-sm text-muted-foreground">
          {fait === "supprime" ? "Supprimé." : "Enregistré."}
        </span>
      )}
    </>
  )
}

/**
 * La question posée avant de retirer un jeton.
 *
 * Elle existe parce que « vider le champ » suffit désormais à supprimer :
 * le geste est délibéré — on efface un masque qu'on voit — mais sa
 * CONSÉQUENCE, elle, ne se lit nulle part sur cet écran. Retirer la clé
 * Resend arrête tous les envois du site, invitations comprises, et
 * personne ne devrait l'apprendre après coup.
 *
 * Sauf quand la variable d'environnement existe : elle l'emporte, la
 * ligne de base ne sert déjà à rien, et annoncer une coupure ferait
 * renoncer à un ménage sans risque.
 */
export function ConfirmationRetrait({
  nom,
  environnement,
  consequence,
  enCours,
  onConfirmer,
  onAnnuler,
}: {
  nom: string
  /** Une variable d'environnement du même nom existe et l'emporte. */
  environnement: boolean
  /** Ce qui s'arrête sans ce jeton. Une phrase, écrite par l'appelant. */
  consequence?: ReactNode
  enCours: boolean
  onConfirmer: () => void
  onAnnuler: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3">
      <p className="text-sm">
        Retirer <code className="text-xs">{nom}</code> de la base ?{" "}
        {environnement ? (
          <>
            La variable d&apos;environnement du même nom existe et{" "}
            <strong>continuera de servir</strong> : rien ne changera pour le
            site.
          </>
        ) : (
          <>
            Plus rien ne fournira cette valeur.{" "}
            {consequence === undefined ? null : consequence}
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="cursor-pointer"
          disabled={enCours}
          onClick={onConfirmer}
        >
          Supprimer définitivement
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="cursor-pointer"
          disabled={enCours}
          onClick={onAnnuler}
        >
          Annuler
        </Button>
      </div>
    </div>
  )
}

/**
 * Une ligne : l'état d'un jeton, et de quoi le poser ou le retirer.
 *
 * `type="password"`, et `value` ne porte jamais que deux choses : le
 * MASQUE quand une ligne existe en base, ou ce que l'opérateur vient de
 * taper. Pré-remplir avec la valeur existante mettrait le secret dans le
 * HTML de la page, à un clic droit de n'importe qui — et c'est
 * précisément ce que tout le reste du dispositif s'emploie à éviter. Le
 * masque, lui, ne coûte rien : le composant ne l'a pas reçu, il l'a écrit.
 */
export function SecretField({
  etat,
  children,
  consequence,
  sansRetrait = false,
  disabled,
  onSave,
  onClear,
}: {
  etat: SecretEtat
  /** Ce que cette variable fait, et qui la lit. Une ou deux phrases. */
  children?: ReactNode
  /** Ce qui s'arrête sans ce jeton — lu au moment de confirmer un retrait. */
  consequence?: ReactNode
  /** Masque le geste « vider = supprimer » : un bouton de ligne s'en charge. */
  sansRetrait?: boolean
  /** Vrai pour un editor, ou tant que la clé maîtresse manque. */
  disabled: boolean
  onSave: (valeur: string) => Promise<void>
  onClear: () => Promise<void>
}) {
  // Le masque au montage quand une ligne existe déjà en base. L'état des
  // jetons est arrivé avant que cette page ne se rende (`useSecretsAccess`
  // retient l'affichage tant que la query n'a pas répondu), donc `etat.base`
  // est connu ici — il n'y a pas de second passage à rattraper.
  const [valeur, setValeur] = useState(etat.base ? MASQUE : "")
  const [enCours, setEnCours] = useState(false)
  const [fait, setFait] = useState<Fait>(null)
  const [confirmation, setConfirmation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const badge = etat.source === "base" ? null : BADGE[etat.source]
  const champId = `secret-${etat.nom}`
  const gesteBrut = gesteDuChamp(valeur, etat.base)
  const geste = sansRetrait && gesteBrut === "supprimer" ? "aucun" : gesteBrut

  async function lancer(
    action: () => Promise<void>,
    apres: string,
    resultat: Fait
  ) {
    setErreur(null)
    setEnCours(true)
    try {
      await action()
      setValeur(apres)
      setFait(resultat)
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err))
    } finally {
      setEnCours(false)
      // Refermée dans les deux cas : après un retrait réussi elle n'a
      // plus d'objet, et après un refus l'erreur est la seule chose à
      // lire — la question reposée par-dessus la ferait relire deux fois.
      setConfirmation(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-medium">{etat.nom}</code>
        {etat.illisible ? (
          <Badge variant="destructive">Illisible</Badge>
        ) : badge === null ? null : (
          <Badge variant={badge.variant}>{badge.texte}</Badge>
        )}
      </div>

      {children ? (
        <p className="text-sm text-muted-foreground">{children}</p>
      ) : null}

      {/* Le cas qui fait perdre une heure sans cette phrase : les deux
          existent, et c'est l'environnement qui sert. */}
      {etat.environnement && etat.base ? (
        <p className="text-sm text-muted-foreground">
          Une valeur est aussi saisie ici, et elle est{" "}
          <strong>ignorée</strong> tant que la variable d'environnement
          existe. Pour que celle-ci serve, retirez la variable du déploiement
          (<code className="text-xs">npx convex env remove {etat.nom}</code>).
        </p>
      ) : null}

      {etat.illisible ? (
        <p className="text-sm text-destructive">
          Ce jeton a été chiffré sous une autre clé maîtresse et ne se
          déchiffre plus. Ressaisissez-le, ou videz le champ pour le
          retirer.
        </p>
      ) : null}

      {!disabled && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={champId}
              type="password"
              // Le navigateur ne doit ni proposer, ni retenir, ni compléter
              // une clé d'API dans son gestionnaire de mots de passe.
              autoComplete="off"
              aria-label={`Nouvelle valeur pour ${etat.nom}`}
              // Rien à inviter quand le champ porte déjà le masque : une
              // invite ne s'affiche que sur un champ vide, et celui-là ne
              // l'est pas.
              placeholder={etat.base ? undefined : "Coller la valeur"}
              value={valeur}
              onChange={(event) => {
                setValeur(sansMasque(event.target.value))
                setFait(null)
                // Retaper après avoir demandé un retrait annule la
                // demande : la question porterait sur un champ qui n'est
                // plus vide.
                setConfirmation(false)
              }}
              className="max-w-xs"
            />
            {!confirmation && (
              <ActionsDuChamp
                geste={geste}
                enCours={enCours}
                fait={fait}
                // Un jeton vient d'être rangé : le champ revient au
                // masque, et non à vide, qui laisserait croire qu'il n'y a
                // rien — et qui ferait du clic suivant une suppression.
                onEnregistrer={() =>
                  lancer(() => onSave(valeur.trim()), MASQUE, "enregistre")
                }
                // Rien ne part encore : le clic ouvre la question.
                onSupprimer={() => setConfirmation(true)}
              />
            )}
          </div>
          {confirmation && (
            <ConfirmationRetrait
              nom={etat.nom}
              environnement={etat.environnement}
              consequence={consequence}
              enCours={enCours}
              onConfirmer={() => lancer(onClear, "", "supprime")}
              onAnnuler={() => {
                // Le masque revient : le champ retrouve l'état où il n'y a
                // rien à faire, et non un champ vide qui redemanderait la
                // suppression au clic suivant.
                setConfirmation(false)
                setValeur(MASQUE)
              }}
            />
          )}
        </div>
      )}

      {erreur !== null && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}
    </div>
  )
}

/**
 * Une variable que cet écran ne peut PAS régler, et pourquoi.
 *
 * Elle a autant sa place ici qu'un champ : fabriquer un champ qui ne ferait
 * rien serait pire que l'absence de champ, et ne rien afficher du tout
 * laisserait chercher.
 */
export function SecretHorsPortee({
  nom,
  raison,
  commande,
}: {
  nom: string
  raison: ReactNode
  /** La commande qui, elle, marche — quand il y en a une. */
  commande?: string
}) {
  return (
    <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-medium">{nom}</code>
        <Badge variant="outline">Ne se règle pas ici</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{raison}</p>
      {commande ? <Command>{commande}</Command> : null}
    </div>
  )
}

/**
 * Ce qu'un editor voit à la place des champs.
 *
 * `secrets.status` est réservée à owner/admin : savoir quelles clés sont
 * posées, lesquelles manquent et laquelle est illisible dessine l'état de
 * sécurité du déploiement, et l'écriture est de toute façon réservée aux
 * deux mêmes rôles. Plutôt qu'une carte vide, une phrase qui dit pourquoi.
 */
export function SecretsReserves() {
  return (
    <SettingsGroup>
      <p className="text-sm text-muted-foreground">
        Les jetons d'accès aux services externes sont réservés au
        propriétaire et aux administrateurs — y compris leur état. Le reste
        de cette page est consultable.
      </p>
    </SettingsGroup>
  )
}
