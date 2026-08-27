import { expect, test } from "vitest"
import { assertOwnerInvariant } from "./ownerGuard"

const base = { actorId: "u_owner", actorRole: "owner" as const, ownerCount: 1 }

test("refuse un second owner", () => {
  expect(() => assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: "editor", nextRole: "owner" }))
    .toThrow(/OWNER_ALREADY_EXISTS/)
})

test("refuse de rétrograder le dernier owner", () => {
  expect(() => assertOwnerInvariant({ ...base, targetId: "u_owner", targetRole: "owner", nextRole: "admin" }))
    .toThrow(/LAST_OWNER/)
})

test("refuse de supprimer le dernier owner", () => {
  expect(() => assertOwnerInvariant({ ...base, targetId: "u_owner", targetRole: "owner", nextRole: null }))
    .toThrow(/LAST_OWNER/)
})

test("refuse qu'un admin modifie un owner", () => {
  expect(() => assertOwnerInvariant({ ...base, actorId: "u_admin", actorRole: "admin", targetId: "u_owner", targetRole: "owner", nextRole: "editor" }))
    .toThrow(/FORBIDDEN/)
})

test("autorise un owner à promouvoir un editor en admin", () => {
  expect(() => assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: "editor", nextRole: "admin" }))
    .not.toThrow()
})
