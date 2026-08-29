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
    // Pas de `lg:items-start` ici, et c'est délibéré : il étirait sa
    // portée à TOUTE la rangée, colonne de droite comprise. Or c'est elle
    // qui contient la barre d'enregistrement, et une colonne qui s'arrête
    // à la fin de son contenu prive cette barre de toute course pour
    // coller en bas (voir `save-bar.tsx` et `app-shell.tsx`).
    //
    // Le menu, lui, a toujours besoin de ne PAS être étiré — étiré sur
    // toute la hauteur, son propre `sticky` n'a plus de course non plus.
    // Il porte donc son `lg:self-start` lui-même, dans `SettingsNav` : la
    // contrainte est déclarée sur l'élément qu'elle concerne, et n'atteint
    // plus son voisin par ricochet.
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
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
