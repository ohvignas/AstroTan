import { useCallback } from "react"
import type { ReactNode } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { describeSettingsError } from "@/lib/settingsErrors"
import type { SecretsBloc } from "@/components/settings-environment"
import { refusDuVerdict } from "@/components/settings-secrets"
import { SaveBar } from "@/components/save-bar"
import type { AutoSave } from "@/components/save-bar"
import {
  SETTINGS_PAGES,
  SettingsPageHeader,
} from "@/components/settings-nav"
import type { SettingsPath } from "@/components/settings-nav"
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-guard"

// ---------------------------------------------------------------------
// Ce que les sept pages de réglages ont en commun.
//
// Avec un seul écran, ce fichier n'aurait pas lieu d'être. Avec sept
// routes, chacune redemanderait le profil, referait le calcul du rôle,
// réécrirait son en-tête et — le vrai risque — oublierait tôt ou tard son
// garde-fou de modifications non enregistrées. Une page qui l'oublie ne
// casse rien de visible : elle perd du travail en silence, ce qui est
// précisément le défaut qu'on ne remarque qu'en production.
// ---------------------------------------------------------------------

function pageFor(to: SettingsPath) {
  const page = SETTINGS_PAGES.find((candidate) => candidate.to === to)
  if (page === undefined) throw new Error(`Page de réglages inconnue : ${to}`)
  return page
}

/**
 * Le rôle du visiteur, et s'il a le droit d'écrire.
 *
 * `api.profiles.me` est déjà souscrite par `AppShell` : ceci réutilise
 * l'abonnement, comme `routes/_authed/pages/index.tsx`.
 *
 * `canWrite` ne décide RIEN côté serveur — `settings.update` et
 * `settings.setHomePage` appellent tous deux
 * `requireRole(["owner","admin"])` et refusent un editor quoi qu'il
 * arrive. Il décide seulement de ce qui s'affiche : des valeurs en
 * lecture et une phrase qui dit pourquoi, plutôt qu'un formulaire dont
 * chaque contrôle revient refusé.
 */
export function useSettingsAccess(): { loading: boolean; canWrite: boolean } {
  const profile = useQuery(api.profiles.me)
  if (profile === undefined) return { loading: true, canWrite: false }
  return {
    loading: false,
    canWrite: profile.role === "owner" || profile.role === "admin",
  }
}

export function SettingsLoading() {
  return <p className="text-sm text-muted-foreground">Chargement…</p>
}

/** En-tête + contenu. Pour les pages qui n'enregistrent rien. */
export function SettingsPageShell({
  to,
  canWrite,
  children,
}: {
  to: SettingsPath
  canWrite: boolean
  children: ReactNode
}) {
  return (
    <>
      <SettingsPageHeader page={pageFor(to)} canWrite={canWrite} />
      {children}
    </>
  )
}

/**
 * En-tête + contenu + barre d'enregistrement + garde-fou de sortie.
 *
 * La barre est rendue par CHAQUE page plutôt qu'une fois pour toutes dans
 * la mise en page : elle rapporte l'état d'un formulaire, et il n'y a
 * qu'un formulaire à l'écran à la fois. Une barre unique dans la mise en
 * page aurait dû aller chercher son état ailleurs — un contexte, un store
 * — pour dire exactement la même chose.
 *
 * `-mr-4 -mb-4` et non le défaut `-mx-4 -mb-4` : à gauche il y a
 * désormais la gouttière du menu, et déborder dedans ferait commencer le
 * filet du haut en plein milieu.
 */
export function SettingsFormShell({
  to,
  canWrite,
  autoSave,
  /** Ce qui se perdrait en quittant, en une phrase — « Le nom du site ». */
  unsavedLabel,
  /** Un refus connu d'avance qui doit aussi désactiver le bouton. */
  blocked = false,
  children,
}: {
  to: SettingsPath
  canWrite: boolean
  autoSave: AutoSave
  unsavedLabel: string
  blocked?: boolean
  children: ReactNode
}) {
  // « Modifié mais pas encore acquis par le serveur » : les deux seuls
  // états où quitter perdrait quelque chose. `saving` ne compte pas —
  // l'appel est parti — et `saved` non plus.
  const dirty =
    canWrite && (autoSave.status === "pending" || autoSave.status === "error")
  const guardDialog = useUnsavedChangesGuard({ dirty, what: unsavedLabel })

  return (
    <>
      <SettingsPageHeader page={pageFor(to)} canWrite={canWrite} />
      {children}
      {/* Ni barre ni sauvegarde automatique pour un editor : la mutation
          refuse de toute façon (`requireRole(["owner","admin"])`). */}
      {canWrite && (
        <SaveBar
          status={autoSave.status}
          lastSavedAt={autoSave.lastSavedAt}
          error={autoSave.error}
          canSave={autoSave.canSave && !blocked}
          onSave={autoSave.saveNow}
          className="-mr-4 -mb-4"
        />
      )}
      {guardDialog}
    </>
  )
}

