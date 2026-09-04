import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const DEMO_EMAIL = "demo@astrotan.invalid"
const DEMO_PASSWORD = "correct horse battery staple demo"
const AUTRE_EMAIL = "autre@exemple.fr"
const AUTRE_PASSWORD = "correct horse battery staple autre"
const OWNER_EMAIL = "owner@exemple.fr"
const OWNER_PASSWORD = "correct horse battery staple owner"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
  delete process.env.DEMO_ACCOUNT_PASSWORD
  delete process.env.DEMO_OPENROUTER_MODEL
})

afterEach(() => {
  process.env = originalEnv
})

function activerSandbox() {
  process.env.DEMO_SANDBOX = "true"
  process.env.DEMO_ACCOUNT_EMAIL = DEMO_EMAIL
}

async function seedDemoEditor(t: ReturnType<typeof makeTestConvex>) {
  const user = await seedUser(t, {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    name: "Démo",
    role: "editor",
  })
  await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  return { user, identity: await identityFor(t, user.id) }
}

async function seedOwner(t: ReturnType<typeof makeTestConvex>) {
  const user = await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  await signIn(t, OWNER_EMAIL, OWNER_PASSWORD)
  return { user, identity: await identityFor(t, user.id) }
}

test("l'editor démo ne publie pas une page (rôle) et generatePostCover lève DEMO_FORBIDDEN", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const demo = await seedDemoEditor(t)

  const pageId = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "interdit",
      title: "Interdit",
      status: "draft",
      createdBy: demo.user.id,
      updatedBy: demo.user.id,
    }),
  )
  await expect(demo.identity.mutation(api.pages.publishPage, { id: pageId })).rejects.toMatchObject({
    data: { code: "FORBIDDEN" },
  })

  const postId = await t.run((ctx) =>
    ctx.db.insert("posts", {
      slug: "couverture-interdite",
      title: "Couverture",
      excerpt: "Chapô.",
      body: "<p>Corps.</p>",
      status: "draft",
      tagIds: [],
      createdBy: demo.user.id,
      updatedBy: demo.user.id,
    }),
  )
  await expect(
    demo.identity.action(api.aiImage.generatePostCover, { postId }),
  ).rejects.toMatchObject({ data: { code: "DEMO_FORBIDDEN" } })
})

test("l'editor démo ne peut pas inviter", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const demo = await seedDemoEditor(t)
  await expect(
    demo.identity.mutation(api.invitations.create, {
      email: "invite@exemple.fr",
      role: "editor",
    }),
  ).rejects.toMatchObject({
    data: { code: expect.stringMatching(/^(FORBIDDEN|DEMO_FORBIDDEN)$/) },
  })
})

test("owner + flag on : settings.update refuse un modèle OpenRouter", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const owner = await seedOwner(t)
  await expect(
    owner.identity.mutation(api.settings.update, { openRouterModel: "x-ai/grok-4.6" }),
  ).rejects.toMatchObject({ data: { code: "DEMO_MODEL_LOCKED" } })
})

test("owner + flag on : settings.update accepte un champ hors OpenRouter", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const owner = await seedOwner(t)
  await owner.identity.mutation(api.settings.update, { siteName: "Ok" })
  const settings = await owner.identity.query(api.settings.getPrivate, {})
  expect(settings?.siteName).toBe("Ok")
})

test("owner + flag off : settings.update accepte un modèle OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  await owner.identity.mutation(api.settings.update, { openRouterModel: "x-ai/grok-4.6" })
  const settings = await owner.identity.query(api.settings.getPrivate, {})
  expect(settings?.openRouterModel).toBe("x-ai/grok-4.6")
})

test("un autre editor n'est pas bloqué par estCompteDemo", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const user = await seedUser(t, {
    email: AUTRE_EMAIL,
    password: AUTRE_PASSWORD,
    name: "Autre",
    role: "editor",
  })
  await signIn(t, AUTRE_EMAIL, AUTRE_PASSWORD)
  const identity = await identityFor(t, user.id)
  const id = await identity.mutation(api.posts.create, {
    title: "Brouillon libre",
    slug: "brouillon-libre",
  })
  const post = await t.run((ctx) => ctx.db.get(id))
  expect(post?.status).toBe("draft")
  expect(post?.createdBy).toBe(user.id)
})

test("le compte démo ne peut pas changer de mot de passe", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await seedUser(t, {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    name: "Démo",
    role: "editor",
  })
  const cookie = await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  const res = await t.fetch("/api/auth/change-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie,
    },
    body: JSON.stringify({
      currentPassword: DEMO_PASSWORD,
      newPassword: "correct horse battery staple nouveau",
    }),
  })
  expect(res.status).toBe(403)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe("DEMO_FORBIDDEN")
})
