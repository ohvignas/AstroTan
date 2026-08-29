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
//   1. le champ est en `type="password"` et n'est JAMAIS pré-rempli — une
//      valeur pré-remplie part dans le HTML de la page ;
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
  quatreDerniers: string | null
  majAt: number | null
  source: SecretSource
}

export type CleMaitresseEtat = "posee" | "absente" | "illisible"

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

function formatDate(at: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(at))
}

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

const BADGE: Record<SecretSource, { texte: string; variant: "secondary" | "destructive" | "outline" }> =
  {
    environnement: { texte: "Environnement", variant: "secondary" },
    base: { texte: "Saisi ici, chiffré", variant: "secondary" },
    aucune: { texte: "Absent", variant: "destructive" },
  }

/**
 * Une ligne : l'état d'un jeton, et de quoi le poser ou le retirer.
 *
 * `type="password"` et `value` toujours vide au départ. Un champ pré-rempli
 * avec la valeur existante mettrait le secret dans le HTML de la page, à un
 * clic droit de n'importe qui — et c'est précisément ce que tout le reste
 * du dispositif s'emploie à éviter.
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
  const [valeur, setValeur] = useState("")
  const [etatAppel, setEtatAppel] = useState<"repos" | "envoi" | "fait">("repos")
  const [erreur, setErreur] = useState<string | null>(null)
  const badge = BADGE[etat.source]
  const champId = `secret-${etat.nom}`

  async function lancer(action: () => Promise<void>, viderLeChamp: boolean) {
    setErreur(null)
    setEtatAppel("envoi")
    try {
      await action()
      if (viderLeChamp) setValeur("")
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
        <Badge variant={etat.illisible ? "destructive" : badge.variant}>
          {etat.illisible ? "Illisible" : badge.texte}
        </Badge>
        {etat.quatreDerniers ? (
          <code className="text-xs text-muted-foreground">
            …{etat.quatreDerniers}
          </code>
        ) : null}
        {etat.majAt !== null ? (
          <span className="text-xs text-muted-foreground">
            saisi le {formatDate(etat.majAt)}
          </span>
        ) : null}
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
            placeholder={
              etat.base || etat.environnement
                ? "Laisser vide pour ne rien changer"
                : "Coller la valeur"
            }
            value={valeur}
            onChange={(event) => {
              setValeur(event.target.value)
              setEtatAppel("repos")
            }}
            className="max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            // Vide = « ne change rien ». Le bouton le dit en étant inerte,
            // plutôt qu'en envoyant une chaîne vide que le serveur refuse.
            disabled={valeur.trim().length === 0 || etatAppel === "envoi"}
            onClick={() => lancer(() => onSave(valeur.trim()), true)}
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
              onClick={() => lancer(onClear, false)}
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
 * `secrets.status` est réservée à owner/admin — elle rend les quatre
 * derniers caractères, qui sont un fragment de secret. Plutôt qu'une carte
 * vide, une phrase qui dit pourquoi.
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
