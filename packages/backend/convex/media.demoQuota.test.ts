import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const DEMO_EMAIL = "demo@astrotan.invalid"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
})

afterEach(() => {
  process.env = originalEnv
})

function activerSandbox(email = DEMO_EMAIL) {
  process.env.DEMO_SANDBOX = "true"
  process.env.DEMO_ACCOUNT_EMAIL = email
}

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
  email?: string,
) {
  const resolved = email ?? `media-quota-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple media quota"
  const user = await seedUser(t, { email: resolved, password, name: `Actor ${role}`, role })
  await signIn(t, resolved, password)
  return { identity: await identityFor(t, user.id), id: user.id, email: resolved }
}

async function storeBlob(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ctx.storage.store(new Blob(["x"])))
}

async function registerFile(
  identity: Awaited<ReturnType<typeof identityFor>>,
  t: TestConvex<typeof schema>,
  size: number,
) {
  return identity.mutation(api.media.register, {
    storageId: await storeBlob(t),
    filename: "photo.png",
    mime: "image/png",
    size,
    alt: "Une photo",
  })
}

test("le 10ᵉ fichier de 100 Ko passe, le 11ᵉ est DEMO_QUOTA", async () => {
  const t = makeTestConvex()
  const demo = await seedActor(t, "editor", DEMO_EMAIL)
  activerSandbox(demo.email)
  const centKo = 100 * 1024

  for (let n = 0; n < 10; n++) {
    await expect(registerFile(demo.identity, t, centKo)).resolves.toBeDefined()
  }
  await expect(registerFile(demo.identity, t, centKo)).rejects.toMatchObject({
    data: { code: "DEMO_QUOTA" },
  })
})

test("le 3ᵉ fichier de 7 Mo dépasse 20 Mo et lève DEMO_QUOTA", async () => {
  const t = makeTestConvex()
  const demo = await seedActor(t, "editor", DEMO_EMAIL)
  activerSandbox(demo.email)
  const septMo = 7 * 1024 * 1024

  await expect(registerFile(demo.identity, t, septMo)).resolves.toBeDefined()
  await expect(registerFile(demo.identity, t, septMo)).resolves.toBeDefined()
  await expect(registerFile(demo.identity, t, septMo)).rejects.toMatchObject({
    data: { code: "DEMO_QUOTA" },
  })
})

test("un editor hors compte démo n'est pas plafonné", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  activerSandbox(DEMO_EMAIL)
  const centKo = 100 * 1024

  for (let n = 0; n < 11; n++) {
    await expect(registerFile(editor.identity, t, centKo)).resolves.toBeDefined()
  }
})
