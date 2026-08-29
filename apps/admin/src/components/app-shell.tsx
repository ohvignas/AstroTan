import type { ReactNode } from "react"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { AppSidebar } from "@/components/app-sidebar"
import { ProfileErrorBoundary } from "@/components/profile-error-boundary"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

// The chrome around every authenticated screen: sidebar + header. Rendered
// only inside `<Authenticated>` (see `_authed.tsx`), so `api.profiles.me`
// is safe to query here — Convex has already confirmed the session.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProfileErrorBoundary>
      <AppShellContent>{children}</AppShellContent>
    </ProfileErrorBoundary>
  )
}

function AppShellContent({ children }: { children: ReactNode }) {
  // Throws (caught by `ProfileErrorBoundary` above) if the profile is
  // missing, or if the caller turns out to be forbidden/banned — a role
  // can be revoked or a ban applied while this tab stays open, and the
  // next read here is what catches that, not just the initial page load.
  const profile = useQuery(api.profiles.me)

  return (
    <SidebarProvider>
      <AppSidebar profile={profile} />
      {/* `min-w-0` sur les deux conteneurs, et ce n'est pas cosmétique.
          Un élément flex a `min-width: auto` par défaut : il refuse de
          devenir plus étroit que son contenu. Le tableau des leads a cinq
          colonnes et son propre `overflow-x-auto` — sans cette contrainte,
          il n'était jamais clippé : il élargissait l'inset, qui élargissait
          la page, et le navigateur ajoutait SA barre de défilement par
          dessus celle du tableau. D'où les deux barres, dont une qui
          emporte toute la page.

          Posé ici plutôt que sur l'écran des leads : n'importe quel écran
          avec un tableau large rouvrirait le même défaut, et personne ne
          ferait le lien. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">Administration</span>
        </header>
        {/* `*:has-[[data-slot=save-bar]]:flex-1` — l'écran qui porte une
            barre d'enregistrement descend jusqu'en bas de la fenêtre.

            Ce conteneur-ci fait déjà toute la hauteur (`flex-1`), mais un
            écran est un élément de flex en colonne : sur l'axe principal
            il se dimensionne sur son contenu, et s'arrête donc là où le
            contenu s'arrête. La barre est collante par rapport à la
            FENÊTRE (`sticky bottom-0`) mais bornée par SON PARENT — sur un
            écran plus court que la fenêtre, ce parent finissait à
            mi-hauteur et la barre avec lui, sans une once de course pour
            coller. Le `mt-auto` de `SaveBar` n'a d'espace libre à manger
            que si la colonne descend d'abord jusqu'en bas.

            Posé ici, sur la présence de la barre, plutôt qu'écran par
            écran : les quatre pages de réglages et les deux éditeurs
            l'obtiennent sans rien déclarer, et le prochain écran qui
            rendra une `SaveBar` aussi. Et ciblé plutôt que `*:flex-1` :
            un écran SANS barre n'a aucune raison de s'étirer, et les
            écrans qui rendent plusieurs blocs frères se partageraient
            alors l'espace libre. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 *:has-[[data-slot=save-bar]]:flex-1">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
