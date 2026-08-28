import { Component, useState } from "react"
import type { ReactNode } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { ConvexError } from "convex/values"
import { api } from "@astrotan/backend/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Unauthenticated by design — this is how a brand new account comes into
// being, so by construction there is no session yet when this page loads.
// It must never sit inside `_authed` (which redirects anyone without a
// session straight to `/login`, defeating the whole point) and must never
// query anything that assumes one, `api.profiles.me` included.
export const Route = createFileRoute("/accept-invite")({
  // Plain function, not zod (not a dependency of this app): a missing or
  // non-string `token` search param resolves to `undefined`, which the page
  // renders as "invalid link" rather than letting an unrelated crash happen
  // deeper in the tree.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: AcceptInvitePage,
})

type Role = "owner" | "admin" | "editor"

const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  editor: "Éditeur",
}

function AcceptInvitePage() {
  const { token } = Route.useSearch()

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        {token ? (
          <PreviewErrorBoundary>
            <AcceptInviteCard token={token} />
          </PreviewErrorBoundary>
        ) : (
          <MessageCard
            title="Lien invalide"
            description="Ce lien d'invitation est incomplet. Demandez-en un nouveau à la personne qui vous a invité·e."
          />
        )}
      </div>
    </div>
  )
}

function MessageCard({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: { to: string; label: string }
}) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {action && (
        <CardContent className="flex justify-center">
          {/* `nativeButton={false}`: `Link` renders an `<a>`, not a
              `<button>` — Base UI's `Button` defaults to expecting the
              latter when composed via `render` and warns otherwise. */}
          <Button render={<Link to={action.to} />} nativeButton={false}>
            {action.label}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}

// --- Preview: what `invitations.preview` (unauthenticated, read-only) can --
// --- refuse before the visitor ever sees a form -----------------------------

type PreviewErrorCode = "INVALID" | "EXPIRED" | "ALREADY_ACCEPTED"

function previewCodeOf(error: unknown): PreviewErrorCode | null {
  if (!(error instanceof ConvexError)) return null
  const data = error.data
  if (!data || typeof data !== "object" || !("code" in data)) return null
  const code = (data as { code?: unknown }).code
  return code === "INVALID" || code === "EXPIRED" || code === "ALREADY_ACCEPTED"
    ? code
    : null
}

// Each code gets its own message on purpose — six tasks of backend work
// went into making these distinguishable, and collapsing them into one
// generic "invalid or expired" sentence would throw that away.
const PREVIEW_ERROR_CONTENT: Record<
  PreviewErrorCode,
  { title: string; description: string; action?: { to: string; label: string } }
> = {
  // Never hints whether the token ever existed — a revoked invitation and
  // one that was simply mistyped must read identically.
  INVALID: {
    title: "Lien invalide",
    description:
      "Ce lien d'invitation n'est pas valide. Demandez-en un nouveau à la personne qui vous a invité·e.",
  },
  EXPIRED: {
    title: "Invitation expirée",
    description:
      "Ce lien d'invitation a expiré (les invitations sont valables 7 jours). Demandez-en un nouveau.",
  },
  ALREADY_ACCEPTED: {
    title: "Compte déjà créé",
    description: "Un compte existe déjà pour cette invitation.",
    action: { to: "/login", label: "Aller à la connexion" },
  },
}

interface PreviewErrorBoundaryState {
  error: unknown
}

// Class component because `getDerivedStateFromError` requires one:
// `useQuery` (convex/react) throws synchronously during render when the
// query itself rejects, so whatever calls `useQuery(api.invitations
// .preview, ...)` — `AcceptInviteCard` below — must render underneath this
// boundary. Scoped to this one page rather than reusing
// `ProfileErrorBoundary`: that component's codes and its "sign out" action
// only make sense for an authenticated session, which this page never has.
class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error !== null) {
      const code = previewCodeOf(this.state.error)
      const content = code
        ? PREVIEW_ERROR_CONTENT[code]
        : {
            title: "Une erreur est survenue",
            description: "Réessayez dans un instant.",
          }
      return <MessageCard {...content} />
    }
    return this.props.children
  }
}

