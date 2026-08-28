import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MoreHorizontalIcon } from "lucide-react"

// ---------------------------------------------------------------------
// Les commandes d'une ligne de tableau
//
// Une icône seule est muette pour un lecteur d'écran et ambiguë pour tout
// le monde. Ces deux composants existent pour que le nom accessible et
// l'infobulle ne puissent pas être oubliés une ligne sur vingt : `label`
// est obligatoire, et il est posé sur le bouton *et* dans l'infobulle.
//
// L'appelant le contextualise — « Éditer la page Accueil », jamais
// « Éditer » : dans un tableau, vingt boutons portant le même nom ne
// disent pas lequel agit sur quoi. `tooltip` sert à raccourcir ce que lit
// la souris, puisqu'elle sait déjà de quelle ligne il s'agit : elle la
// survole.
// ---------------------------------------------------------------------

export function RowActionButton({
  label,
  tooltip,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "size" | "variant"> & {
  /** Nom accessible, contextualisé : « Éditer la page Accueil ». */
  label: string
  /** Texte de l'infobulle. Par défaut `label`. */
  tooltip?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Le menu « trois points » d'une ligne.
 *
 * Il replie tout ce qui n'est pas l'action courante, et d'abord les
 * actions irréversibles : une suppression ne doit pas être à un clic de
 * distance de l'édition.
 *
 * L'appelant ne le rend pas du tout quand toutes ses entrées sont masquées
 * pour le rôle en cours — un menu qui s'ouvre vide est pire qu'un menu
 * absent. Les entrées gardent leur libellé texte : c'est un menu, pas une
 * seconde barre d'icônes.
 */
export function RowActionsMenu({
  label,
  children,
}: {
  /** « Autres actions pour la page Accueil ». */
  label: string
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      {/* L'ordre d'imbrication n'est pas indifférent : c'est le composant
          extérieur qui fusionne ses props dans celui que `render` lui donne.
          Ainsi, `Menu.Trigger` pose bien `aria-haspopup="menu"` et
          `aria-expanded` sur le bouton. Imbriqué dans l'autre sens —
          `DropdownMenuTrigger render={<Tooltip>…}` — les deux attributs
          disparaissent, et le bouton n'annonce plus qu'il ouvre un menu. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={label} />
              }
            />
          }
        >
          <MoreHorizontalIcon />
        </TooltipTrigger>
        <TooltipContent>Autres actions</TooltipContent>
      </Tooltip>
      {/* `w-auto` écrase le `w-(--anchor-width)` par défaut du popup :
          ancré sur un bouton carré de 28 px, il rendrait un menu de 28 px
          de large. */}
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
