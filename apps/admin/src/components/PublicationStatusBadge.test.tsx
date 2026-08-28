// Whole-lot review, the status-badge finding — the ruling reverses an
// earlier "no test infrastructure in apps/admin" call: that was a
// description, not a reason. `PublicationStatusBadge` is a pure function
// of its props and it is the *entire* implementation of the DoD line
// "propagation failure is visible in the interface" — five branches, one
// per `pages.publicationStatus` state plus the loading placeholder, all
// mapped to a distinct visible label/icon. Nothing about its actual
// correctness has ever been asserted before this file.
//
// `renderToStaticMarkup` (not `@testing-library/render` + `jsdom`) is the
// minimum harness for a one-shot "does this props shape produce this
// visible text/marker" assertion — see `vitest.config.ts`'s own header
// for why jsdom isn't pulled in for this.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { PublicationStatusBadge } from "./PublicationStatusBadge"
import type { PublicationStatus } from "./PublicationStatusBadge"

function render(status: PublicationStatus | undefined, pageStatus: "draft" | "published" = "published") {
  return renderToStaticMarkup(<PublicationStatusBadge status={status} pageStatus={pageStatus} />)
}

describe("PublicationStatusBadge", () => {
  test("query still loading (status undefined) shows the neutral placeholder", () => {
    const html = render(undefined)
    expect(html).toContain("…")
  })

  test("draft — no outbox activity to report — shows Brouillon", () => {
    const html = render({ state: "draft" })
    expect(html).toContain("Brouillon")
  })

  test("published — most recent outbox row is done — shows Publiée", () => {
    const html = render({ state: "published", publishedAt: Date.now() })
    expect(html).toContain("Publiée")
  })

  test("propagating — shows the in-progress state with the attempt count", () => {
    const html = render({ state: "propagating", attempts: 2 })
    expect(html).toContain("Propagation en cours")
    expect(html).toContain("2 tentatives")
  })

  // The one branch the DoD line is actually about: a publication that
  // silently failed to propagate must be visible, not indistinguishable
  // from "published". `title` carries `lastError` for an operator who
  // hovers/inspects; the visible label itself is what this test checks.
  test("failed — a propagation failure is visible, not silently indistinguishable from published", () => {
    const html = render({ state: "failed", lastError: "HTTP 500", attempts: 6 })
    expect(html).toContain("Échec de la propagation")
    expect(html).not.toContain("Publiée")
  })
})
