import { expect, test } from "vitest"
import { postEditorActions } from "./postEditorActions"

test("un brouillon montre Publier, pas Annuler ni Dépublier", () => {
  expect(
    postEditorActions({
      status: "draft",
      hasUnpublishedChanges: false,
      canPublish: true,
      canWrite: true,
    }),
  ).toEqual({ showPublish: true, showDiscard: false, showUnpublish: false })
})

test("un publié sans inédits montre Dépublier seulement", () => {
  expect(
    postEditorActions({
      status: "published",
      hasUnpublishedChanges: false,
      canPublish: true,
      canWrite: true,
    }),
  ).toEqual({ showPublish: false, showDiscard: false, showUnpublish: true })
})

test("un publié avec inédits montre Publier et Annuler les modifications", () => {
  expect(
    postEditorActions({
      status: "published",
      hasUnpublishedChanges: true,
      canPublish: true,
      canWrite: true,
    }),
  ).toEqual({ showPublish: true, showDiscard: true, showUnpublish: true })
})

test("sans droit de publier, les boutons de publication restent cachés", () => {
  expect(
    postEditorActions({
      status: "published",
      hasUnpublishedChanges: true,
      canPublish: false,
      canWrite: true,
    }),
  ).toEqual({ showPublish: false, showDiscard: true, showUnpublish: false })
})
