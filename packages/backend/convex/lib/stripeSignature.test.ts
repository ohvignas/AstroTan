import { describe, expect, test } from "vitest"
import { parseStripeSignature, verifyStripeSignature } from "./stripeSignature"

const SECRET = "whsec_test_signature_secret"

async function sign(timestamp: number, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  )
  const hex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `t=${timestamp},v1=${hex}`
}

describe("Stripe-Signature", () => {
  test("refuse un en-tête malformé", () => {
    expect(parseStripeSignature("")).toBeNull()
    expect(parseStripeSignature("v1=abcd")).toBeNull()
    expect(parseStripeSignature("t=1")).toBeNull()
  })

  test("accepte une signature fraîche", async () => {
    const payload = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const header = await sign(timestamp, payload)
    await expect(
      verifyStripeSignature({ secret: SECRET, payload, header }),
    ).resolves.toBe(true)
  })

  test("refuse une signature fausse", async () => {
    const payload = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)
    await expect(
      verifyStripeSignature({
        secret: SECRET,
        payload,
        header: `t=${timestamp},v1=${"ab".repeat(32)}`,
      }),
    ).resolves.toBe(false)
  })

  test("refuse un horodatage trop vieux", async () => {
    const payload = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000) - 600
    const header = await sign(timestamp, payload)
    await expect(
      verifyStripeSignature({ secret: SECRET, payload, header }),
    ).resolves.toBe(false)
  })
})
