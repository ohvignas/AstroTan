import { createFileRoute, Outlet } from "@tanstack/react-router"
import { SettingsNav } from "@/components/settings-nav"

// La mise en page commune aux sept pages de réglages : le menu à gauche,
// la page à droite.
//
// Une route de mise en page (`settings.tsx` + le dossier `settings/`), et
// non un composant que chaque page appellerait : le menu ne se démonte
// alors pas d'une page à l'autre — pas de clignotement, pas de position de
// défilement perdue dans la bande horizontale sur mobile — et il n'existe
// aucun moyen d'écrire une page de réglages qui l'oublie.
export const Route = createFileRoute("/_authed/settings")({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    // `items-start` est ce qui permet au menu de rester collé pendant que
    // la colonne de droite défile : étiré sur toute la hauteur,
    // `position: sticky` n'a plus de course.
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      <SettingsNav />
      {/* `min-w-0` : sans lui, un bloc de commande large (les `<pre>` des
          pages d'environnement) impose sa largeur à la colonne flex et
          pousse le menu hors de l'écran. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Outlet />
      </div>
    </div>
  )
}
