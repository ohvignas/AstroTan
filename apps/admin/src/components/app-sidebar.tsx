import type { FunctionReturnType } from "convex/server"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { leadsBadge } from "@/lib/leadsBadge"
import astrotanIcon from "@/assets/icon_astrotan.png"
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
  InboxIcon,
  ChartNoAxesColumnIcon,
  Settings2Icon,
  SignpostIcon,
  LayoutDashboardIcon,
  NewspaperIcon,
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
// La pastille compte les fiches encore en première colonne : c'est le seul
// nombre qui appelle une action, et le mettre dans le menu évite d'ouvrir
// l'écran pour découvrir qu'il n'y a rien de neuf.
const LEADS_ITEM = {
  title: "Leads",
  url: "/leads",
  icon: <InboxIcon />,
}

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

// Une ancre vers un relais de l'administration, pas un bouton : l'adresse
// d'Umami n'est connue qu'après un appel réseau, et ouvrir un onglet au clic
// pour le remplir ensuite se fait bloquer — essayé, le bouton ne faisait
// rien. Le relais `/statistiques` frappe le jeton puis redirige.
function statsSsoItem() {
  return {
    title: "Statistiques",
    url: "/statistiques",
    icon: <ChartNoAxesColumnIcon />,
    external: true,
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
  const newLeads = useQuery(api.leads.newCount)
  const leadsItem = {
    ...LEADS_ITEM,
    ...(leadsBadge(newLeads) === undefined ? {} : { badge: leadsBadge(newLeads) }),
  }

  const base =
    profile?.role === "owner" || profile?.role === "admin"
      ? [
          // L'ordre suit une journée de travail : on regarde comment va le
          // site, on écrit, on range, on répond, puis on administre.
          DASHBOARD_ITEM,
          PAGES_ITEM,
          POSTS_ITEM,
          MEDIA_ITEM,
          leadsItem,
          USERS_ITEM,
          REDIRECTS_ITEM,
        ]
      : [DASHBOARD_ITEM, PAGES_ITEM, POSTS_ITEM, MEDIA_ITEM, leadsItem]
  const canSso = profile?.role === "owner" || profile?.role === "admin"
  // Même périmètre que l'ancienne place des réglages dans la liste : un
  // éditeur ne les voyait pas, et déplacer l'entrée ne doit pas les lui
  // ouvrir.
  const canWriteSettings = canSso

  // Un owner ou un admin arrive connecté, avec les réglages d'Umami. Un
  // éditeur suit le lien de consultation : le SSO prête un compte partagé,
  // et le lui confier lui donnerait tout ce que ce compte peut faire.
  const navMain = umami
    ? [...base, canSso ? statsSsoItem() : statsItem(umami.dashboard)]
    : base

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {/* A single-tenant CMS admin has no organizations to switch
            between, so this is a static brand block, not the login-03/
            sidebar-07 template's interactive team switcher. */}
        {/* `justify-center` et padding nul une fois repliée : sinon l'icône
            reste calée à gauche derrière un padding devenu plus large
            qu'elle, et paraît coupée. */}
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {/* La même marque que le site public — le fichier est copié dans
              `apps/admin/src/assets/` parce que Vite ne suit pas un import
              hors de la racine de l'application. Deux copies d'un fichier
              qui change rarement, contre un import qui ne se résout pas. */}
          <img
            src={astrotanIcon}
            alt=""
            width={44}
            height={44}
            className="size-11 rounded-lg object-contain group-data-[collapsible=icon]:size-10"
          />
          {/* Le nom disparaît quand la barre est repliée : la colonne fait
              alors 56 px, et un texte tronqué à trois lettres n'apprend
              rien à personne. */}
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
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
        {/* Les réglages descendent ici, juste au-dessus du compte : on y va
            rarement, et une entrée rare posée au milieu des entrées
            quotidiennes se traverse vingt fois par jour pour rien. Le bas
            de la barre est l'endroit conventionnel de ce qui configure
            plutôt que de ce qui produit. */}
        {canWriteSettings && <NavMain items={[SETTINGS_ITEM]} label={null} />}
        <NavUser profile={profile} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
