import { expect, test } from "vitest"
import { accesFicheDemo } from "./accesFicheDemo"

test("editor démo : essaie sans enregistrer une page publiée, ne la supprime pas", () => {
  expect(
    accesFicheDemo({
      role: "editor",
      isOwn: false,
      published: true,
      isDemo: true,
    }),
  ).toEqual({
    canPersist: false,
    canTry: true,
    canPublish: false,
    canDelete: false,
  })
})

test("editor démo : brouillon à lui, enregistre et peut supprimer", () => {
  expect(
    accesFicheDemo({
      role: "editor",
      isOwn: true,
      published: false,
      isDemo: true,
    }),
  ).toEqual({
    canPersist: true,
    canTry: true,
    canPublish: false,
    canDelete: true,
  })
})

test("editor hors démo : page publiée à lui, lecture seule", () => {
  expect(
    accesFicheDemo({
      role: "editor",
      isOwn: true,
      published: true,
      isDemo: false,
    }),
  ).toEqual({
    canPersist: false,
    canTry: false,
    canPublish: false,
    canDelete: true,
  })
})

test("owner hors démo : tout ouvert", () => {
  expect(
    accesFicheDemo({
      role: "owner",
      isOwn: false,
      published: true,
      isDemo: false,
    }),
  ).toEqual({
    canPersist: true,
    canTry: true,
    canPublish: true,
    canDelete: true,
  })
})
