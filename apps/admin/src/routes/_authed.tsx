import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router"
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react"
import { AppShell } from "@/components/app-shell"

// This layout is a UI convenience, not a security boundary: every Convex
// query and mutation behind it re-checks the caller's role itself
// (`requireRole`, packages/backend/convex/lib/authz.ts). A user who skips
// this layout entirely — forged request, direct API call, disabled JS —
// gains nothing it would not have granted them anyway. What this layout
// does is turn "the server would refuse" into "the screen never loads",
// which is worth doing for anyone using the app honestly.
export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
})

function AuthedLayout() {
  return (
    <>
      {/* Convex's own auth handshake (verifying the token against the
          backend over the websocket) only starts after the client mounts —
          it cannot resolve during SSR. `<AuthLoading>` covers exactly that
          window, both on first paint and on the brief re-check after any
          reload. */}
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center p-8 text-sm text-muted-foreground">
          Chargement…
        </div>
      </AuthLoading>
      {/* `<Navigate>`, not `throw redirect(...)`: this renders inside
          `<Unauthenticated>`, i.e. during the component tree's normal
          render pass, not a route `beforeLoad`/`loader` — the one place
          TanStack Router actually catches a thrown redirect and turns it
          into a real response. Thrown from here instead, React 19's
          `renderToReadableStream` treats it as an unhandled render error:
          confirmed with `curl -i` against this exact route — the server
          answered `200` with a broken shell and a
          `data-msg="Switched to client rendering because the server
          rendering errored"` marker, never a `307`. `<Navigate>` triggers
          the same navigation from a `useLayoutEffect` instead, which is
          inert during SSR (renders nothing, no error) and fires once
          mounted client-side. */}
      <Unauthenticated>
        <Navigate to="/login" />
      </Unauthenticated>
      {/* `<Authenticated>` reflects Convex's own verdict — never Better
          Auth's `useSession()`, which reports a user as signed in before
          Convex has verified the token, and a query issued in that window
          would fail. */}
      <Authenticated>
        <AppShell>
          <Outlet />
        </AppShell>
      </Authenticated>
    </>
  )
}
