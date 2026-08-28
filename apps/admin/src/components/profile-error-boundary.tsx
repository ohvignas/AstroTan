import { Component  } from "react"
import type {ReactNode} from "react";
import { useNavigate } from "@tanstack/react-router"
import { ConvexError } from "convex/values"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

// The three codes `requireRole` throws (packages/backend/convex/lib/authz.ts)
// plus the one `profiles.me` throws itself when a profile row is missing.
// Kept distinct on purpose — "sign in again", "you may not see this", and
// "your account is suspended" are different situations for an operator to
// be in, and collapsing them into one generic error message would hide
// which one it is.
type Code = "UNAUTHENTICATED" | "FORBIDDEN" | "BANNED" | "NOT_FOUND"

function codeOf(error: unknown): Code | null {
  if (!(error instanceof ConvexError)) return null
  const data = error.data
  if (!data || typeof data !== "object" || !("code" in data)) return null
  const code = (data as { code?: unknown }).code
  return code === "UNAUTHENTICATED" ||
    code === "FORBIDDEN" ||
    code === "BANNED" ||
    code === "NOT_FOUND"
    ? code
    : null
}

const MESSAGES: Record<Code, string> = {
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  FORBIDDEN: "Vous n'avez pas accès à cette section.",
  BANNED: "Votre compte a été suspendu. Contactez un administrateur.",
  NOT_FOUND: "Votre profil est introuvable. Contactez un administrateur.",
}

interface Props {
  children: ReactNode
}

interface State {
  error: unknown
}

// Class component because this is the one place React still requires it:
// `getDerivedStateFromError` only exists on class components. `useQuery`
// (convex/react) throws synchronously during render when the underlying
// query errored, so whatever calls `useQuery(api.profiles.me)` must render
// underneath this boundary.
export class ProfileErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error !== null) {
      const code = codeOf(this.state.error)
      return (
        <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {code ? MESSAGES[code] : "Une erreur inattendue est survenue."}
          </p>
          <SignOutButton />
        </div>
      )
    }
    return this.props.children
  }
}

function SignOutButton() {
  const navigate = useNavigate()
  return (
    <Button
      variant="outline"
      onClick={() => {
        void authClient.signOut().finally(() => navigate({ to: "/login" }))
      }}
    >
      Se déconnecter
    </Button>
  )
}
