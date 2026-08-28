import type { FunctionReturnType } from "convex/server"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  FileTextIcon,
  ImageIcon,
  ChartNoAxesColumnIcon,
  Settings2Icon,
  SignpostIcon,
  LayoutDashboardIcon,
  NewspaperIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"

const DASHBOARD_ITEM = {
  title: "Tableau de bord",
  url: "/",
  icon: <LayoutDashboardIcon />,
}

// Open to all three roles — design spec §5's role table: an editor reads
// every page (just not another editor's own write access), so the list
// screen itself (`routes/_authed/pages/index.tsx`) has nothing to refuse
// an editor for. The publish control inside that screen is what's
// role-gated, not this link.
const PAGES_ITEM = {
  title: "Pages",
  url: "/pages",
  icon: <FileTextIcon />,
}

// Same reasoning as `PAGES_ITEM`: an editor writes articles and manages
// media, so both links are open to all three roles. What an editor cannot
// do — publish an article, delete someone else's media — is refused inside
// those screens and again in the mutations, not by hiding a link.
const POSTS_ITEM = {
  title: "Articles",
  url: "/posts",
  icon: <NewspaperIcon />,
}

const MEDIA_ITEM = {
  title: "Médias",
  url: "/media",
  icon: <ImageIcon />,
}

// Owner/admin only, like "Utilisateurs": the site's name, logo and home
// page apply to every page at once, so `settings.update` and
// `settings.setHomePage` both refuse an editor server-side. Hiding the link
// is the courtesy, never the enforcement.
const SETTINGS_ITEM = {
  title: "Réglages",
  url: "/settings",
  icon: <Settings2Icon />,
}

// Owner/admin only: a redirect changes what every visitor of the site sees,
// which is not an editor's call. `redirects.*` refuse an editor server-side.
const REDIRECTS_ITEM = {
  title: "Redirections",
  url: "/redirects",
  icon: <SignpostIcon />,
}

// "Utilisateurs" is added only for owner/admin — a courtesy, per Task 10's
// property: `/users` itself (`routes/_authed/users.tsx`) refuses an editor
// server-side regardless of whether this link is rendered, so hiding it is
// not what makes the screen safe.
const USERS_ITEM = {
  title: "Utilisateurs",
  url: "/users",
  icon: <UsersIcon />,
}

// Rendu seulement quand Umami répond une adresse : un bouton qui ouvre un
// onglet vide est pire que pas de bouton.
function statsItem(url: string) {
  return {
    title: "Statistiques",
    url,
    icon: <ChartNoAxesColumnIcon />,
    external: true,
  }
}

function statsSsoItem(onSelect: () => void) {
  return {
    title: "Statistiques",
    url: "",
    icon: <ChartNoAxesColumnIcon />,
    external: true,
    onSelect,
  }
}

export function AppSidebar({
  profile,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  profile: FunctionReturnType<typeof api.profiles.me> | undefined
}) {
  // `undefined` pendant le chargement, `null` si Umami n'est pas configuré.
  const umami = useQuery(api.analytics.umamiLinks)

  const base =
    profile?.role === "owner" || profile?.role === "admin"
      ? [DASHBOARD_ITEM, PAGES_ITEM, POSTS_ITEM, MEDIA_ITEM, USERS_ITEM, REDIRECTS_ITEM, SETTINGS_ITEM]
      : [DASHBOARD_ITEM, PAGES_ITEM, POSTS_ITEM, MEDIA_ITEM]
  const ssoLink = useAction(api.analytics.ssoLink)
  const canSso = profile?.role === "owner" || profile?.role === "admin"

  function openUmami() {
    // L'onglet est ouvert MAINTENANT, dans le geste de l'utilisateur, et
    // rempli quand l'adresse arrive. Ouvrir après l'attente réseau, c'est
    // se faire bloquer comme une fenêtre surgissante — le clic n'est plus
    // « récent » aux yeux du navigateur.
    const tab = window.open("", "_blank", "noopener,noreferrer")
    ssoLink({})
      .then((url) => {
        // `url` est `null` quand Umami ne peut pas frapper de jeton
        // (Redis absent, identifiants refusés). La page de connexion reste
        // une issue, là où un onglet vide n'en est pas une.
        const destination = url ?? umami?.dashboard
        if (!tab || !destination) return
        tab.location.href = destination
      })
      .catch(() => {
        if (tab && umami) tab.location.href = umami.dashboard
      })
  }

  // Un owner ou un admin arrive connecté, avec les réglages d'Umami. Un
  // éditeur suit le lien de consultation : le SSO prête un compte partagé,
  // et le lui confier lui donnerait tout ce que ce compte peut faire.
  const navMain = umami
    ? [...base, canSso ? statsSsoItem(openUmami) : statsItem(umami.dashboard)]
    : base

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {/* A single-tenant CMS admin has no organizations to switch
            between, so this is a static brand block, not the login-03/
            sidebar-07 template's interactive team switcher. */}
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <ShieldIcon className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">AstroTan</span>
            <span className="truncate text-xs text-sidebar-foreground/70">
              Administration
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser profile={profile} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
