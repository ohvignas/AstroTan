import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

const action = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ action }),
}))

let GET: typeof import("../checkout").GET
let POST: typeof import("../checkout").POST

beforeEach(async () => {
  vi.resetModules()
  action.mockReset()
  const mod = await import("../checkout")
  GET = mod.GET
  POST = mod.POST
})

afterEach(() => {
  vi.restoreAllMocks()
})

test("un checkout réussi redirige vers l'URL Stripe", async () => {
  action.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_ok" })
  const response = await POST({ request: new Request("http://localhost/api/checkout", { method: "POST" }) } as APIContext)
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_ok")
  expect(action).toHaveBeenCalledTimes(1)
})

test("GET ouvre la même session — Traefik fait échouer le POST de formulaire", async () => {
  action.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_ok" })
  const response = await GET({ request: new Request("http://localhost/acheter", { method: "GET" }) } as APIContext)
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_ok")
})

test("une panne Convex ramène aux tarifs sans exposer l'erreur", async () => {
  action.mockRejectedValue(new Error("STRIPE_NOT_CONFIGURED"))
  const response = await POST({ request: new Request("http://localhost/api/checkout", { method: "POST" }) } as APIContext)
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe("/tarifs?erreur=indisponible")
})
