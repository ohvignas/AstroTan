import { beforeEach, describe, expect, test } from "vitest"
import { api } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

const SECRET = "a".repeat(64)

const RECORD = {
  consentVersion: "1.0.0",
  visitorId: "visiteur-1",
  consentId: "geste-1",
  action: "custom" as const,
  timestamp: "2026-08-29T10:00:00.000Z",
  analytics: true,
  marketing: false,
  preferences: false,
}

beforeEach(() => {
  process.env.CONSENT_LOG_SECRET = SECRET
})

describe("consent.record", () => {
  test("sans secret configuré, la porte est fermée — jamais ouverte", async () => {
    // L'oubli de configuration est le cas fréquent, et c'est celui où une
    // porte ouverte ne se voit pas.
    delete process.env.CONSENT_LOG_SECRET
    const t = makeTestConvex()
    await expect(t.mutation(api.consent.record, { ...RECORD, secret: "" })).rejects.toThrow()
  })

  test("un mauvais secret est refusé", async () => {
    const t = makeTestConvex()
    await expect(
      t.mutation(api.consent.record, { ...RECORD, secret: "b".repeat(64) }),
    ).rejects.toThrow()
  })

  test("le bon secret écrit une ligne", async () => {
    const t = makeTestConvex()
    await t.mutation(api.consent.record, { ...RECORD, secret: SECRET })
    const rows = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ visitorId: "visiteur-1", analytics: true, marketing: false })
    // Le secret ne doit pas se retrouver dans la ligne écrite.
    expect(rows[0]).not.toHaveProperty("secret")
  })

  test("rejouer le même geste n'écrit pas deux lignes", async () => {
    // La requête part en `keepalive` quand la personne quitte la page : le
    // navigateur peut la rejouer, et deux lignes pour un clic feraient
    // mentir le journal sur ce qui s'est passé.
    const t = makeTestConvex()
    await t.mutation(api.consent.record, { ...RECORD, secret: SECRET })
    await t.mutation(api.consent.record, { ...RECORD, secret: SECRET })
    const rows = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(rows).toHaveLength(1)
  })

  test("un retrait après un accord garde les deux lignes", async () => {
    // « A accepté puis retiré » est une information. Un journal qui n'en
    // garderait que le dernier état ne pourrait plus la produire — et c'est
    // exactement ce qu'on demande de démontrer.
    const t = makeTestConvex()
    await t.mutation(api.consent.record, { ...RECORD, secret: SECRET })
    await t.mutation(api.consent.record, {
      ...RECORD,
      secret: SECRET,
      consentId: "geste-2",
      action: "update",
      analytics: false,
    })
    const rows = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.analytics)).toEqual([true, false])
  })

  test("un champ démesuré est refusé", async () => {
    const t = makeTestConvex()
    await expect(
      t.mutation(api.consent.record, { ...RECORD, secret: SECRET, visitorId: "x".repeat(65) }),
    ).rejects.toThrow()
  })
})
