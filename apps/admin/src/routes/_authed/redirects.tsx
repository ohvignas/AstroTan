import { createContext, useContext, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
// From `convex/content.ts`, never from `convex/redirects.ts`: `content` is
// a pure module, while `redirects` reaches `_generated/server`, `_registry`
// and `lib/authz` → `auth.ts`. Importing the latter from a route drags the
// server into the browser bundle, which the Convex client reports once per
// function it finds — "Convex functions should not be imported in the
// browser." `redirects.ts` re-exports this constant, so nothing on the
// server side had to move with it.
import { MAX_REDIRECT_PATH_LENGTH } from "@astrotan/backend/convex/content"
import { describeRedirectError } from "@/lib/redirectErrors"
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/redirects")({
  component: RedirectsPage,
})

type RedirectRow = FunctionReturnType<typeof api.redirects.list>[number]
type RedirectCode = RedirectRow["code"]

// 301 and 302 are not interchangeable, and the difference is the operator's
// to make: a 301 is cached by the browser and taken as permanent by search
// engines, a 302 is neither.
const CODE_LABELS: Record<string, string> = {
  "301": "301 — permanente",
  "302": "302 — temporaire",
}

// ---------------------------------------------------------------------
// Where a refusal lands
//
// The `columns` array has to stay at module scope — a fresh one on every
// render invalidates the sorted row model built from it (`media.tsx` says
// the same) — so a cell cannot close over the page's `setError`. A context
// carries it instead.
//
// One banner for the whole screen rather than a message per row: the
// refusals that arrive from the toggle are long sentences (they name what
// occupies the path and what to do about it) and a table cell is the worst
// place to read one. The banner names the redirect it is about.
// ---------------------------------------------------------------------

const FeedbackContext = createContext<(message: string | null) => void>(() => {})

function useFeedback() {
  return useContext(FeedbackContext)
}

// ---------------------------------------------------------------------
// The table
//
// Only the sorting feature is registered, and only `alphanumeric` among
// the sort functions — v9 has no global feature set, so an unregistered
// feature is a type error rather than a silent no-op, and the built-ins
// left out stay out of the bundle.
//
// `from` is the only sortable column, which is the whole of what the
// operator ever wants: this list is read as "what happens to /x", so the
// question is always about the departure path. `to` and the code are
// looked at once a row is found, never scanned.
// ---------------------------------------------------------------------

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
})

const columnHelper = createColumnHelper<typeof features, RedirectRow>()

const columns = columnHelper.columns([
  columnHelper.accessor("from", {
    header: "Chemin de départ",
    sortFn: "alphanumeric",
    // Displayed with the leading slash the visitor types; stored without
    // it, because `normalizeSlug` strips it on the way in.
    cell: ({ getValue }) => (
      <span className="font-medium">/{getValue<string>()}</span>
    ),
  }),
  columnHelper.accessor("to", {
    header: "Destination",
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>()}</span>
    ),
  }),
  columnHelper.accessor("code", {
    header: "Code",
    enableSorting: false,
    // 301 and 302 are not interchangeable and the badge says which is
    // which: a 301 is cached by browsers and taken as permanent by search
    // engines, a 302 is neither.
    cell: ({ getValue }) => {
      const code = getValue<RedirectCode>()
      return (
        <Badge variant={code === 301 ? "secondary" : "outline"}>
          {code} · {code === 301 ? "permanente" : "temporaire"}
        </Badge>
      )
    },
  }),
  columnHelper.display({
    id: "enabled",
    header: "Active",
    cell: ({ row }) => <RedirectToggle redirect={row.original} />,
  }),
  columnHelper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RedirectActions redirect={row.original} />,
  }),
])

// ---------------------------------------------------------------------

