import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

test("le schéma accepte un profil et lui refuse un champ role", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) =>
    ctx.db.insert("profiles", { authUserId: "user_1", displayName: "Flo" }),
  )
  const doc = await t.run(async (ctx) => ctx.db.get(id))
  expect(doc?.authUserId).toBe("user_1")
  expect(doc).not.toHaveProperty("role")
})
