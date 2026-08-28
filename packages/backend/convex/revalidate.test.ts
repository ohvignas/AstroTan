import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

// Task 3 brief, Step 1: "un échec HTTP incrémente attempts et repousse
// nextAttemptAt ; six échecs marquent failed ; le cron reprend une ligne
// dont l'action planifiée a été perdue." This file drives `drain` and its
// two internal mutations directly — `pages.publishPage.test.ts` covers
// the other half of the loop (the atomic outbox insert).
//
// `drain` is an `internalAction`: it does real network I/O (`fetch`),
// which only actions can do, so its own DB reads/writes go through
// `ctx.runQuery`/`ctx.runMutation` rather than `ctx.db` directly. Global
// `fetch` is stubbed per-test with `vi.stubGlobal` — there is no real
// `apps/web` to talk to in this suite.

const modules = import.meta.glob("./**/*.ts")

const WEB_SITE_URL = "http://web.test"
const REVALIDATE_SECRET = "test-revalidate-secret-please-do-not-use-in-prod-x"

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.WEB_SITE_URL = WEB_SITE_URL
  process.env.REVALIDATE_SECRET = REVALIDATE_SECRET
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

async function insertPendingRow(
  t: TestConvex<typeof schema>,
  overrides: { tags?: string[]; attempts?: number; nextAttemptAt?: number } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: overrides.tags ?? ["pages", "page:test"],
      status: "pending",
      attempts: overrides.attempts ?? 0,
      nextAttemptAt: overrides.nextAttemptAt ?? Date.now(),
      createdAt: Date.now(),
    }),
  )
}

async function getRow(t: TestConvex<typeof schema>, id: Awaited<ReturnType<typeof insertPendingRow>>) {
  return t.run((ctx) => ctx.db.get(id))
}

// ---------------------------------------------------------------------
// The happy path: drain claims a due row, POSTs, and marks it done.
// ---------------------------------------------------------------------

test("drain POSTe sur WEB_SITE_URL/api/revalidate avec le secret et marque la ligne 'done' en cas de succès", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t, { tags: ["pages", "page:accueil"] })

  fetchMock.mockResolvedValue({ ok: true, status: 200 })

  await t.action(internal.revalidate.drain, {})

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(`${WEB_SITE_URL}/api/revalidate`)
  expect(init.method).toBe("POST")
  expect((init.headers as Record<string, string>)["x-revalidate-secret"]).toBe(REVALIDATE_SECRET)
  expect(JSON.parse(init.body as string)).toEqual({ tags: ["pages", "page:accueil"] })

  const row = await getRow(t, id)
  expect(row?.status).toBe("done")
})

test("drain ne réclame pas une ligne déjà 'done' ou 'failed', ni une ligne pas encore due", async () => {
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages"],
      status: "done",
      attempts: 1,
      nextAttemptAt: Date.now() - 1000,
      createdAt: Date.now(),
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages"],
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now() - 1000,
      createdAt: Date.now(),
    }),
  )
  await insertPendingRow(t, { nextAttemptAt: Date.now() + 60_000 }) // not due yet

  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  await t.action(internal.revalidate.drain, {})

  expect(fetchMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------
// Failure -> backoff -> terminal 'failed' after 6 attempts.
// ---------------------------------------------------------------------

test("un échec HTTP incrémente attempts et repousse nextAttemptAt (backoff 1s après le premier échec)", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t)
  const before = Date.now()

  fetchMock.mockResolvedValue({ ok: false, status: 500 })
  await t.action(internal.revalidate.drain, {})

  const row = await getRow(t, id)
  expect(row?.status).toBe("pending")
  expect(row?.attempts).toBe(1)
  expect(row?.lastError).toMatch(/500/)
  // 1s backoff after the first failure (design spec §6.2: 1s, 5s, 25s,
  // 2min, 10min) — bounded on both sides rather than pinned to an exact
  // millisecond, since `Date.now()` advances between `before` and the
  // mutation that writes `nextAttemptAt`.
  expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(before + 1_000)
  expect(row?.nextAttemptAt).toBeLessThan(before + 5_000)
})

// Backoff schedule pinned exactly, attempt by attempt, by calling the
// internal mutation directly rather than `drain` — this is what proves
// "1 s, 5 s, 25 s, 2 min, 10 min" is the *actual* schedule, not just "some
// increasing delay". Going through `drain` for all six steps would
// require moving fake-timer time forward past each backoff window before
// the row becomes due again, which tests the due-row filter, not the
// schedule itself; `revalidate.drain`'s own due-row filtering is already
// covered by the test above.
test("le backoff suit exactement 1s / 5s / 25s / 2min / 10min, et la 6e tentative marque 'failed'", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t)
  const expectedDelaysMs = [1_000, 5_000, 25_000, 2 * 60_000, 10 * 60_000]

  for (let i = 0; i < expectedDelaysMs.length; i++) {
    const before = Date.now()
    await t.mutation(internal.revalidate.markAttemptFailed, {
      id,
      error: `attempt ${i + 1} failed`,
    })
    const row = await getRow(t, id)
    expect(row?.status, `attempt ${i + 1}`).toBe("pending")
    expect(row?.attempts, `attempt ${i + 1}`).toBe(i + 1)
    const delay = expectedDelaysMs[i] as number
    expect(row?.nextAttemptAt, `attempt ${i + 1}`).toBeGreaterThanOrEqual(before + delay)
    expect(row?.nextAttemptAt, `attempt ${i + 1}`).toBeLessThan(before + delay + 5_000)
  }

  // The 6th failure: terminal, no further backoff.
  await t.mutation(internal.revalidate.markAttemptFailed, { id, error: "attempt 6 failed" })
  const row = await getRow(t, id)
  expect(row?.status).toBe("failed")
  expect(row?.attempts).toBe(6)
  expect(row?.lastError).toBe("attempt 6 failed")
})

