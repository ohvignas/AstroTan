import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { ConvexError } from "convex/values"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UserPlusIcon } from "lucide-react"

export const Route = createFileRoute("/_authed/users")({
  component: UsersPage,
})

type Profile = FunctionReturnType<typeof api.profiles.me>
type Role = Profile["role"]
type UserRow = FunctionReturnType<typeof api.users.list>[number]
type InvitationRow = FunctionReturnType<typeof api.invitations.list>[number]

const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  editor: "Éditeur",
}

// `owner` deliberately excluded: it's never an assignable role here — not
// on an existing user's row (the single-owner invariant refuses every path
// that would try) and not on an invitation (`invitations.create` refuses
// `role: "owner"` unconditionally, Task 8). Passed as `items` to `<Select>`
// so `<SelectValue>` renders the French label instead of the raw stored
// value — Base UI's `Select.Value`, unlike Radix's, only tracks a selected
// item's rendered label automatically when the root is given `items`.
const EDITABLE_ROLE_ITEMS: Record<"admin" | "editor", string> = {
  admin: ROLE_LABELS.admin,
  editor: ROLE_LABELS.editor,
}

// Every code any of this screen's mutations can throw — `users.setRole`/
// `remove` (packages/backend/convex/users.ts), `invitations.create`/`revoke`
// (Task 8) — mapped to an operator-facing message. Unrecognized codes fall
// through to a generic message rather than a blank one: the server refused
// for a reason this screen doesn't have specific copy for yet, not for no
// reason at all.
//
// Minor (Lot 1 final review, re-review): that claim of completeness was
// false until `INVITATION_ALREADY_PENDING`/`ACCOUNT_ALREADY_EXISTS` were
// added below — `invitations.create`'s own `by_email` duplicate checks
// (Lot 1 final review) throw both, and neither was here, so the two most
// common operator mistakes (re-inviting someone already invited, or
// already onboarded) rendered the generic fallback message instead of
// telling the operator what actually went wrong.
const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : vous n'avez pas l'autorité pour ceci.",
  LAST_OWNER:
    "Impossible : le dernier propriétaire ne peut être ni rétrogradé ni retiré.",
  OWNER_ALREADY_EXISTS:
    "Impossible : il ne peut exister qu'un seul propriétaire.",
  INVALID_ROLE: "Rôle invalide.",
  UNCLASSIFIABLE_TARGET_ROLE: "Le rôle actuel de cet utilisateur est invalide.",
  CANNOT_VERIFY_OWNER_INVARIANT:
    "Le serveur n'a pas pu vérifier cette action. Réessayez.",
  NOT_FOUND: "Introuvable — a peut-être déjà été modifié ailleurs.",
  CANNOT_REMOVE_SELF: "Vous ne pouvez pas vous retirer vous-même.",
  INVALID_EMAIL: "Adresse email invalide.",
  ALREADY_ACCEPTED: "Cette invitation a déjà été acceptée.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  INVITATION_ALREADY_PENDING:
    "Une invitation est déjà en attente pour cette adresse email.",
  ACCOUNT_ALREADY_EXISTS: "Un compte existe déjà pour cette adresse email.",
}

function describeError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    const code =
      data && typeof data === "object" && "code" in data
        ? (data as { code?: unknown }).code
        : undefined
    if (typeof code === "string" && ERROR_MESSAGES[code])
      return ERROR_MESSAGES[code]
  }
  return "Une erreur inattendue est survenue."
}

