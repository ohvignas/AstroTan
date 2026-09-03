import { expect, test } from "vitest"
import {
  applyWorkingPatch,
  applyWorkingToLive,
  overlayForEditor,
  snapshotLive,
  type WorkingCopy,
} from "./postWorkingCopy"

const live = {
  slug: "en-ligne",
  title: "Titre public",
  excerpt: "Chapô public",
  body: "<p>Corps public</p>",
  coverId: undefined,
  seo: { title: "SEO public" },
  geo: { summary: "GEO public" },
  targetKeyword: "mot public",
  tagIds: [] as WorkingCopy["tagIds"],
  status: "published" as const,
  createdBy: "u1",
  updatedBy: "u1",
} satisfies WorkingCopy & {
  status: "published"
  createdBy: string
  updatedBy: string
}

test("snapshotLive copie les champs édités, pas le statut", () => {
  const snap = snapshotLive(live)
  expect(snap.title).toBe("Titre public")
  expect(snap.body).toBe("<p>Corps public</p>")
  expect(snap).not.toHaveProperty("status")
})

test("applyWorkingPatch fusionne sans toucher les champs omis", () => {
  const next = applyWorkingPatch(snapshotLive(live), { title: "Titre brouillon" })
  expect(next.title).toBe("Titre brouillon")
  expect(next.body).toBe("<p>Corps public</p>")
  expect(next.slug).toBe("en-ligne")
})

test("applyWorkingPatch retire la couverture quand coverId est null", () => {
  const withCover = applyWorkingPatch(snapshotLive(live), {
    coverId: "k17333" as never,
  })
  expect(withCover.coverId).toBe("k17333")
  expect(applyWorkingPatch(withCover, { coverId: null }).coverId).toBeUndefined()
})

test("overlayForEditor superpose la working copy et signale les inédits", () => {
  const working = applyWorkingPatch(snapshotLive(live), { title: "Titre brouillon" })
  const overlaid = overlayForEditor({ ...live, workingCopy: working })
  expect(overlaid.title).toBe("Titre brouillon")
  expect(overlaid.hasUnpublishedChanges).toBe(true)
  expect(overlayForEditor(live).hasUnpublishedChanges).toBe(false)
  expect(overlayForEditor(live).title).toBe("Titre public")
})

test("applyWorkingToLive recopie la working copy et l'ôte", () => {
  const working = applyWorkingPatch(snapshotLive(live), { title: "Titre brouillon" })
  const next = applyWorkingToLive({ ...live, workingCopy: working })
  expect(next.title).toBe("Titre brouillon")
  expect(next).not.toHaveProperty("workingCopy")
  expect(next).not.toHaveProperty("hasUnpublishedChanges")
})