test("une ligne déjà 'failed' n'est pas ressuscitée par un nouvel appel de markAttemptFailed", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages"],
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now() - 1,
      createdAt: Date.now(),
      lastError: "already dead",
    }),
  )
  await t.mutation(internal.revalidate.markAttemptFailed, { id, error: "should be ignored" })
  const row = await getRow(t, id)
  expect(row?.status).toBe("failed")
  expect(row?.attempts).toBe(6)
  expect(row?.lastError).toBe("already dead")
})

test("markDone est un no-op sur une ligne déjà terminale", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages"],
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now() - 1,
      createdAt: Date.now(),
      lastError: "already dead",
    }),
  )
  await t.mutation(internal.revalidate.markDone, { id })
  const row = await getRow(t, id)
  expect(row?.status).toBe("failed") // not resurrected to "done"
})

// A thrown fetch (network error, not an HTTP error status) must be
// treated the same as a non-ok response: attempts incremented, never left
// silently 'pending' forever with no error and no next attempt.
test("une erreur réseau (fetch qui lève) est aussi traitée comme un échec", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t)
  fetchMock.mockRejectedValue(new TypeError("network unreachable"))

  await t.action(internal.revalidate.drain, {})

  const row = await getRow(t, id)
  expect(row?.status).toBe("pending")
  expect(row?.attempts).toBe(1)
  expect(row?.lastError).toMatch(/network unreachable/)
})

// ---------------------------------------------------------------------
// The cron's own reason to exist: a row whose scheduled `drain` never ran
// at all (lost, or simply never scheduled) is still picked up the next
// time anything calls `drain` — because claiming is by due-row query, not
// by which job scheduled it. This row is inserted directly via `t.run`,
// exactly like the cron would find one that fell through: nothing in this
// test ever calls `ctx.scheduler`.
// ---------------------------------------------------------------------

// Low (whole-lot review): `drain` had no claim step — two concurrent
// invocations (the fast-path `runAfter(0, ...)` racing the 60s cron, or
// two overlapping cron ticks under a slow HTTP call) could both
// `listDueRows` the same still-`pending` row before either recorded an
// outcome, then both call `markAttemptFailed` for the same underlying
// delivery attempt — double-incrementing `attempts` for a single real
// failure, so the documented "six attempts" budget silently became three
// under contention. `claimRow` (an atomic single-document patch) is what
// makes only one of two racing calls actually process the row.
test("deux drain concurrents sur la même ligne due n'incrémentent attempts qu'une seule fois", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t)
  fetchMock.mockRejectedValue(new Error("boom"))

  await Promise.all([t.action(internal.revalidate.drain, {}), t.action(internal.revalidate.drain, {})])

  const row = await getRow(t, id)
  expect(row?.status).toBe("pending")
  expect(row?.attempts).toBe(1)
})

test("le cron (un appel direct à drain) reprend une ligne dont l'action planifiée a été perdue", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t, { nextAttemptAt: Date.now() - 60_000 })
  fetchMock.mockResolvedValue({ ok: true, status: 200 })

  await t.action(internal.revalidate.drain, {})

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const row = await getRow(t, id)
  expect(row?.status).toBe("done")
})

// ---------------------------------------------------------------------
// Misconfiguration must throw, not degrade (CLAUDE.md; this task's own
// brief). Mirrors `lib/previewToken.ts`'s `PREVIEW_SECRET` guard and
// `invitations.ts`'s `sendInvitationEmail` SITE_URL guard — same
// reasoning: an unset variable here must fail loudly (a failed scheduled
// action in the dashboard) rather than silently mark every row
// "attempted" without ever telling anyone why nothing actually happened.
// ---------------------------------------------------------------------

test("drain lève si WEB_SITE_URL n'est pas configuré sur ce déploiement, sans toucher les lignes de l'outbox", async () => {
  const t = convexTest(schema, modules)
  const id = await insertPendingRow(t)
  delete process.env.WEB_SITE_URL

  await expect(t.action(internal.revalidate.drain, {})).rejects.toThrow(/WEB_SITE_URL/)
  expect(fetchMock).not.toHaveBeenCalled()
  const row = await getRow(t, id)
  expect(row?.status).toBe("pending")
  expect(row?.attempts).toBe(0)
})

test("drain lève si REVALIDATE_SECRET n'est pas configuré sur ce déploiement", async () => {
  const t = convexTest(schema, modules)
  await insertPendingRow(t)
  delete process.env.REVALIDATE_SECRET

  await expect(t.action(internal.revalidate.drain, {})).rejects.toThrow(/REVALIDATE_SECRET/)
  expect(fetchMock).not.toHaveBeenCalled()
})

test("drain lève si REVALIDATE_SECRET est trop court", async () => {
  const t = convexTest(schema, modules)
  await insertPendingRow(t)
  process.env.REVALIDATE_SECRET = "too-short"

  await expect(t.action(internal.revalidate.drain, {})).rejects.toThrow(/REVALIDATE_SECRET/)
  expect(fetchMock).not.toHaveBeenCalled()
})
