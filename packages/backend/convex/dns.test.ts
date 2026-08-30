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

test("checkSite : un enregistrement absent porte le type et le nom à créer", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["203.0.113.7"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const ligne = verdicts.find((v) => v.cle === "admin")!
  expect(ligne.etat).toBe("manquant")
  // Trois CHAMPS, et non une phrase qui les contient : ce sont les trois
  // colonnes d'un formulaire de zone DNS, et l'écran les met en colonnes.
  // Une phrase l'aurait obligé à la découper, ou à recalculer les mêmes
  // noms de son côté — deux copies de cette table qui divergeraient.
  expect(ligne.type).toBe("A")
  expect(ligne.nom).toBe("admin.exemple.fr")
  expect(ligne.attendu).toBe("l'adresse IPv4 publique de votre serveur")
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
  expect(par.spf!.nom).toBe("exemple.fr")
  expect(par.spf!.attendu).toBe("v=spf1 include:amazonses.com ~all")
  expect(par.dkim!.nom).toBe("resend._domainkey.exemple.fr")
  expect(par.dmarc!.nom).toBe("_dmarc.exemple.fr")
  expect(par.dmarc!.attendu).toContain("v=DMARC1")
  expect(verdicts.map((v) => v.type)).toEqual(["TXT", "TXT", "TXT"])
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
  // Et l'enregistrement reste entièrement décrit : ce qu'il faut créer ne
  // dépend pas du résolveur, seul son état en dépend.
  expect(verdicts[0]!.nom).toBe("exemple.fr")
  expect(verdicts[0]!.type).toBe("A")
})

test("plan : les cinq enregistrements sont connus sans une seule requête", async () => {
  // LE COMPORTEMENT QUI COMPTE. Ce qu'il faut créer ne dépend que du
  // domaine déclaré ; l'écran l'affiche donc à l'ouverture, sans avoir
  // vérifié quoi que ce soit. Le `fetch` espionné est la preuve : s'il
  // est appelé, cette liste est retombée dans la vérification.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const appels = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", appels)
  const { site, email } = await admin.identity.query(api.dns.plan, {
    domaine: "exemple.fr",
  })
  expect(appels).not.toHaveBeenCalled()
  expect(site.map((e) => [e.type, e.nom])).toEqual([
    ["A", "exemple.fr"],
    ["A", "admin.exemple.fr"],
  ])
  expect(email.map((e) => [e.type, e.nom])).toEqual([
    ["TXT", "exemple.fr"],
    ["TXT", "resend._domainkey.exemple.fr"],
    ["TXT", "_dmarc.exemple.fr"],
  ])
})

test("plan : les mêmes lignes que la vérification, dans le même ordre", async () => {
  // Deux fonctions, une seule table. Si elles divergeaient, l'écran
  // afficherait un enregistrement et cocherait l'autre.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({}))
  const { site, email } = await admin.identity.query(api.dns.plan, {
    domaine: "exemple.fr",
  })
  const verdicts = [
    ...(await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })),
    ...(await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })),
  ]
  expect([...site, ...email]).toEqual(
    verdicts.map(({ trouve: _t, etat: _e, ...enregistrement }) => enregistrement),
  )
})

test("plan : aucune fonction ne part vers le client", async () => {
  // `accepte` est un prédicat porté par la même table. Un spread l'aurait
  // laissé passer, et Convex refuse de sérialiser une fonction.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { site } = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(Object.keys(site[0]!).sort()).toEqual([
    "attendu",
    "cle",
    "libelle",
    "nom",
    "type",
  ])
})

test("plan : un editor ne le lit pas non plus", async () => {
  // Même porte que les deux vérifications : c'est le même écran.
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.query(api.dns.plan, { domaine: "exemple.fr" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

test("plan : un domaine invalide est refusé", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await expect(
    admin.identity.query(api.dns.plan, { domaine: "https://exemple.fr/x" }),
  ).rejects.toThrow(/INVALID_DOMAIN/)
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
