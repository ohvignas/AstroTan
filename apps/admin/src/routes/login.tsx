import { createFileRoute, Navigate } from "@tanstack/react-router"
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react"
import { LoginForm } from "@/components/login-form"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  return (
    <>
      {/* Same interval as `_authed.tsx`'s `<AuthLoading>` — avoid a flash
          of the login form for a visitor who is, in fact, already signed
          in. */}
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center p-8 text-sm text-muted-foreground">
          Chargement…
        </div>
      </AuthLoading>
      {/* `<Navigate>`, not `throw redirect(...)` — see `_authed.tsx` for
          why: thrown from inside a render tree (rather than a route
          `beforeLoad`/`loader`), it is not a supported redirect mechanism
          in this stack and crashes SSR instead of producing a real
          response. */}
      <Authenticated>
        <Navigate to="/" />
      </Authenticated>
      <Unauthenticated>
        <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
          <div className="w-full max-w-sm">
            <LoginForm />
          </div>
        </div>
      </Unauthenticated>
    </>
  )
}
