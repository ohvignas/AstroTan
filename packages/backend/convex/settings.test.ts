import type { TestConvex } from "convex-test"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { MAX_SITE_NAME_LENGTH } from "./settings"
import { MAX_AGENT_KNOWLEDGE, MAX_AGENT_TEASER } from "./content"
import { DEFAULT_AGENT_INSTRUCTIONS } from "./lib/defaultAgentInstructions"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor"
) {
  const email = `settings-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple settings"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

test("get rend null sur un site jamais configuré, sans exiger de session", async () => {
  const t = makeTestConvex()
  // Appelé sans identité : `apps/web` n'a ni session ni clé admin et a
  // besoin du nom et du logo sur chaque page.
  expect(await t.query(api.settings.get, {})).toBeNull()
  expect(await t.query(api.settings.homePageSlug, {})).toBeNull()
})

test("update crée la ligne au premier enregistrement, puis la modifie", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  expect((await t.query(api.settings.get, {}))?.siteName).toBe("Exemple")

  await owner.identity.mutation(api.settings.update, { siteName: "Exemple École" })
  const rows = await t.run((ctx) => ctx.db.query("settings").collect())
  // Singleton : modifier, jamais empiler une seconde ligne.
  expect(rows).toHaveLength(1)
  expect(rows[0]?.siteName).toBe("Exemple École")
})

// Relecture finale, correctif 1 : `emailFrom` n'est plus dans `get`, la
// projection publique non authentifiée — voir `settings.publicProjection
// .test.ts`. Ce n'est pas un secret pour autant (elle apparaît dans
// l'en-tête de chaque email envoyé), donc `getPrivate` — réservée à une
// session owner/admin/editor — continue de la rendre.
test("update accepte emailFrom ; getPrivate l'expose, get ne l'expose plus", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, {
    siteName: "Exemple",
    emailFrom: "AstroTan <bonjour@exemple.fr>",
  })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.emailFrom).toBe(
    "AstroTan <bonjour@exemple.fr>"
  )
  expect(await t.query(api.settings.get, {})).not.toHaveProperty("emailFrom")
})

test("update refuse un nom vide ou trop long, et n'est pas ouvert aux editors", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await expect(
    owner.identity.mutation(api.settings.update, { siteName: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SITE_NAME" } })
  await expect(
    owner.identity.mutation(api.settings.update, {
      siteName: "x".repeat(MAX_SITE_NAME_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "siteName" } })

  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.settings.update, { siteName: "Détourné" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})

test("declaredDomain n'accepte qu'un hôte nu, et une chaîne vide l'efface", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, { declaredDomain: "  Exemple.FR.  " })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.declaredDomain).toBe(
    "exemple.fr",
  )

  await expect(
    owner.identity.mutation(api.settings.update, { declaredDomain: "https://exemple.fr" }),
  ).rejects.toThrow()

  await owner.identity.mutation(api.settings.update, { declaredDomain: null })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.declaredDomain).toBeNull()
})

test("settings.get ne porte ni serpLocationCode ni serpLanguageCode ni les modèles OpenRouter", async () => {
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      siteName: "AstroTan",
      serpLocationCode: 2250,
      serpLanguageCode: "fr",
      openRouterModel: "openai/gpt-4o-mini",
      openRouterImageModel: "google/gemini-3-pro-image",
      openRouterOcrModel: "google/gemini-2.5-flash",
    }),
  )
  const pub = await t.query(api.settings.get, {})
  expect(pub).not.toHaveProperty("serpLocationCode")
  expect(pub).not.toHaveProperty("serpLanguageCode")
  expect(pub).not.toHaveProperty("openRouterModel")
  expect(pub).not.toHaveProperty("openRouterImageModel")
  expect(pub).not.toHaveProperty("openRouterOcrModel")
})

test("un language_code hors [a-z]{2} lève INVALID_SERP_LOCALE", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, { serpLanguageCode: "FR" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SERP_LOCALE" } })
})

test("un location_code ≤ 0 lève INVALID_SERP_LOCALE", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, { serpLocationCode: 0 }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SERP_LOCALE" } })
})

test("un location_code hors liste lève INVALID_SERP_LOCALE", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, { serpLocationCode: 2840 }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SERP_LOCALE" } })
})

test("un modèle OpenRouter hors liste lève INVALID_OPENROUTER_MODEL", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, {
      openRouterModel: "openai/gpt-nexiste-pas",
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_OPENROUTER_MODEL" } })
})

