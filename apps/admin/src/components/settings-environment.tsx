import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { Field, FieldLabel } from "@/components/ui/field"
import { SettingsGroup } from "@/components/settings-nav"
import { AiModelFields } from "@/components/ai-model-select"
import {
  CleMaitresseBandeau,
  SecretField,
} from "@/components/settings-secrets"
import type { CleMaitresseEtat, SecretEtat } from "@/components/settings-secrets"

// ---------------------------------------------------------------------
// Les pages qui portent les JETONS et les variables de déploiement —
// IA ici, Envoi des emails dans `email-templates.tsx`, SEO & Pixel dans
// `settings-seo-pixel.tsx`. Les deux derniers empruntent `ChampSecret`
// et `SecretsBloc` ci-dessous.
//
// Elles n'avaient aucun champ, et le fichier expliquait pourquoi : une clé
// d'API n'entre pas dans la table `settings`, qui a une projection publique.
// C'est toujours vrai, et c'est pour cela que les jetons ont maintenant leur
// PROPRE table, chiffrée (`convex/secrets.ts`) — pas parce que la contrainte
// a disparu, mais parce qu'on lui a donné un autre logement.
//
// Ce qui reste sans champ, et le restera :
//
//   • `PUBLIC_UMAMI_*` : Astro les fige AU BUILD de l'image du site. Les
//     IDs Meta / Google se saisissent sur `/settings/mesure`, plus ici ;
//   • `SITE_URL` / `WEB_SITE_URL` : lues au chargement des modules Convex
//     (la `baseURL` de Better Auth, l'invalidation de cache), pas au moment
//     de l'usage — une valeur en base arriverait trop tard ;
//   • `RESEND_TEST_MODE` : lu dans le constructeur du client Resend, même
//     raison ;
//   • un domaine, qui se règle chez le registrar, dans le DNS et dans
//     Traefik.
//
// Les trois dernières ont déménagé avec la page qui les portait ; voir le
// bloc « Domaine & emails — RETIRÉE » plus bas.
//
// Un formulaire est une promesse. Ces lignes-là n'en font aucune : elles
// disent l'état, nomment la variable, et donnent la commande.
// `settings-environment.test.tsx` échoue si un champ de saisie apparaît sur
// l'une d'elles.
// ---------------------------------------------------------------------

/** Tout ce dont ces pages ont besoin pour afficher et écrire un jeton. */
export interface SecretsBloc {
  /** `null` quand l'appelant n'a pas le droit de lire l'état (editor). */
  cleMaitresse: CleMaitresseEtat | null
  etats: Record<string, SecretEtat>
  canWrite: boolean
  onSave: (nom: string, valeur: string) => Promise<void>
  onClear: (nom: string) => Promise<void>
}

/**
 * Un état par défaut plutôt qu'un rendu conditionnel à chaque appel : la
 * query et la liste des noms viennent de deux endroits, et un nom que le
 * serveur ne connaît pas doit s'afficher « absent » au lieu de faire
 * disparaître la ligne sans rien dire.
 */
function etatDe(bloc: SecretsBloc, nom: string): SecretEtat {
  return (
    bloc.etats[nom] ?? {
      nom,
      environnement: false,
      base: false,
      illisible: false,
      source: "aucune",
    }
  )
}

/**
 * Un jeton, avec la règle « sans clé maîtresse, pas de champ » appliquée
 * une seule fois.
 *
 * Exporté depuis que la page « Envoi des emails » vit dans son propre
 * fichier (`email-templates.tsx`) : la recopier là-bas aurait fait deux
 * endroits où décider quand un champ de jeton s'affiche, et le second
 * aurait oublié la clé maîtresse.
 */
