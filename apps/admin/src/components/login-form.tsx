import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"

// Adapted from shadcn's `login-03` block: dropped the OAuth buttons (the
// backend only enables `emailAndPassword` — packages/backend/convex/auth.ts
// — so those buttons would go nowhere) and "Don't have an account? Sign up"
// (`disableSignUp: true` on the server; accounts only ever come from an
// invitation). What's left is the one thing this screen actually does.
//
// The "Forgot your password?" link was dropped too, for as long as no reset
// flow existed — a link nobody can complete is worse than no link. It is
// back now that `/forgot-password` is a real screen, and it is the ONLY way
// anyone finds that screen: nothing else in this application links to it,
// and someone locked out is by definition someone who cannot look for it
// from the inside.
export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = await authClient.signIn.email({ email, password })
    setSubmitting(false)
    if (result.error) {
      setError(describeSignInError(result.error))
      return
    }
    await navigate({ to: "/" })
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Administration AstroTan</CardTitle>
          <CardDescription>Connectez-vous avec votre compte</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
                  <Link
                    to="/forgot-password"
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {error && <FieldError>{error}</FieldError>}
              <Field>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Connexion…" : "Se connecter"}
                </Button>
                <FieldDescription className="text-center">
                  L'accès se fait uniquement sur invitation.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// The UI only ever *reflects* what the server decided — it does not decide
// anything itself. `BANNED_USER` is better-auth's own built-in error code
// (`admin()` plugin, `error-codes.mjs`), raised automatically for a banned
// user's sign-in attempt — not something `packages/backend/convex/auth.ts`
// configures itself (it never sets the plugin's `bannedUserMessage`
// option, so the library's own default message applies server-side; this
// screen only ever branches on the *code*, never renders that message).
// It's the one better-auth sign-in error worth naming specifically here;
// every other *business* failure (wrong password, unknown email, ...)
// collapses to one message on purpose, so a login attempt can't be used to
// enumerate which emails have accounts.
//
// `SIGN_IN_RATE_LIMITED` (packages/backend/convex/auth.ts's `hooks.before`,
// via `lib/signInRateLimit.ts`) is named here for the same reason
// `BANNED_USER` is, not an exception to the rule above: the backend
// already deliberately rate-limits a known and an unknown email identically
// (see that module's own header comment), so surfacing this one distinctly
// reveals nothing about whether the typed address has an account — only
// that *this* (origin, email) pair has been tried too many times. Folding
// it into "Email ou mot de passe incorrect" would repeat the exact mistake
// Task 9 found and fixed for an unreachable backend: telling a legitimate
// owner to re-check credentials that were never actually re-checked, which
// (worse, here) invites exactly the retry behavior the rate limit exists
// to slow down.
//
// A `status >= 500` (or no status at all — better-fetch reports a network
// failure the same shapeless way) is a different kind of thing and is
// called out separately: verified live, with the local Convex backend
// down, that this proxy answers `sign-in/email` with a bare `{status:500,
// message:"HTTPError"}` and no `code` — collapsing that into "wrong
// password" would tell a locked-out operator to double-check credentials
// that were never actually checked.
function describeSignInError(error: {
  code?: string
  status?: number
  message?: string | null
}): string {
  if (error.code === "BANNED_USER") {
    return "Votre compte a été suspendu. Contactez un administrateur."
  }
  if (error.code === "SIGN_IN_RATE_LIMITED") {
    return "Trop de tentatives de connexion. Réessayez dans quelques instants."
  }
  if (error.status === undefined || error.status >= 500) {
    return "Impossible de contacter le serveur. Réessayez dans un instant."
  }
  return "Email ou mot de passe incorrect."
}