test("un editor ne pose pas le modèle OpenRouter", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.settings.update, {
      openRouterModel: "x-ai/grok-4.6",
    }),
  ).rejects.toThrow()
})

test("getPrivate rend le modèle OpenRouter ; update l'écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "AstroTan" })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.openRouterModel).toBeNull()
  await owner.identity.mutation(api.settings.update, {
    openRouterModel: "anthropic/claude-opus-5",
  })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.openRouterModel).toBe(
    "anthropic/claude-opus-5",
  )
})

test("un modèle image hors liste lève INVALID_OPENROUTER_IMAGE_MODEL", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, {
      openRouterImageModel: "openai/gpt-image-2",
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_OPENROUTER_IMAGE_MODEL" } })
})

test("getPrivate rend le modèle image ; update l'écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "AstroTan" })
  expect(
    (await owner.identity.query(api.settings.getPrivate, {}))?.openRouterImageModel,
  ).toBeNull()
  await owner.identity.mutation(api.settings.update, {
    openRouterImageModel: "google/gemini-2.5-flash-image",
  })
  expect(
    (await owner.identity.query(api.settings.getPrivate, {}))?.openRouterImageModel,
  ).toBe("google/gemini-2.5-flash-image")
})

test("un modèle OCR hors liste lève INVALID_OPENROUTER_OCR_MODEL", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.settings.update, {
      openRouterOcrModel: "mistralai/mistral-ocr-latest",
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_OPENROUTER_OCR_MODEL" } })
})

test("getPrivate rend le modèle OCR ; update l'écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "AstroTan" })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.openRouterOcrModel).toBeNull()
  await owner.identity.mutation(api.settings.update, {
    openRouterOcrModel: "openai/gpt-5.5",
  })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.openRouterOcrModel).toBe(
    "openai/gpt-5.5",
  )
})

test("getPrivate rend le lieu SERP ; update l'écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "AstroTan" })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.serpLocationCode).toBeNull()
  await owner.identity.mutation(api.settings.update, {
    serpLocationCode: 2250,
    serpLanguageCode: "fr",
  })
  const privee = await owner.identity.query(api.settings.getPrivate, {})
  expect(privee?.serpLocationCode).toBe(2250)
  expect(privee?.serpLanguageCode).toBe("fr")
})

test("setHomePage refuse une page qui n'existe pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // Pointer `/` sur une page inexistante mettrait la porte d'entrée du
  // site en 404, sans rien dans le tableau de bord pour dire pourquoi.
  await expect(
    owner.identity.mutation(api.settings.setHomePage, { slug: "fantome" }),
  ).rejects.toMatchObject({ data: { code: "UNKNOWN_PAGE" } })
})

test("setHomePage désigne la page, et null la libère", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Accueil", slug: "accueil" })

  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })
  expect(await t.query(api.settings.homePageSlug, {})).toBe("accueil")

  await owner.identity.mutation(api.settings.setHomePage, { slug: null })
  expect(await t.query(api.settings.homePageSlug, {})).toBeNull()
})

test("renommer le slug de la page d'accueil suit dans les réglages", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Accueil",
    slug: "accueil",
  })
  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })

  await owner.identity.mutation(api.pages.update, { id, slug: "home" })

  // Sans ce suivi, `/` pointerait sur un slug que plus aucune page ne
  // porte, et le site n'aurait plus de page d'accueil.
  expect(await t.query(api.settings.homePageSlug, {})).toBe("home")
})

test("renommer une page ordinaire ne touche pas à la page d'accueil", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Accueil", slug: "accueil" })
  const autre = await owner.identity.mutation(api.pages.create, {
    title: "Autre",
    slug: "autre",
  })
  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })

  await owner.identity.mutation(api.pages.update, { id: autre, slug: "autre-renomme" })
  expect(await t.query(api.settings.homePageSlug, {})).toBe("accueil")
})