function RedirectsPage() {
  // Already subscribed by `AppShell` — reuses that subscription, same
  // convention as the other screens.
  const profile = useQuery(api.profiles.me)

  if (profile === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  // Courtesy only: `redirects.list`, `create`, `update` and `remove` each
  // call `requireRole(["owner", "admin"])` and refuse an editor whatever
  // rendered here. The reason to check it *before* rendering the screen is
  // that `api.redirects.list` would otherwise be issued and throw
  // `FORBIDDEN` out of `useQuery` — an error boundary and a blank page,
  // where an editor deserves a sentence.
  if (profile.role === "editor") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accès refusé</CardTitle>
          <CardDescription>
            Les redirections changent ce que voit chaque visiteur du site :
            elles sont réservées au propriétaire et aux administrateurs.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return <RedirectsScreen />
}

function RedirectsScreen() {
  const redirects = useQuery(api.redirects.list)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  if (redirects === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  return (
    <FeedbackContext.Provider value={setFeedback}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-medium">Redirections</h1>
            <p className="text-sm text-muted-foreground">
              Une ancienne URL qui envoie vers la nouvelle. Certaines sont
              créées ici, d'autres automatiquement : renommer le slug d'une
              page publiée laisse une 301 depuis son ancienne adresse.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Nouvelle redirection
          </Button>
        </div>

        {feedback && (
          <div
            role="alert"
            className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <p>{feedback}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFeedback(null)}
              aria-label="Masquer le message"
            >
              Fermer
            </Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {redirects.length === 0
                ? "Aucune redirection"
                : `${redirects.length} redirection${redirects.length > 1 ? "s" : ""}`}
            </CardTitle>
            <CardDescription>
              Le chemin de départ est refusé s'il est déjà servi par une page,
              un article ou le code du site — une redirection passe avant la
              route, elle masquerait le contenu sans laisser de trace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {redirects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Rien à rediriger pour l'instant. Ce qui atterrit ici : une URL
                qui a circulé et n'existe plus, ou l'ancienne adresse d'une page
                renommée.
              </p>
            ) : (
              <RedirectsTable rows={redirects} />
            )}
          </CardContent>
        </Card>

        {createOpen && (
          <RedirectFormDialog mode="create" open onOpenChange={setCreateOpen} />
        )}
      </div>
    </FeedbackContext.Provider>
  )
}

function RedirectsTable({ rows }: { rows: RedirectRow[] }) {
  // `rows` is passed straight through: it is the array
  // `useQuery(api.redirects.list)` returned, and convex/react keeps that
  // reference stable between renders. Wrapping it would hand the table a
  // new array each render and invalidate the sorted row model.
  const table = useTable({ features, columns, data: rows })

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon className="size-3" />
                        ) : (
                          <ChevronsUpDownIcon className="size-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  // A disabled row is dimmed on what it *says* — not on
                  // its switch or its buttons, which stay fully legible
                  // because they are the only way back.
                  className={
                    row.original.enabled ||
                    cell.column.id === "enabled" ||
                    cell.column.id === "actions"
                      ? undefined
                      : "opacity-55"
                  }
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Enable / disable, and the refusal that makes this control worth care.
 *
 * Re-enabling re-runs the whole guard (`redirects.update` calls
 * `assertRedirectUsable` whenever the row will end up active), so it can be
 * refused — and that refusal is the interesting one. The operator disabled
 * this redirect at some point in order to free the path, and something has
 * very likely taken it since: that is precisely the sequence the third
 * write point exists to catch.
 *
 * The switch reads `redirect.enabled` off the live query rather than local
 * state, so a refused call leaves it showing what is actually stored — it
 * never appears to flip and then springs back. What the operator gets
 * instead is a sentence naming what now occupies the path.
 */
function RedirectToggle({ redirect }: { redirect: RedirectRow }) {
  const updateRedirect = useMutation(api.redirects.update)
  const setFeedback = useFeedback()
  const [pending, setPending] = useState(false)

  async function handleToggle(next: boolean) {
    setFeedback(null)
    setPending(true)
    try {
      await updateRedirect({ id: redirect._id, enabled: next })
    } catch (err) {
      setFeedback(
        describeRedirectError(
          err,
          // Only a re-enable gets the wrapped copy. Disabling cannot be
          // refused by the path guard — a disabled redirect shadows
          // nothing — so a failure there is an auth error and reads better
          // plain.
          next ? { action: "enable", from: redirect.from } : undefined
        )
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Switch
      checked={redirect.enabled}
      disabled={pending}
      aria-label={`Redirection depuis /${redirect.from}`}
      onCheckedChange={(checked) => void handleToggle(checked === true)}
    />
  )
}

function RedirectActions({ redirect }: { redirect: RedirectRow }) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        Modifier
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setDeleteOpen(true)}
      >
        Supprimer
      </Button>

      {editOpen && (
        <RedirectFormDialog
          mode="edit"
          redirect={redirect}
          open
          onOpenChange={setEditOpen}
        />
      )}
      <DeleteRedirectDialog
        redirect={redirect}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Create / edit
//
// One dialog for both, because they are the same three fields and the same
// refusals: `redirects.update` runs the identical guard as `create`
// whenever the row will end up active. Two components would be two copies
// of the error handling.
//
// `enabled` is deliberately absent from this form — the row's switch owns
// it, and a second control for one value is how the two get to disagree.
//
// Mounted only while open (`{open && <RedirectFormDialog …>}`), which is
// what makes `defaultValues` correct: `api.redirects.list` is a live
// subscription, so a dialog kept mounted across a save — or across another
// administrator's edit — would seed itself once and then re-open showing
// values the row no longer has. Re-mounting reads them fresh, and costs a
// `form.reset` dance that has to guess when the query has caught up.
// ---------------------------------------------------------------------

type FormProps =
  | { mode: "create"; redirect?: undefined; open: boolean; onOpenChange: (open: boolean) => void }
  | { mode: "edit"; redirect: RedirectRow; open: boolean; onOpenChange: (open: boolean) => void }

function RedirectFormDialog({ mode, redirect, open, onOpenChange }: FormProps) {
  const createRedirect = useMutation(api.redirects.create)
  const updateRedirect = useMutation(api.redirects.update)
  const setFeedback = useFeedback()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      from: redirect?.from ?? "",
      to: redirect?.to ?? "",
      // Already `301 | 302` without a cast: the row's own literal union
      // meets a literal default. A 301 by default — the redirect an
      // operator reaches for is almost always a permanent move.
      code: redirect?.code ?? 301,
    },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        if (mode === "edit") {
          await updateRedirect({
            id: redirect._id,
            from: value.from,
            to: value.to,
            code: value.code,
          })
        } else {
          await createRedirect({
            from: value.from,
            to: value.to,
            code: value.code,
          })
        }
        // The banner above the table is about one refused toggle. Any
        // write that succeeds afterwards can make it stale — it may even
        // name a row that no longer exists — so it goes.
        setFeedback(null)
        handleOpenChange(false)
      } catch (err) {
        // Caught here rather than left to propagate: a rejection out of
        // `handleSubmit` is an unhandled promise rejection in the console
        // and nothing at all on screen. The dialog stays open — the
        // refusal is the most useful thing it will ever say, and closing
        // would take it down along with the values that caused it.
        setError(describeRedirectError(err))
      }
    },
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? `Modifier /${redirect.from}`
              : "Nouvelle redirection"}
          </DialogTitle>
          <DialogDescription>
            Le chemin de départ est une adresse que le site ne sert pas — sinon
            la redirection masquerait ce contenu et le serveur la refuse.
          </DialogDescription>
        </DialogHeader>

        <form
          id="redirect-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            <form.Field
              name="from"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Chemin de départ</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    maxLength={MAX_REDIRECT_PATH_LENGTH}
                    autoComplete="off"
                    placeholder="ancienne-page"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldDescription>
                    L'adresse à quitter, sur ce site. Le slash de tête est
                    facultatif : <code>/ancienne-page</code> et{" "}
                    <code>ancienne-page</code> désignent le même chemin.
                  </FieldDescription>
                </Field>
              )}
            />

            <form.Field
              name="to"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Destination</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    maxLength={MAX_REDIRECT_PATH_LENGTH}
                    autoComplete="off"
                    placeholder="/nouvelle-page"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldDescription>
                    Un chemin de ce site commençant par <code>/</code>, ou une
                    adresse complète en <code>https:</code>, <code>http:</code>,{" "}
                    <code>mailto:</code> ou <code>tel:</code>.
                  </FieldDescription>
                </Field>
              )}
            />

            <form.Field
              name="code"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Code HTTP</FieldLabel>
                  {/* `items` is what makes Base UI's `Select.Value`
                      render the label rather than the raw value — same
                      note as `routes/_authed/settings.tsx`. */}
                  <Select
                    items={CODE_LABELS}
                    value={String(field.state.value)}
                    onValueChange={(value) =>
                      field.handleChange(Number(value) as RedirectCode)
                    }
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CODE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Une 301 est mise en cache par le navigateur et suivie par
                    les moteurs de recherche, qui transfèrent l'ancienne
                    adresse vers la nouvelle. Une 302 ne fait ni l'un ni
                    l'autre — à réserver à un détour provisoire.
                  </FieldDescription>
                </Field>
              )}
            />
          </FieldGroup>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <form.Subscribe
            selector={(state) => state.isSubmitting}
            children={(isSubmitting) => (
              <Button type="submit" form="redirect-form" disabled={isSubmitting}>
                {isSubmitting
                  ? "Enregistrement…"
                  : mode === "edit"
                    ? "Enregistrer"
                    : "Créer"}
              </Button>
            )}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Confirm a deletion, and stay open when the server refuses it.
 *
 * The confirm button is a plain `<Button>` rather than an
 * `AlertDialogAction` for the reason `media.tsx` gives about its own: the
 * latter closes the dialog on click, which would take any refusal down
 * with it and leave the operator watching a row that simply did not
 * disappear.
 */
function DeleteRedirectDialog({
  redirect,
  open,
  onOpenChange,
}: {
  redirect: RedirectRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const removeRedirect = useMutation(api.redirects.remove)
  const setFeedback = useFeedback()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  async function handleDelete() {
    setError(null)
    setSubmitting(true)
    try {
      await removeRedirect({ id: redirect._id })
      // Same reason as the form dialog: a refusal banner naming a row that
      // has just been deleted is worse than no banner at all.
      setFeedback(null)
      handleOpenChange(false)
    } catch (err) {
      setError(describeRedirectError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer /{redirect.from} ?</AlertDialogTitle>
          <AlertDialogDescription>
            Les visiteurs qui arrivent sur /{redirect.from} recevront de nouveau
            une 404 au lieu d'être envoyés vers {redirect.to}. Pour libérer le
            chemin sans perdre la règle, désactivez-la plutôt.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={handleDelete}
          >
            {submitting ? "Suppression…" : "Supprimer"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
