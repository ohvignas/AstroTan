import { afterEach, beforeEach, expect, test } from "vitest"
import { dataforseoEstConfigure } from "./dataforseoConfigured"
import { makeTestConvex } from "../../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
})

afterEach(() => {
  process.env = originalEnv
})

test("absent sans env ni ligne", async () => {
  const t = makeTestConvex()
  expect(await t.run((ctx) => dataforseoEstConfigure(ctx))).toBe(false)
})

test("configuré quand les deux variables d'environnement sont posées", async () => {
  const t = makeTestConvex()
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  expect(await t.run((ctx) => dataforseoEstConfigure(ctx))).toBe(true)
})