test("get expose metaPixelId et googleTagId : null si jamais saisis, \"\" si retirés", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  const vide = await t.query(api.settings.get, {})
  expect(vide?.metaPixelId).toBeNull()
  expect(vide?.googleTagId).toBeNull()

  await owner.identity.mutation(api.settings.update, {
    metaPixelId: "123456789012345",
    googleTagId: "AW-999",
  })
  const plein = await t.query(api.settings.get, {})
  expect(plein?.metaPixelId).toBe("123456789012345")
  expect(plein?.googleTagId).toBe("AW-999")

  await owner.identity.mutation(api.settings.update, { metaPixelId: null })
  const retire = await t.query(api.settings.get, {})
  expect(retire?.metaPixelId).toBe("")
  expect(retire?.googleTagId).toBe("AW-999")
  const privee = await owner.identity.query(api.settings.getPrivate, {})
  expect(privee?.metaPixelId).toBe("")
  expect(privee?.googleTagId).toBe("AW-999")
})

test("changer un pixel enfile une outbox site et planifie drain", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  await owner.identity.mutation(api.settings.update, { metaPixelId: "123456789012345" })
  const rows = await t.run(async (ctx) => ctx.db.query("revalidationOutbox").collect())
  const site = rows.filter((r) => r.kind === "site")
  expect(site).toHaveLength(1)
  expect(site[0]?.tags).toEqual(["pages", "posts"])
  const expectedName = getFunctionName(internal.revalidate.drain)
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  expect(scheduled.some((job) => job.name === expectedName)).toBe(true)
})

test("renommer le site n'enfile pas d'outbox site", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  await owner.identity.mutation(api.settings.update, { siteName: "Autre nom" })
  const rows = await t.run(async (ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows.filter((r) => r.kind === "site")).toHaveLength(0)
})