function UsersPage() {
  // Already subscribed by `AppShell` — reuses that subscription.
  const profile = useQuery(api.profiles.me)

  if (profile === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // Courtesy only, per the property this screen must uphold: `users.list`/
  // `setRole`/`remove` re-check the caller's role themselves via
  // `requireRole`. An editor who reaches this route directly (typed URL,
  // disabled JS elsewhere, forged navigation) gains nothing this early
  // return would not already have refused — the point of checking it here,
  // before ever issuing `api.users.list`, is that an editor never fires a
  // query the server was always going to reject anyway.
  if (profile.role === "editor") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accès refusé</CardTitle>
          <CardDescription>
            Cette section est réservée au propriétaire et aux administrateurs.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return <UsersScreen selfAuthUserId={profile.authUserId} />
}

function UsersScreen({ selfAuthUserId }: { selfAuthUserId: string }) {
  const users = useQuery(api.users.list)
  const invitations = useQuery(api.invitations.list)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">
            Gérer les comptes et les invitations en attente.
          </p>
        </div>
        <InviteDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={users} selfAuthUserId={selfAuthUserId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations en attente</CardTitle>
          <CardDescription>
            Le lien est la voie de récupération documentée si l'envoi de l'email
            échoue — aujourd'hui, il échoue systématiquement (aucune clé Resend
            n'est configurée).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationsTable invitations={invitations} />
        </CardContent>
      </Card>
    </div>
  )
}

function UsersTable({
  users,
  selfAuthUserId,
}: {
  users: UserRow[] | undefined
  selfAuthUserId: string
}) {
  const setRole = useMutation(api.users.setRole)
  const removeUser = useMutation(api.users.remove)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  if (users === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  async function handleRoleChange(userId: string, role: Role) {
    setError(null)
    setPendingId(userId)
    try {
      await setRole({ userId, role })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPendingId(null)
    }
  }

  async function handleRemove(userId: string) {
    setError(null)
    setPendingId(userId)
    try {
      await removeUser({ userId })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserTableRow
              key={user.id}
              user={user}
              isSelf={user.id === selfAuthUserId}
              pending={pendingId === user.id}
              onRoleChange={(role) => handleRoleChange(user.id, role)}
              onRemove={() => handleRemove(user.id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UserTableRow({
  user,
  isSelf,
  pending,
  onRoleChange,
  onRemove,
}: {
  user: UserRow
  isSelf: boolean
  pending: boolean
  onRoleChange: (role: Role) => void
  onRemove: () => void
}) {
  const role = user.role
  // Courtesy, not enforcement: an owner row can never legitimately change
  // role or be removed by this screen's actions — the single-owner
  // invariant (`assertOwnerInvariant`, `databaseHooks`) refuses every path
  // that would try, for every caller, always. Showing an inert badge
  // instead of a control that would only ever come back refused is what
  // "hiding is a courtesy" means here; `setRole`/`remove` refuse it
  // server-side regardless of what renders.
  const canChangeRole = role !== null && role !== "owner"
  const canRemove = !isSelf && role !== "owner"

  return (
    <TableRow>
      <TableCell className="font-medium">
        {user.displayName}
        {isSelf && (
          <span className="ml-2 text-xs text-muted-foreground">(vous)</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{user.email}</TableCell>
      <TableCell>
        {canChangeRole ? (
          <Select
            items={EDITABLE_ROLE_ITEMS}
            value={role}
            disabled={pending}
            onValueChange={(value) => onRoleChange(value as Role)}
          >
            <SelectTrigger size="sm" aria-label={`Rôle de ${user.displayName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
              <SelectItem value="editor">{ROLE_LABELS.editor}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant={role === "owner" ? "default" : "outline"}>
            {role ? ROLE_LABELS[role] : "Rôle inconnu"}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canRemove && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" disabled={pending} />
              }
            >
              Retirer
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Retirer {user.displayName} ?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Le compte est supprimé et son accès révoqué immédiatement.
                  Cette action est irréversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onRemove}>
                  Retirer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  )
}

function InvitationsTable({
  invitations,
}: {
  invitations: InvitationRow[] | undefined
}) {
  const revoke = useMutation(api.invitations.revoke)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<Id<"invitations"> | null>(null)

  if (invitations === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // `list` also returns already-accepted invitations (kept as an audit
  // trail — see `invitations.ts`'s own comment on why `revoke` refuses
  // them); this screen shows only what an operator can still act on.
  const pending = invitations.filter(
    (invite) => invite.acceptedAt === undefined
  )

  async function handleRevoke(invitationId: Id<"invitations">) {
    setError(null)
    setPendingId(invitationId)
    try {
      await revoke({ invitationId })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPendingId(null)
    }
  }

  if (pending.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune invitation en attente.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Expire le</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending.map((invite) => (
            <TableRow key={invite._id}>
              <TableCell>{invite.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(invite.expiresAt).toLocaleDateString("fr-FR")}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingId === invite._id}
                  onClick={() => handleRevoke(invite._id)}
                >
                  Révoquer
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function InviteDialog() {
  const createInvitation = useMutation(api.invitations.create)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"admin" | "editor">("editor")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    token: string
    email: string
    role: "admin" | "editor"
  } | null>(null)

  const inviteLink =
    result && typeof window !== "undefined"
      ? `${window.location.origin}/accept-invite?token=${result.token}`
      : null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { token } = await createInvitation({ email, role })
      setResult({ token, email, role })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Reset once the dialog has actually closed, so the form doesn't
      // visibly clear itself out from under an operator still reading the
      // result.
      setEmail("")
      setRole("editor")
      setError(null)
      setResult(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <UserPlusIcon data-icon="inline-start" />
        Inviter
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un utilisateur</DialogTitle>
          <DialogDescription>
            {result
              ? "Invitation créée — le lien ci-dessous est la seule façon de la récupérer une fois cette fenêtre fermée."
              : "Un lien à usage unique sera généré, valable 7 jours."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Invité·e : <span className="font-medium">{result.email}</span> (
              {ROLE_LABELS[result.role]})
            </p>
            <Field>
              <FieldLabel htmlFor="invite-link">Lien d'invitation</FieldLabel>
              {/* A text-bearing element, not an `<input>`: the link needs
                  to be readable and copyable, and this is also what
                  survives a plain-text read (e.g. Playwright's
                  `innerText()`) the way a form control's `.value` would
                  not. */}
              <div className="flex items-center gap-2">
                <div
                  id="invite-link"
                  data-testid="invite-link"
                  className="flex-1 overflow-x-auto rounded-lg border border-input bg-muted px-2.5 py-1.5 font-mono text-xs whitespace-nowrap"
                >
                  {inviteLink}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (inviteLink)
                      void navigator.clipboard.writeText(inviteLink)
                  }}
                >
                  Copier
                </Button>
              </div>
            </Field>
          </div>
        ) : (
          <form id="invite-form" onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-role">Rôle</FieldLabel>
                <Select
                  items={EDITABLE_ROLE_ITEMS}
                  value={role}
                  onValueChange={(value) =>
                    setRole(value as "admin" | "editor")
                  }
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  {/* `owner` is deliberately absent: `invitations.create`
                      refuses `role: "owner"` unconditionally (Task 8) — the
                      owner is bootstrapped out of band, never invited. */}
                  <SelectContent>
                    <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                    <SelectItem value="editor">{ROLE_LABELS.editor}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
          </form>
        )}

        <DialogFooter>
          {result ? (
            <DialogClose render={<Button />}>Fermer</DialogClose>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>
                Annuler
              </DialogClose>
              <Button
                type="submit"
                form="invite-form"
                disabled={submitting || email.trim().length === 0}
              >
                {submitting ? "Envoi…" : "Envoyer l'invitation"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
