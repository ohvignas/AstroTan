import type { FunctionReturnType } from "convex/server"
import type { api } from "@astrotan/backend/convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { CheckIcon, CircleHelpIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"

// Pulled out of `routes/_authed/pages/$pageId.tsx` (whole-lot review, the
// status-badge finding): this is a pure, five-branch function of its
// props and it is the *entire* implementation of the DoD line "propagation
// failure is visible in the interface" — the review's own ruling reverses
// an earlier call that treated "no test infrastructure in apps/admin" as
// a reason to skip covering it. That was a description, not a reason:
// this file exists so `PublicationStatusBadge.test.tsx` can import a
// component with no `createFileRoute`/TanStack Router/Convex-hooks module
// graph attached to it at all — a route file is a poor test target
// regardless of how trivial the function inside it is.
export type PublicationStatus = FunctionReturnType<typeof api.pages.publicationStatus>

// The whole reason `revalidationOutbox` exists (Lot 2, Task 9's own
// brief, verbatim): "a publication that silently fails to propagate is
// the failure mode the outbox was built to make visible." `undefined` is
// the query still loading; `null` means `pages.get` already refused
// (shouldn't happen once the page itself resolved, kept exhaustive
// anyway).
export function PublicationStatusBadge({
  status,
  pageStatus,
}: {
  status: PublicationStatus | undefined
  pageStatus: "draft" | "published"
}) {
  if (status === undefined) {
    return <Badge variant="outline">…</Badge>
  }
  if (status === null || status.state === "draft") {
    return <Badge variant="outline">Brouillon</Badge>
  }
  if (status.state === "published") {
    return (
      <Badge variant="default">
        <CheckIcon data-icon="inline-start" />
        Publiée
      </Badge>
    )
  }
  if (status.state === "propagating") {
    return (
      <Badge variant="secondary">
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
        Propagation en cours ({status.attempts} tentative
        {status.attempts > 1 ? "s" : ""})
      </Badge>
    )
  }
  // Closing-fixes review: `pages.publicationStatus` returns this state
  // when the only outbox row it can find for this page predates the
  // `pageId` field and is therefore unindexable — it genuinely cannot
  // tell whether the last real propagation attempt succeeded or failed.
  // Rendering that as "Publiée" would be exactly the false-green badge
  // this whole review keeps flagging; rendering it as a distinct,
  // visibly-uncertain state is the honest alternative.
  if (status.state === "unknown") {
    return (
      <Badge variant="outline">
        <CircleHelpIcon data-icon="inline-start" />
        Statut de propagation inconnu
      </Badge>
    )
  }
  // "failed"
  return (
    <Badge variant="destructive" title={status.lastError ?? undefined}>
      <TriangleAlertIcon data-icon="inline-start" />
      Échec de la propagation
      {pageStatus === "published" ? "" : " (dernière tentative)"}
    </Badge>
  )
}