test("update n'accepte qu'un réseau du catalogue, sans doublon, en http(s)", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })

  await owner.identity.mutation(api.settings.update, {
    socials: [{ label: "Instagram", url: " https://instagram.com/exemple " }],
  })
  expect((await t.query(api.settings.get, {}))?.socials).toEqual([
    { label: "instagram", url: "https://instagram.com/exemple" },
  ])

  await expect(
    owner.identity.mutation(api.settings.update, {
      socials: [{ label: "Forum", url: "https://forum.exemple" }],
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SOCIAL_NETWORK" } })

  await expect(
    owner.identity.mutation(api.settings.update, {
      socials: [
        { label: "instagram", url: "https://instagram.com/a" },
        { label: "Instagram", url: "https://instagram.com/b" },
      ],
    }),
  ).rejects.toMatchObject({ data: { code: "DUPLICATE_SOCIAL" } })

  await expect(
    owner.identity.mutation(api.settings.update, {
      socials: [{ label: "instagram", url: "javascript:alert(1)" }],
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SOCIAL_URL" } })
})

test("settings.get ne porte plus l'apparence du chat — c'est chatAppearance", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.updateAgent, {
    agentEnabled: true,
    agentDisplayName: "Aide",
    agentInstructions: "Sois bref.",
    agentKnowledge: "Horaires : 9h-18h",
    agentChatColor: "#f60f74",
    agentTeaser: "Une question ?",
  })
  const pub = await t.query(api.settings.get, {})
  expect(pub).not.toHaveProperty("agentEnabled")
  expect(pub).not.toHaveProperty("agentKnowledge")
  expect(pub).not.toHaveProperty("agentInstructions")
  expect(pub).not.toHaveProperty("agentDisplayName")
  expect(pub).not.toHaveProperty("agentAvatarMediaId")
  expect(pub).not.toHaveProperty("agentAvatarUrl")
  expect(pub).not.toHaveProperty("agentChatColor")
  expect(pub).not.toHaveProperty("agentTeaser")
  expect(pub?.homePageSlug ?? null).toBeNull()

  // Sans session : exactement ce qu'un visiteur du site obtient.
  const widget = await t.query(api.settings.chatAppearance, {})
  expect(widget).toMatchObject({
    agentEnabled: true,
    agentDisplayName: "Aide",
    agentAvatarMediaId: null,
    agentAvatarUrl: null,
    agentChatColor: "#f60f74",
    agentTeaser: "Une question ?",
  })
  expect(widget).not.toHaveProperty("agentKnowledge")
  expect(widget).not.toHaveProperty("agentInstructions")
  expect(widget).not.toHaveProperty("siteName")
})

test("chatAppearance vaut null sur un site jamais configuré", async () => {
  const t = makeTestConvex()
  expect(await t.query(api.settings.chatAppearance, {})).toBeNull()
})

test("updateAgent refuse un hex invalide et un teaser trop long", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.updateAgent, {
    agentChatColor: "#f60",
    agentTeaser: "x".repeat(MAX_AGENT_TEASER),
  })
  const ok = await t.query(api.settings.chatAppearance, {})
  expect(ok?.agentChatColor).toBe("#ff6600")
  expect(ok?.agentTeaser).toHaveLength(MAX_AGENT_TEASER)

  await expect(
    owner.identity.mutation(api.settings.updateAgent, { agentChatColor: "red" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_AGENT_CHAT_COLOR" } })
  await expect(
    owner.identity.mutation(api.settings.updateAgent, { agentChatColor: "#12" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_AGENT_CHAT_COLOR" } })
  await expect(
    owner.identity.mutation(api.settings.updateAgent, {
      agentTeaser: "x".repeat(MAX_AGENT_TEASER + 1),
    }),
  ).rejects.toMatchObject({
    data: { code: "FIELD_TOO_LONG", field: "agentTeaser", max: MAX_AGENT_TEASER },
  })
})

test("updateAgent normalise la couleur, trim le teaser, et un vide retire", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.updateAgent, {
    agentChatColor: "  #F60F74  ",
    agentTeaser: "  Une question ?  ",
    agentDisplayName: "  Léa  ",
  })
  const plein = await t.query(api.settings.chatAppearance, {})
  expect(plein?.agentChatColor).toBe("#f60f74")
  expect(plein?.agentTeaser).toBe("Une question ?")
  expect(plein?.agentDisplayName).toBe("Léa")

  await owner.identity.mutation(api.settings.updateAgent, {
    agentChatColor: "",
    agentTeaser: "   ",
    agentDisplayName: "   ",
  })
  const vide = await t.query(api.settings.chatAppearance, {})
  expect(vide?.agentChatColor).toBeNull()
  expect(vide?.agentTeaser).toBeNull()
  expect(vide?.agentDisplayName).toBeNull()
})

test("agentKnowledge trop long lève FIELD_TOO_LONG", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await admin.identity.mutation(api.settings.updateAgent, {
    agentKnowledge: "x".repeat(MAX_AGENT_KNOWLEDGE),
  })
  await expect(
    admin.identity.mutation(api.settings.updateAgent, {
      agentEnabled: true,
      agentDisplayName: "Aide",
      agentInstructions: "Sois bref.",
      agentKnowledge: "x".repeat(MAX_AGENT_KNOWLEDGE + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "agentKnowledge" } })
})

test("ensureDefaultAgentInstructions écrit le brief si le champ est absent ou vide, jamais par-dessus une consigne réelle", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run((ctx) => ctx.db.insert("settings", { siteName: "Cabinet" }))

  const firstReturn = await owner.identity.mutation(
    api.settings.ensureDefaultAgentInstructions,
    {},
  )
  expect(firstReturn).toBe(DEFAULT_AGENT_INSTRUCTIONS)
  const first = await owner.identity.query(api.settings.getPrivate, {})
  expect(first?.agentInstructions).toBe(DEFAULT_AGENT_INSTRUCTIONS)

  await owner.identity.mutation(api.settings.updateAgent, { agentInstructions: "" })
  const backfill = await owner.identity.mutation(
    api.settings.ensureDefaultAgentInstructions,
    {},
  )
  expect(backfill).toBe(DEFAULT_AGENT_INSTRUCTIONS)
  const cleared = await owner.identity.query(api.settings.getPrivate, {})
  expect(cleared?.agentInstructions).toBe(DEFAULT_AGENT_INSTRUCTIONS)

  await owner.identity.mutation(api.settings.updateAgent, { agentInstructions: "Sois bref." })
  const keep = await owner.identity.mutation(api.settings.ensureDefaultAgentInstructions, {})
  expect(keep).toBe("Sois bref.")
  const authored = await owner.identity.query(api.settings.getPrivate, {})
  expect(authored?.agentInstructions).toBe("Sois bref.")
})

test("un editor ne pose pas l'agent", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.settings.updateAgent, { agentEnabled: true }),
  ).rejects.toThrow()
})

test("un editor lit les IDs et ne peut pas les écrire", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, {
    siteName: "Exemple",
    metaPixelId: "123456789012345",
  })
  const editor = await seedActor(t, "editor")
  expect((await editor.identity.query(api.settings.getPrivate, {}))?.metaPixelId).toBe(
    "123456789012345",
  )
  await expect(
    editor.identity.mutation(api.settings.update, { metaPixelId: "99999" }),
  ).rejects.toThrow()
})
