import { useState } from "react"
import type { ReactNode } from "react"
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
//   2. vide veut dire « ne change rien », jamais « efface » : pour retirer,
//      il y a un bouton qui le dit ;
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
export type Geste = "aucun" | "enregistrer"

/**
 * Le champ a plus d'états qu'il n'y paraît, et les confondre coûte cher.
 *
 *   • **intact** — le masque n'a pas bougé : il n'y a rien à faire ;
 *   • **vide** — sans jeton posé, il n'y a toujours rien à faire ;
 *   • **saisi** — une valeur a été tapée : elle remplace ce qui est là.
 */
export function gesteDuChamp(valeur: string, jetonPose: boolean): Geste {
  if (jetonPose && valeur === MASQUE) return "aucun"
  if (valeur.trim().length === 0) return "aucun"
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
  disabled,
  onSave,
  onClear,
}: {
  etat: SecretEtat
  /** Ce que cette variable fait, et qui la lit. Une ou deux phrases. */
  children?: ReactNode
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
  const [etatAppel, setEtatAppel] = useState<"repos" | "envoi" | "fait">("repos")
  const [erreur, setErreur] = useState<string | null>(null)
  const badge = etat.source === "base" ? null : BADGE[etat.source]
  const champId = `secret-${etat.nom}`
  const geste = gesteDuChamp(valeur, etat.base)

  async function lancer(action: () => Promise<void>, apres: string) {
    setErreur(null)
    setEtatAppel("envoi")
    try {
      await action()
      setValeur(apres)
      setEtatAppel("fait")
    } catch (err) {
      setEtatAppel("repos")
      setErreur(err instanceof Error ? err.message : String(err))
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
          déchiffre plus. Ressaisissez-le, ou retirez-le.
        </p>
      ) : null}

      {!disabled && (
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
              setEtatAppel("repos")
            }}
            className="max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            // Le bouton dit en étant inerte qu'il n'y a rien à faire,
            // plutôt qu'en envoyant au serveur une valeur qu'il refuse.
            disabled={geste === "aucun" || etatAppel === "envoi"}
            // Un jeton vient d'être rangé : le champ revient au masque, et
            // non à vide, qui laisserait croire qu'il n'y a rien.
            onClick={() => lancer(() => onSave(valeur.trim()), MASQUE)}
          >
            Enregistrer
          </Button>
          {etat.base && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              disabled={etatAppel === "envoi"}
              onClick={() => lancer(onClear, "")}
            >
              Retirer de la base
            </Button>
          )}
          {etatAppel === "fait" && (
            <span role="status" className="text-sm text-muted-foreground">
              Enregistré.
            </span>
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