// ---------------------------------------------------------------------
// Les jetons, pour les trois pages qui en portent.
// ---------------------------------------------------------------------

/**
 * Le rôle du visiteur ET l'état des jetons, pour les trois pages qui en
 * portent — un seul appel plutôt que deux, parce qu'aucune de ces pages
 * n'a de raison de connaître l'un sans l'autre.
 *
 * `secrets.status` est réservée à owner/admin — savoir quelles clés sont
 * posées, lesquelles manquent et laquelle est illisible dessine l'état de
 * sécurité du déploiement — d'où le `"skip"` pour un editor et le
 * `cleMaitresse: null` qui en découle : les pages affichent alors une
 * phrase à la place des champs, plutôt qu'un cadre vide.
 *
 * Elle rend encore `quatreDerniers` et `majAt`, que plus personne
 * n'affiche : `SecretEtat` ne les déclare plus, et les quatre derniers
 * caractères d'une clé sont un fragment de secret qui n'a plus de raison
 * de traverser le réseau. Les retirer de la query est un changement de
 * backend, à faire là-bas.
 *
 * `useAction` et non `useMutation` pour l'écriture, et ce n'est pas une
 * préférence : AES-GCM exige un IV aléatoire à chaque chiffrement, or
 * l'aléa d'une mutation Convex est ensemencé pour rester déterministe.
 * Voir `convex/secrets.ts`.
 *
 * L'enregistrement passe d'abord par `secretCheck.essayer`, qui présente
 * la clé à son service — voir `onSave`. C'est le seul endroit à le faire,
 * pour la même raison que les refus n'y sont traduits qu'une fois.
 */
export function useSecretsAccess(): {
  loading: boolean
  canWrite: boolean
  /** `undefined` tant que l'état des jetons n'est pas arrivé. */
  secrets: SecretsBloc | undefined
} {
  const { loading, canWrite } = useSettingsAccess()
  const status = useQuery(api.secrets.status, canWrite ? {} : "skip")
  const setSecret = useAction(api.secrets.set)
  const verifierSecret = useAction(api.secretCheck.essayer)
  const clearSecret = useMutation(api.secrets.clear)

  // Les refus serveur sont traduits ICI, une fois : le composant de champ
  // se contente d'afficher le message de l'erreur qu'il reçoit, et n'a
  // donc aucune raison de connaître les codes de `convex/secrets.ts`.
  const onSave = useCallback(
    async (nom: string, valeur: string) => {
      // ESSAYER AVANT DE RANGER. `secrets.set` chiffre n'importe quelle
      // chaîne : une clé fautive — une lettre perdue au collage, une clé
      // révoquée, celle d'un autre compte — s'enregistre exactement comme
      // une bonne, sous la même pastille. L'erreur ne se découvre alors
      // qu'au premier envoi raté, le jour où quelqu'un attend une
      // invitation qui n'arrivera pas, et personne ne fait le lien avec
      // une saisie faite trois semaines plus tôt.
      const verdict = await verifierSecret({ nom, valeur }).catch(
        (err: unknown) => {
          throw new Error(describeSettingsError(err))
        }
      )
      const refus = refusDuVerdict(verdict)
      // Un refus n'est PAS une erreur serveur : l'action a répondu, sa
      // réponse est « ce service ne veut pas de cette clé », rien n'a été
      // écrit, et le message est déjà celui que l'écran doit afficher.
      if (refus !== null) throw new Error(refus)
      try {
        // `nom` traverse l'interface en `string` — la liste des noms est
        // celle du serveur, rendue par `status`, et non une seconde copie
        // écrite ici qui pourrait diverger. Le validateur Convex refuse
        // tout nom hors de sa propre liste, donc le contrôle reste au bon
        // endroit.
        await setSecret({ nom: nom as never, valeur })
      } catch (err) {
        throw new Error(describeSettingsError(err))
      }
    },
    [setSecret, verifierSecret]
  )

  const onClear = useCallback(
    async (nom: string) => {
      try {
        await clearSecret({ nom: nom as never })
      } catch (err) {
        throw new Error(describeSettingsError(err))
      }
    },
    [clearSecret]
  )

  const secrets: SecretsBloc | undefined = !canWrite
    ? { cleMaitresse: null, etats: {}, canWrite: false, onSave, onClear }
    : status === undefined
      ? undefined
      : {
          cleMaitresse: status.cleMaitresse,
          etats: Object.fromEntries(status.secrets.map((s) => [s.nom, s])),
          canWrite: true,
          onSave,
          onClear,
        }

  return { loading, canWrite, secrets }
}
