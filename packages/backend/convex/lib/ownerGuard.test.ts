import { expect, test } from "vitest"
import { assertOwnerInvariant } from "./ownerGuard"

const base = {
  operation: "update" as const,
  actorId: "u_owner",
  actorRole: "owner",
  ownerCount: 1,
}

// --- Brief's original five scenarios, adapted to the `operation` shape ---

test("refuse un second owner", () => {
  expect(() =>
    assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: "editor", nextRole: "owner" }),
  ).toThrow(/OWNER_ALREADY_EXISTS/)
})

test("refuse de rétrograder le dernier owner", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "admin",
    }),
  ).toThrow(/LAST_OWNER/)
})

test("refuse de supprimer le dernier owner", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      operation: "delete",
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: undefined, // ignored for delete — see ownerGuard.ts
    }),
  ).toThrow(/LAST_OWNER/)
})

test("refuse qu'un admin modifie un owner (id différent)", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      actorId: "u_admin",
      actorRole: "admin",
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "editor",
    }),
  ).toThrow(/FORBIDDEN/)
})

test("autorise un owner à promouvoir un editor en admin", () => {
  expect(() =>
    assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: "editor", nextRole: "admin" }),
  ).not.toThrow()
})

// --- I4: actorRole is read, not a dead field ---

test("refuse un actorId usurpé (id == target mais rôle de session != owner)", () => {
  // Simulates an id-derivation bug: `actorId` happens to equal `targetId`
  // but the session's own role says otherwise. If `actorRole` were dead,
  // this would incorrectly pass Check 1 the same way
  // "refuse qu'un admin modifie un owner" would if only tested via a
  // mismatched id.
  expect(() =>
    assertOwnerInvariant({
      operation: "update",
      actorId: "u_owner",
      actorRole: "admin",
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "editor",
      ownerCount: 1,
    }),
  ).toThrow(/FORBIDDEN/)
})

// --- I3: additional coverage ---

test("autorise un owner à s'auto-éditer sans changer son propre rôle", () => {
  // The path every legitimate owner self-update takes: name/email/etc
  // edited, role resubmitted unchanged. Must never throw — a single wrong
  // character in the LAST_OWNER check would lock the owner out of their
  // own profile.
  expect(() =>
    assertOwnerInvariant({
      operation: "update",
      actorId: "u_owner",
      actorRole: "owner",
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "owner",
      ownerCount: 1,
    }),
  ).not.toThrow()
})

test("ownerCount: 0 — traite une cible owner comme le dernier owner (conservateur)", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "admin",
      ownerCount: 0,
    }),
  ).toThrow(/LAST_OWNER/)
})

test("ownerCount: 2 — autorise de rétrograder un owner s'il en reste un autre", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "admin",
      ownerCount: 2,
    }),
  ).not.toThrow()
})

test("rôle cible manquant (undefined) : échoue fermé", () => {
  expect(() =>
    assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: undefined, nextRole: "editor" }),
  ).toThrow(/UNCLASSIFIABLE_TARGET_ROLE/)
})

test("rôle cible inconnu (\"superadmin\") : échoue fermé", () => {
  expect(() =>
    assertOwnerInvariant({
      ...base,
      targetId: "u_2",
      targetRole: "superadmin",
      nextRole: "editor",
    }),
  ).toThrow(/UNCLASSIFIABLE_TARGET_ROLE/)
})

test("rôle demandé manquant sur une mise à jour qui prétend changer le rôle : échoue fermé", () => {
  expect(() =>
    assertOwnerInvariant({ ...base, targetId: "u_2", targetRole: "editor", nextRole: undefined }),
  ).toThrow(/INVALID_ROLE/)
})

test("rôle demandé multiple (\"owner,editor\") : échoue fermé, ne se laisse pas dégrader en \"pas de changement\"", () => {
  // The exact exploit shape: better-auth's own `hasPermission` grants
  // access if *any* joined role component matches, so `"owner,editor"`
  // would let the caller act with owner permissions (including
  // `set-password`) while `parseRole` alone returns `null` for it. This
  // must be refused, not silently treated as "role unchanged".
  expect(() =>
    assertOwnerInvariant({
      ...base,
      targetId: "u_2",
      targetRole: "editor",
      nextRole: "owner,editor",
    }),
  ).toThrow(/INVALID_ROLE/)
})

test("actorRole manquant (pas de session) contre une cible owner : échoue fermé", () => {
  expect(() =>
    assertOwnerInvariant({
      operation: "update",
      actorId: "",
      actorRole: undefined,
      targetId: "u_owner",
      targetRole: "owner",
      nextRole: "editor",
      ownerCount: 1,
    }),
  ).toThrow(/FORBIDDEN/)
})

test("supprimer un non-owner : autorisé", () => {
  expect(() =>
    assertOwnerInvariant({
      operation: "delete",
      actorId: "u_admin",
      actorRole: "admin",
      targetId: "u_2",
      targetRole: "editor",
      nextRole: undefined,
      ownerCount: 1,
    }),
  ).not.toThrow()
})
