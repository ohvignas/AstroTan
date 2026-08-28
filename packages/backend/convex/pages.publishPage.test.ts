import { convexTest, type TestConvex } from "convex-test"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// Task 3 brief, Step 1, verbatim: "publishPage insère la ligne d'outbox
// dans la même mutation ; un échec HTTP incrémente attempts et repousse
// nextAttemptAt ; six échecs marquent failed ; le cron reprend une ligne
// dont l'action planifiée a été perdue." This file covers the first half
// (publishPage itself — the write, the role gate, and the atomicity of
// the outbox insert). `revalidate.test.ts` covers the rest (drain,
// backoff, the cron catch-up path).
//
// The role gate (owner/admin only, never editor) is also exercised by
// `lib/authz.test.ts`'s registry matrix, once `pages.publishPage` is
// declared in `MUTATION_REGISTRY` below — that proves the FORBIDDEN case
// for every role in one place. This file adds the parts the matrix
// doesn't: what a *successful* publish actually writes, and that the
// outbox row exists the instant the mutation returns, before any
// scheduled function has had a chance to run.

const modules = import.meta.glob("./**/*.ts")

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(t: TestConvex<typeof schema>, role: "owner" | "admin" | "editor") {
  const email = `publish-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple 1"
  const user = await seedUser(t, { email, password, name: "Publisher", role })
  await signIn(t, email, password)
  return identityFor(t, user.id)
}

async function insertDraft(t: TestConvex<typeof schema>, slug = "brouillon") {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug,
      title: "Titre de brouillon",
      status: "draft",
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )
}

test("publishPage refuse un appel non authentifié", async () => {
  const t = convexTest(schema, modules)
  const id = await insertDraft(t)
  await expect(t.mutation(api.pages.publishPage, { id })).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
})

test("un editor ne peut pas publier — refusé côté serveur, pas seulement masqué en UI", async () => {
  const t = makeTestConvex()
  const asEditor = await seedActor(t, "editor")
  const id = await insertDraft(t)
  await expect(asEditor.mutation(api.pages.publishPage, { id })).rejects.toMatchObject({
    data: { code: "FORBIDDEN" },
  })
  // Removing the role gate would make this same call succeed — the
  // assertion above is what actually fails if `requireRole` is ever
  // dropped from `publishPage`, not just "some error was thrown".
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.status).toBe("draft")
})

test("publishPage refuse un id de page inexistant", async () => {
  const t = makeTestConvex()
  const asOwner = await seedActor(t, "owner")
  const id = await insertDraft(t)
  await t.run((ctx) => ctx.db.delete(id))
  await expect(asOwner.mutation(api.pages.publishPage, { id })).rejects.toMatchObject({
    data: { code: "NOT_FOUND" },
  })
})

test("publishPage écrit status published et publishedAt", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedActor(t, "admin")
  const id = await insertDraft(t, "publier-moi")
  const before = Date.now()
  await asAdmin.mutation(api.pages.publishPage, { id })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.status).toBe("published")
  expect(page?.publishedAt).toBeGreaterThanOrEqual(before)
})

// The atomicity claim itself: the outbox row must exist the instant
// `publishPage` returns — read here with a plain `t.run`, never having
// advanced the scheduler at all (no `finishAllScheduledFunctions`, no
// fake timers). If the row were inserted from inside a *scheduled*
// function instead of the mutation itself, this assertion would find
// nothing, because nothing has run the scheduler yet.
test("publishPage insère la ligne d'outbox dans la même mutation (visible avant toute exécution planifiée)", async () => {
  const t = makeTestConvex()
  const asOwner = await seedActor(t, "owner")
  const id = await insertDraft(t, "avec-outbox")
  const before = Date.now()
  await asOwner.mutation(api.pages.publishPage, { id })

  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(1)
  const row = rows[0]
  expect(row?.status).toBe("pending")
  expect(row?.attempts).toBe(0)
  expect(row?.tags).toEqual(["pages", "page:avec-outbox"])
  expect(row?.nextAttemptAt).toBeLessThanOrEqual(Date.now())
  expect(row?.createdAt).toBeGreaterThanOrEqual(before)
  expect(row?.lastError).toBeUndefined()
})

// The "fast path" from design spec §6.2 step 2: the mutation also
// schedules `internal.revalidate.drain` immediately, not only on the next
// cron tick. Checked the same way as the outbox row above — via
// `ctx.db.system`, before advancing the scheduler — so this is a genuine
// read of "what the mutation itself did", not "what eventually ran".
test("publishPage planifie internal.revalidate.drain immédiatement (chemin rapide)", async () => {
  const t = makeTestConvex()
  const asOwner = await seedActor(t, "owner")
  const id = await insertDraft(t, "chemin-rapide")
  await asOwner.mutation(api.pages.publishPage, { id })

  const expectedName = getFunctionName(internal.revalidate.drain)
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  const drainJobs = scheduled.filter((job) => job.name === expectedName)
  expect(drainJobs.length).toBeGreaterThanOrEqual(1)
  expect(drainJobs[0]?.state.kind).toBe("pending")
})

// Republishing an already-published page (e.g. after an edit) must still
// work — refusing a second `publishPage` call on an already-published
// page would leave no way to push new content live again short of
// `unpublish`ing first (Task 8's `pages.unpublish`, its own dedicated
// test file), which would needlessly serve a 404/stale response in
// between.
test("republier une page déjà publiée fonctionne et ré-enfile une invalidation", async () => {
  const t = makeTestConvex()
  const asOwner = await seedActor(t, "owner")
  const id = await insertDraft(t, "republication")
  await asOwner.mutation(api.pages.publishPage, { id })
  await asOwner.mutation(api.pages.publishPage, { id })

  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.status).toBe("published")
  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(2)
})
