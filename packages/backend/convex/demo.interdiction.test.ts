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

const REFUS = {
  data: { code: expect.stringMatching(/^(FORBIDDEN|DEMO_FORBIDDEN)$/) },
}

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

async function seedActeur(
  t: ReturnType<typeof makeTestConvex>,
  email: string,
  password: string,
  role: "owner" | "editor",
) {
  const user = await seedUser(t, { email, password, name: role, role })
  await signIn(t, email, password)
  return { user, identity: await identityFor(t, user.id) }
}

function insertDraft(
  t: ReturnType<typeof makeTestConvex>,
  table: "pages" | "posts",
  createdBy: string,
  slug: string,
) {
  return t.run((ctx) =>
    table === "pages"
      ? ctx.db.insert("pages", {
          slug,
          title: "Interdit",
          status: "draft",
          createdBy,
          updatedBy: createdBy,
        })
      : ctx.db.insert("posts", {
          slug,
          title: "Interdit",
          excerpt: "Chapô.",
          body: "<p>Corps.</p>",
          status: "draft",
          tagIds: [],
          createdBy,
          updatedBy: createdBy,
        }),
  )
}

test("l'editor démo est refusé sur les sorties owner/admin", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const demo = await seedActeur(t, DEMO_EMAIL, DEMO_PASSWORD, "editor")
  const pageId = await insertDraft(t, "pages", demo.user.id, "page-interdit")
  const postId = await insertDraft(t, "posts", demo.user.id, "post-interdit")

  await expect(demo.identity.mutation(api.pages.publishPage, { id: pageId })).rejects.toMatchObject(
    REFUS,
  )
  await expect(demo.identity.mutation(api.posts.publishPost, { id: postId })).rejects.toMatchObject(
    REFUS,
  )
  await expect(
    demo.identity.mutation(api.invitations.create, { email: "invite@exemple.fr", role: "editor" }),
  ).rejects.toMatchObject(REFUS)
  await expect(
    demo.identity.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: "sk-or-demo" }),
  ).rejects.toMatchObject(REFUS)
  await expect(
    demo.identity.action(api.emails.envoyerExemple, { cle: "leadNotification" }),
  ).rejects.toMatchObject(REFUS)
  await expect(
    demo.identity.action(api.dataforseo.enregistrer, { login: "demo", password: "demo" }),
  ).rejects.toMatchObject(REFUS)
})

test("l'editor démo est refusé sur les sorties IA encore ouvertes à l'editor", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const demo = await seedActeur(t, DEMO_EMAIL, DEMO_PASSWORD, "editor")
  const postId = await insertDraft(t, "posts", demo.user.id, "couverture-interdite")
  const pageId = await insertDraft(t, "pages", demo.user.id, "og-interdit")

  await expect(
    demo.identity.action(api.aiImage.generatePostCover, { postId }),
  ).rejects.toMatchObject({ data: { code: "DEMO_FORBIDDEN" } })
  await expect(
    demo.identity.action(api.aiImage.generatePageOg, { pageId }),
  ).rejects.toMatchObject({ data: { code: "DEMO_FORBIDDEN" } })
})

test("owner + flag on : settings.update refuse les modèles OpenRouter", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const owner = await seedActeur(t, OWNER_EMAIL, OWNER_PASSWORD, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, { openRouterModel: "x-ai/grok-4.6" }),
  ).rejects.toMatchObject({ data: { code: "DEMO_MODEL_LOCKED" } })
  await expect(
    owner.identity.mutation(api.settings.update, { openRouterAgentModel: "x-ai/grok-4.6" }),
  ).rejects.toMatchObject({ data: { code: "DEMO_MODEL_LOCKED" } })
})

test("owner + flag on : settings.update accepte un champ hors OpenRouter", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const owner = await seedActeur(t, OWNER_EMAIL, OWNER_PASSWORD, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Ok" })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.siteName).toBe("Ok")
})

test("owner + flag off : settings.update accepte un modèle OpenRouter", async () => {
  const t = makeTestConvex()
  const owner = await seedActeur(t, OWNER_EMAIL, OWNER_PASSWORD, "owner")
  await owner.identity.mutation(api.settings.update, { openRouterModel: "x-ai/grok-4.6" })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.openRouterModel).toBe(
    "x-ai/grok-4.6",
  )
})

test("un autre editor n'est pas bloqué par estCompteDemo", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const autre = await seedActeur(t, AUTRE_EMAIL, AUTRE_PASSWORD, "editor")
  const id = await autre.identity.mutation(api.posts.create, {
    title: "Brouillon libre",
    slug: "brouillon-libre",
  })
  const post = await t.run((ctx) => ctx.db.get(id))
  expect(post?.status).toBe("draft")
  expect(post?.createdBy).toBe(autre.user.id)
})

test("le compte démo ne peut pas changer de mot de passe", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await seedActeur(t, DEMO_EMAIL, DEMO_PASSWORD, "editor")
  const cookie = await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  const res = await t.fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify({
      currentPassword: DEMO_PASSWORD,
      newPassword: "correct horse battery staple nouveau",
    }),
  })
  expect(res.status).toBe(403)
  expect(((await res.json()) as { code?: string }).code).toBe("DEMO_FORBIDDEN")
})
