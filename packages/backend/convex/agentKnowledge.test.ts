import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type schema from "./schema"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `know-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple knowledge"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

test("attacher un .md extrait le markdown", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["# FAQ\n\nRéponse."], { type: "text/markdown" })),
  )

  const id = await owner.mutation(api.agentKnowledge.attach, {
    storageId,
    filename: "faq.md",
    mimeType: "text/markdown",
    size: 20,
  })
  vi.useFakeTimers()
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  } finally {
    vi.useRealTimers()
  }

  const listed = await owner.query(api.agentKnowledge.list, {})
  const row = listed.find((item) => item._id === id)
  expect(row?.extractedMarkdown).toBe("# FAQ\n\nRéponse.")
  expect(row?.filename).toBe("faq.md")
})

test("une extraction ratée écrit extractError, et Réessayer l'efface", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["# FAQ"])))
  const id = await owner.mutation(api.agentKnowledge.attach, {
    storageId,
    filename: "faq.md",
    mimeType: "text/markdown",
    size: 5,
  })
  await t.mutation(internal.agentKnowledge.patchExtractFailed, {
    id,
    error: "Impossible d'extraire le texte de ce fichier.",
  })

  const failed = (await owner.query(api.agentKnowledge.list, {})).find((item) => item._id === id)
  expect(failed?.extractError).toBe("Impossible d'extraire le texte de ce fichier.")

  await owner.mutation(api.agentKnowledge.retryExtract, { id })
  const retried = (await owner.query(api.agentKnowledge.list, {})).find((item) => item._id === id)
  expect(retried?.extractError).toBeUndefined()
})

test("reindexFile relance l'extraction de ce fichier et pose l'index en attente", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["# FAQ"])))
  const id = await owner.mutation(api.agentKnowledge.attach, {
    storageId,
    filename: "faq.md",
    mimeType: "text/markdown",
    size: 5,
  })
  await t.mutation(internal.agentKnowledge.patchExtractFailed, {
    id,
    error: "Impossible d'extraire le texte de ce fichier.",
  })

  await owner.mutation(api.agentKnowledge.reindexFile, { id })
  const retried = (await owner.query(api.agentKnowledge.list, {})).find((item) => item._id === id)
  expect(retried?.extractError).toBeUndefined()
  expect(retried?.indexStatus).toBe("pending")
  expect(retried).toHaveProperty("extractedMarkdown")
})

test("patchOcrProgress pose la progression sans indexer, Réessayer remet à zéro", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["# FAQ"])))
  const id = await owner.mutation(api.agentKnowledge.attach, {
    storageId,
    filename: "bootcamp.pdf",
    mimeType: "application/pdf",
    size: 5,
  })

  await t.mutation(internal.agentKnowledge.patchOcrProgress, {
    id,
    markdown: "# Module 1",
    ocrPage: 10,
    ocrTotal: 100,
  })
  const mid = (await owner.query(api.agentKnowledge.list, {})).find((item) => item._id === id)
  expect(mid?.ocrPage).toBe(10)
  expect(mid?.ocrTotal).toBe(100)
  expect(mid?.extractedMarkdown).toBe("# Module 1")
  expect(mid?.indexStatus).toBeUndefined()
  expect(mid?.extractError).toBeUndefined()

  await owner.mutation(api.agentKnowledge.retryExtract, { id })
  const retried = (await owner.query(api.agentKnowledge.list, {})).find((item) => item._id === id)
  expect(retried?.ocrPage).toBeUndefined()
  expect(retried?.ocrTotal).toBeUndefined()
  expect(retried?.extractedMarkdown).toBe("")
  expect(retried?.extractError).toBeUndefined()
})

test("un editor ne réindexe pas un fichier", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editor = await seedActor(t, "editor")
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["# FAQ"])))
  const id = await owner.mutation(api.agentKnowledge.attach, {
    storageId,
    filename: "faq.md",
    mimeType: "text/markdown",
    size: 5,
  })
  await expect(editor.mutation(api.agentKnowledge.reindexFile, { id })).rejects.toThrow()
})

test("un editor n'attache pas un fichier de savoir", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])))
  await expect(
    editor.mutation(api.agentKnowledge.attach, {
      storageId,
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 1,
    }),
  ).rejects.toThrow()
})
