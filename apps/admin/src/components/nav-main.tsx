import { Link, useRouterState } from "@tanstack/react-router"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react"

/**
 * Correspondance par préfixe, sauf à la racine.
 *
 * `/settings` doit rester allumé sur `/settings/identite`. `/` ne le doit
 * pas : un `startsWith("/")` allumerait tout le menu à la fois. La barre
 * finale est tolérée — le navigateur peut l'ajouter.
 */
export function isSidebarPathActive(pathname: string, url: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  const target = url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url
  if (target === "/") return path === "/"
  return path === target || path.startsWith(`${target}/`)
}

export function NavMain({
  items,
  label = "Administration",
}: {
  /** Titre du groupe. `null` pour n'en afficher aucun — le groupe des
      réglages, en pied de barre, n'a rien à annoncer : une entrée seule
      sous un titre pèse plus que l'entrée elle-même. */
  label?: string | null
  items: {
    title: string
    url: string
    icon?: React.ReactNode
    isActive?: boolean
    /** Quitte l'admin : rendu en `<a>`, jamais en `<Link>` du routeur. */
    external?: boolean
    badge?: number
    items?: {
      title: string
      url: string
    }[]
  }[]
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <SidebarGroup>
      {label !== null && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => {
          const active = isSidebarPathActive(pathname, item.url)
          return item.items && item.items.length > 0 ? (
            <Collapsible
              key={item.title}
              defaultOpen={item.isActive ?? active}
              className="group/collapsible"
              render={<SidebarMenuItem />}
            >
              <CollapsibleTrigger
                render={<SidebarMenuButton tooltip={item.title} isActive={active} />}
              >
                {item.icon}
                <span>{item.title}</span>
                <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton render={<Link to={subItem.url} />}>
                        <span>{subItem.title}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            // No children: a plain link, not a disclosure trigger with
            // nothing to disclose.
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={active}
                render={
                  // Un `<Link>` du routeur sur une adresse externe tente une
                  // navigation interne et rend une 404 de l'admin. Il faut
                  // une vraie ancre — avec `noopener`, sans quoi la page
                  // ouverte garde une poignée sur celle-ci.
                  item.external ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" />
                  ) : (
                    <Link
                      to={item.url}
                      {...(active ? { "aria-current": "page" as const } : {})}
                    />
                  )
                }
              >
                {item.icon}
                <span>{item.title}</span>
                {typeof item.badge === "number" && item.badge > 0 && (
                  <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                )}
                {/* Poussée tout à droite, à la place du chevron d'un menu
                    dépliant : c'est là que l'œil cherche ce qui va se
                    passer. Elle prévient qu'on quitte l'administration —
                    l'onglet qui s'ouvre n'est pas une page de plus ici. */}
                {item.external && (
                  <ExternalLinkIcon className="ml-auto size-3.5 opacity-60" />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
