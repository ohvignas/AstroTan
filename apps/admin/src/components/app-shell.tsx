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
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">Administration</span>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
