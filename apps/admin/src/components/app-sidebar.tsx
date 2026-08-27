import type { FunctionReturnType } from "convex/server"
import type { api } from "@astrotan/backend/convex/_generated/api"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, ShieldIcon, UsersIcon } from "lucide-react"

const DASHBOARD_ITEM = {
  title: "Tableau de bord",
  url: "/",
  icon: <LayoutDashboardIcon />,
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

export function AppSidebar({
  profile,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  profile: FunctionReturnType<typeof api.profiles.me> | undefined
}) {
  const navMain =
    profile?.role === "owner" || profile?.role === "admin"
      ? [DASHBOARD_ITEM, USERS_ITEM]
      : [DASHBOARD_ITEM]

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
