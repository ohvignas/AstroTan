import type { ReactNode } from "react"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
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