// --- accept: the form itself, and what its own failure modes mean ----------

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  // Same three codes `preview` can also throw — reachable here too on a
  // genuine race (revoked, expired, or accepted a second time between the
  // page loading and this submission).
  INVALID: "Ce lien d'invitation n'est plus valide.",
  EXPIRED: "Cette invitation a expiré. Demandez-en une nouvelle.",
  ALREADY_ACCEPTED:
    "Un compte existe déjà pour cette invitation. Connectez-vous plutôt.",
  WEAK_PASSWORD: "Le mot de passe doit contenir entre 8 et 128 caractères.",
  INVALID_NAME: "Le nom affiché n'est pas valide.",
  // The issuer re-check (Task 8, I2): the person who issued this invitation
  // has since been deleted, demoted, or banned. Never blames the visitor —
  // nothing they did is wrong here.
  UNAUTHENTICATED: "Cette invitation n'est plus valide.",
  FORBIDDEN: "Cette invitation n'est plus valide.",
  BANNED: "Cette invitation n'est plus valide.",
}

function describeAcceptError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    const code =
      data && typeof data === "object" && "code" in data
        ? (data as { code?: unknown }).code
        : undefined
    if (typeof code === "string" && ACCEPT_ERROR_MESSAGES[code]) {
      return ACCEPT_ERROR_MESSAGES[code]
    }
  }
  return "Une erreur inattendue est survenue."
}

function AcceptInviteCard({ token }: { token: string }) {
  // Once `accept` has succeeded, this stops subscribing (Convex's "skip"
  // sentinel) rather than continuing to watch the same token. Without this,
  // the reactive `preview` query — still watching this exact invitation —
  // sees its own row change (`acceptedAt` now set) and re-throws
  // ALREADY_ACCEPTED an instant later, right as `handleSubmit` is still
  // signing the person in: the error boundary would swap this card for
  // "Compte déjà créé" mid-flight, on a submission that just succeeded.
  // Not a dead end (`navigate` still fires from the still-running closure
  // below regardless of whether this component is showing that fallback),
  // but a wrong, alarming message to flash at someone whose account
  // creation just worked.
  const [accepted, setAccepted] = useState(false)

  // Read-only, unauthenticated (see `invitations.ts`'s `preview`) — this is
  // what lets the form show the invited email and role *before* the visitor
  // types anything, sourced from the invitation row itself, never from the
  // URL or any other visitor-suppliable input.
  const preview = useQuery(
    api.invitations.preview,
    accepted ? "skip" : { token }
  )
  const acceptInvitation = useMutation(api.invitations.accept)
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (preview === undefined) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          {accepted ? "Connexion en cours…" : "Chargement…"}
        </CardContent>
      </Card>
    )
  }

  // Narrowed into plain locals: TS doesn't carry `preview`'s non-undefined
  // narrowing from the guard above into `handleSubmit`'s closure (declared
  // later in this same render, but a separate function), so it re-widens
  // `preview` to possibly-undefined there. `email`/`role` are `const` from
  // this specific render's already-resolved value, so this is not a
  // behavior change — just what makes the narrowing visible to the closure
  // too.
  const { email, role } = preview

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const trimmedName = name.trim()
    try {
      await acceptInvitation({
        token,
        password,
        ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
      })
    } catch (err) {
      setSubmitting(false)
      setError(describeAcceptError(err))
      return
    }

    // Stop watching `preview` *before* the async sign-in below has a chance
    // to lose the race against Convex's own reactivity — see the comment on
    // `accepted`'s declaration above.
    setAccepted(true)

    // The account exists now, but `accept` is a Convex mutation — it never
    // sets a session cookie. Sign in immediately with the password just
    // chosen, against the invitation's own (server-read) email — never
    // anything the visitor typed into a field that could disagree with it —
    // so this can't be tricked into authenticating a different address.
    const result = await authClient.signIn.email({
      email,
      password,
    })
    setSubmitting(false)

    if (result.error) {
      // The account was created successfully; only the automatic sign-in
      // failed (a dropped connection, most likely). Land on the ordinary
      // login screen rather than a dead page — never with the token in the
      // URL or anywhere else in this redirect.
      void navigate({ to: "/login" })
      return
    }
    void navigate({ to: "/" })
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Créer votre compte</CardTitle>
        <CardDescription>
          Invitation pour{" "}
          <span className="font-medium text-foreground">{email}</span> — rôle{" "}
          {ROLE_LABELS[role]}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="accept-name">Nom affiché</FieldLabel>
              <Input
                id="accept-name"
                autoComplete="name"
                placeholder={email}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                Optionnel — {email} est utilisé par défaut.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="accept-password">Mot de passe</FieldLabel>
              <Input
                id="accept-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <FieldDescription>Entre 8 et 128 caractères.</FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Field>
              <Button
                type="submit"
                disabled={submitting || password.length === 0}
              >
                {submitting ? "Création…" : "Créer mon compte"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
