import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
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
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `dns-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple dns"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

/** Un faux résolveur : une réponse par nom+type demandé. */
function stubDns(reponses: Record<string, string[]>) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url))
    const cle = `${u.searchParams.get("name")}/${u.searchParams.get("type")}`
    const valeurs = reponses[cle]
    return new Response(
      JSON.stringify(
        valeurs === undefined
          ? { Status: 3 }
          : { Status: 0, Answer: valeurs.map((data) => ({ data })) },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
}

test("checkSite : A présent sur les deux hôtes rend deux verdicts ok", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({ "exemple.fr/A": ["203.0.113.7"], "admin.exemple.fr/A": ["203.0.113.7"] }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["site", "ok"],
    ["admin", "ok"],
  ])
})

test("checkSite : un enregistrement absent porte l'instruction à suivre", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["203.0.113.7"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const ligne = verdicts.find((v) => v.cle === "admin")!
  expect(ligne.etat).toBe("manquant")
  // L'écran n'a pas à composer la phrase : le verdict la porte, pour que
  // la formulation soit testée plutôt que rendue. Type, nom et valeur, les
  // trois — une instruction à laquelle il manque le type ou le nom oblige
  // à aller chercher ailleurs ce qu'on est venu chercher là.
  expect(ligne.instruction).toContain("admin.exemple.fr")
  expect(ligne.instruction).toContain(" A ")
  expect(ligne.instruction).toContain(ligne.attendu)
})

test("checkEmail : chaque ligne porte le nom et la valeur exacts à saisir", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({}))
  const verdicts = await admin.identity.action(api.dns.checkEmail, {
    domaine: "exemple.fr",
  })
  // Ce sont les noms soulignés (RFC 8552) : ceux qu'un hôte ne peut pas
  // porter, et donc ceux qu'une validation d'hôte refuse si on ne l'a pas
  // prévu — le cas où la vérification rendrait « indisponible » pour tout
  // le monde, sans rien dire de faux, en ne vérifiant rien.
  const par = Object.fromEntries(verdicts.map((v) => [v.cle, v]))
  expect(par.spf!.instruction).toContain("v=spf1 include:amazonses.com ~all")
  expect(par.dkim!.instruction).toContain("resend._domainkey.exemple.fr")
  expect(par.dmarc!.instruction).toContain("_dmarc.exemple.fr")
  expect(par.dmarc!.instruction).toContain("v=DMARC1")
})

test("checkSite : une adresse privée n'est pas un site joignable", async () => {
  // Un A qui pointe vers 192.168.x.x est une erreur de configuration
  // fréquente derrière un routeur domestique. « ok » ici enverrait
  // l'adoptant chercher ailleurs pendant des heures.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["192.168.1.10"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const ligne = verdicts.find((v) => v.cle === "site")!
  expect(ligne.etat).toBe("different")
  // La valeur trouvée est rendue : sans elle, l'adoptant ne sait pas
  // laquelle des lignes de sa zone il doit corriger.
  expect(ligne.trouve).toEqual(["192.168.1.10"])
})

test("checkSite : un A derrière un CNAME reste joignable", async () => {
  // Le résolveur rend la chaîne entière. Ne regarder que la première
  // réponse ferait dire « different » à une configuration correcte.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": ["cible.hebergeur.test.", "203.0.113.7"],
      "admin.exemple.fr/A": ["203.0.113.7"],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.find((v) => v.cle === "site")!.etat).toBe("ok")
})

test("checkEmail : SPF, DKIM et DMARC, chacun sa ligne", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/TXT": ['"v=spf1 include:amazonses.com ~all"'],
      "resend._domainkey.exemple.fr/TXT": ['"p=MIGfMA0G"'],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["spf", "ok"],
    ["dkim", "ok"],
    ["dmarc", "manquant"],
  ])
})

test("checkEmail : un SPF qui n'autorise pas l'expéditeur est « different », pas « ok »", async () => {
  // Un domaine porte souvent déjà un SPF, écrit pour un autre service.
  // Le trouver ne suffit pas : c'est `include:amazonses.com` qui décide
  // si les messages du site arrivent.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/TXT": ["google-site-verification=abc", "v=spf1 include:_spf.autre.fr ~all"],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  expect(verdicts.find((v) => v.cle === "spf")!.etat).toBe("different")
})

test("un résolveur en panne rend « indisponible », jamais « manquant »", async () => {
  // La distinction décide de ce que l'adoptant fait ensuite : « manquant »
  // veut dire « créez cet enregistrement », « indisponible » veut dire
  // « réessayez ». Les confondre fait créer un doublon.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("réseau")
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.every((v) => v.etat === "indisponible")).toBe(true)
  // Et l'instruction ne dit surtout pas de créer quoi que ce soit.
  expect(verdicts[0]!.instruction).toContain("réessayez")
})

test("un domaine invalide est refusé avant le premier appel sortant", async () => {
  // L'ordre est la garde : valider après le premier `fetch` ferait de ce
  // champ de saisie un moyen d'émettre des requêtes depuis ce déploiement.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const appels = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", appels)
  await expect(
    admin.identity.action(api.dns.checkSite, { domaine: "https://exemple.fr/x" }),
  ).rejects.toThrow(/INVALID_DOMAIN/)
  expect(appels).not.toHaveBeenCalled()
})

test("un editor ne peut pas lancer la vérification", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const appels = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", appels)
  await expect(
    editor.identity.action(api.dns.checkSite, { domaine: "exemple.fr" }),
  ).rejects.toThrow(/FORBIDDEN/)
  // Le rôle est vérifié AVANT le premier appel sortant : un refus qui
  // laisse partir les requêtes n'a rien refusé.
  expect(appels).not.toHaveBeenCalled()
})

test("un owner peut lancer la vérification", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["203.0.113.7"] }))
  const verdicts = await owner.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.cle)).toEqual(["spf", "dkim", "dmarc"])
})

test("un appelant sans session est refusé", async () => {
  const t = makeTestConvex()
  await expect(t.action(api.dns.checkSite, { domaine: "exemple.fr" })).rejects.toThrow()
})
