import { afterEach, beforeEach, expect, test } from "vitest"
import { api, internal } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"

const CLE_MAITRESSE = btoa(
  String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 13) % 251)),
)

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env[SECRETS_KEY_VAR] = CLE_MAITRESSE
})

afterEach(() => {
  process.env = originalEnv
})

async function seedOwner() {
  const t = makeTestConvex()
  const email = `cal-owner-${Date.now()}@example.com`
  const password = "correct horse battery staple calendar"
  const user = await seedUser(t, { email, password, name: "Owner cal", role: "owner" })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("sans client id, googleAuthUrl refuse", async () => {
  const { identity } = await seedOwner()
  await expect(identity.query(api.connectors.googleAuthUrl, {})).rejects.toMatchObject({
    data: { code: "CALENDAR_DISCONNECTED" },
  })
})

test("googleAuthUrl rend l'URL OAuth Google", async () => {
  const { identity } = await seedOwner()
  await identity.mutation(api.connectors.updateGoogle, {
    googleCalendarClientId: "abc.apps.googleusercontent.com",
  })
  const { url } = await identity.query(api.connectors.googleAuthUrl, {})
  expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth")
  expect(url).toContain("access_type=offline")
  expect(url).toContain("calendar.freebusy")
  expect(decodeURIComponent(url)).toContain("/api/connectors/google/callback")
})

test("un editor ne pose pas le calendrier", async () => {
  const t = makeTestConvex()
  const email = `cal-editor-${Date.now()}@example.com`
  const password = "correct horse battery staple calendar"
  const user = await seedUser(t, { email, password, name: "Editor cal", role: "editor" })
  await signIn(t, email, password)
  const editor = await identityFor(t, user.id)
  await expect(
    editor.mutation(api.connectors.updateGoogle, { googleCalendarClientId: "x" }),
  ).rejects.toThrow()
})

test("storeGoogleRefresh chiffre et status ne rend pas le jeton", async () => {
  const { identity } = await seedOwner()
  await identity.action(api.connectors.storeGoogleRefresh, {
    refreshToken: "refresh-qui-ne-doit-pas-sortir",
  })
  const etat = await identity.query(api.secrets.status, {})
  const ligne = etat.secrets.find((s) => s.nom === "GOOGLE_CALENDAR_REFRESH_TOKEN")
  expect(ligne?.source).toBe("base")
  expect(JSON.stringify(etat)).not.toContain("refresh-qui-ne-doit-pas-sortir")
})

test("googleStatus est déconnecté sans refresh", async () => {
  const { identity } = await seedOwner()
  const status = await identity.query(api.connectors.googleStatus, {})
  expect(status).toEqual({
    connected: false,
    ready: false,
    email: null,
    refreshSource: "aucune",
    calendarId: "primary",
  })
})

test("un editor ne déconnecte pas", async () => {
  const t = makeTestConvex()
  const email = `cal-ed-${Date.now()}@example.com`
  const password = "correct horse battery staple calendar"
  const user = await seedUser(t, { email, password, name: "Editor cal", role: "editor" })
  await signIn(t, email, password)
  const editor = await identityFor(t, user.id)
  await expect(editor.mutation(api.connectors.disconnectGoogle, {})).rejects.toThrow()
})

test("disconnectGoogle retire le refresh en base et l'e-mail", async () => {
  const { t, identity } = await seedOwner()
  await identity.action(api.connectors.storeGoogleRefresh, {
    refreshToken: "refresh-a-effacer",
  })
  await t.mutation(internal.connectors.rangerEmail, {
    email: "marie@cabinet.fr",
  })
  await identity.mutation(api.connectors.disconnectGoogle, {})
  const status = await identity.query(api.connectors.googleStatus, {})
  expect(status.connected).toBe(false)
  expect(status.email).toBeNull()
  const etat = await identity.query(api.secrets.status, {})
  const ligne = etat.secrets.find((s) => s.nom === "GOOGLE_CALENDAR_REFRESH_TOKEN")
  expect(ligne?.source).toBe("aucune")
})