export function ChampSecret({
  bloc,
  nom,
  children,
  consequence,
  sansRetrait = false,
}: {
  bloc: SecretsBloc
  nom: string
  children?: ReactNode
  /** Ce qui s'arrête sans ce jeton, lu au moment de confirmer un retrait. */
  consequence?: ReactNode
  /** Masque le geste de retrait du champ — un bouton de ligne le porte. */
  sansRetrait?: boolean
}) {
  return (
    <SecretField
      etat={etatDe(bloc, nom)}
      consequence={consequence}
      sansRetrait={sansRetrait}
      // Sans clé maîtresse, l'écriture est refusée côté serveur : le champ
      // est masqué plutôt que de laisser taper une clé pour rien.
      disabled={!bloc.canWrite || bloc.cleMaitresse !== "posee"}
      onSave={(valeur) => bloc.onSave(nom, valeur)}
      onClear={() => bloc.onClear(nom)}
    >
      {children}
    </SecretField>
  )
}

// ---------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------

type AiPageProps = {
  secrets: SecretsBloc
  canWrite: boolean
  openRouterModel: string | null
  onSaveModel: (id: string) => Promise<unknown>
  openRouterImageModel: string | null
  onSaveImageModel: (id: string) => Promise<unknown>
  hideModelPickers?: boolean
  children?: ReactNode
}

export function AiPage({
  secrets,
  canWrite,
  children,
  hideModelPickers,
  ...models
}: AiPageProps) {
  return (
    <SettingsGroup title="Modèle IA">
      {secrets.cleMaitresse === null ? (
        <p className="text-sm text-muted-foreground">
          Réservée au propriétaire et aux administrateurs.
        </p>
      ) : (
        <>
          {secrets.cleMaitresse === "posee" ? null : (
            <CleMaitresseBandeau etat={secrets.cleMaitresse} />
          )}
          <Field>
            <FieldLabel>Clé OpenRouter</FieldLabel>
            <ChampSecret
              bloc={secrets}
              nom="OPENROUTER_API_KEY"
              consequence="La génération des champs SEO et GEO depuis l'éditeur ne fonctionnera plus."
            >
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                openrouter.ai/keys
                <ExternalLinkIcon aria-hidden="true" className="size-3" />
              </a>
            </ChampSecret>
          </Field>
        </>
      )}
      {hideModelPickers ? null : <AiModelFields canWrite={canWrite} {...models} />}
      {children}
    </SettingsGroup>
  )
}

// ---------------------------------------------------------------------
// Domaine & emails — RETIRÉE.
//
// `DomainAndEmailsPage` vivait ici et n'était plus rendue par personne :
// `/settings/domaine` a été réécrit (`routes/_authed/settings/domaine.tsx`)
// autour du domaine déclaré et de la vérification DNS, sans la reprendre.
// Elle est restée quelques heures en place, exportée, testée, et
// injoignable — du code mort qui a l'exacte apparence d'un écran vivant,
// ce qui est pire que pas de code du tout : on le lit en croyant lire ce
// que l'opérateur voit.
//
// Où sont parties ses deux moitiés :
//
//   • **la clé Resend, le mode d'essai et l'adresse d'expédition** sont
//     dans `email-templates.tsx` et `/settings/emails`. La saisie de
//     `RESEND_API_KEY` avait disparu de toute l'administration avec cette
//     réécriture — c'est la régression que ce nouvel écran referme ;
//   • **`SITE_URL`** est passée par `email-templates.tsx` (`OrigineDesLiens`)
//     un temps, puis en est repartie avec la refonte « états, étiquettes,
//     actions » (`settings-environment.test.tsx`) : un bloc qui n'était
//     qu'explication et commande n'a pas sa place sur un écran de réglages.
//     Elle vit maintenant à côté de `WEB_SITE_URL`, pour la même raison —
//     voir la ligne suivante ;
//   • **`WEB_SITE_URL`** et `SITE_URL` sont toutes deux nommées par
//     `routes/_authed/settings/domaine.tsx` (`AvertissementDivergence` pour
//     l'une, `OrigineDesLiens` de `components/domain-check.tsx` pour
//     l'autre) : le domaine déclaré y vit déjà, c'est la seule ligne de
//     base à laquelle comparer une origine.
// ---------------------------------------------------------------------

