import { expect, test } from "vitest"
import { assignableRoles, canEditTargetRole } from "./assignableRoles"

test("un owner peut assigner admin et editor", () => {
  expect(assignableRoles("owner")).toEqual({
    admin: "Administrateur",
    editor: "Éditeur",
  })
})

test("un admin ne peut assigner que editor", () => {
  expect(assignableRoles("admin")).toEqual({ editor: "Éditeur" })
})

test("un admin ne change pas le rôle d'un autre admin (Badge, pas Select)", () => {
  expect(canEditTargetRole("admin", "admin")).toBe(false)
  expect(canEditTargetRole("owner", "admin")).toBe(true)
  expect(canEditTargetRole("admin", "editor")).toBe(true)
  expect(canEditTargetRole("owner", "owner")).toBe(false)
})
