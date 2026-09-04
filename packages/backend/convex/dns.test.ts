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
  // Retiré explicitement, jamais supposé absent : c'est cette variable qui
  // décide de l'hôte web COURANT (`routing.deriverHotes`), donc de
  // l'adresse de référence à laquelle un A est comparé. Un shell qui la
  // porterait ferait passer ou échouer ces tests pour une raison qui n'est
  // pas dans le dépôt. Chaque test qui a besoin d'un hôte courant la pose
  // lui-même.
  delete process.env.WEB_DOMAIN
  // Même motif : un shell qui porterait `UMAMI_DOMAIN` ajouterait une
  // troisième ligne A (`stats.<domaine>`) à tous les tests, et ferait
  // échouer les comptes d'appels et les listes à deux hôtes.
  delete process.env.UMAMI_DOMAIN
  // Les origines locales : `SITE_URL` vaut déjà `localhost:3001` (ORIGIN).
  // `WEB_SITE_URL` n'est posé que par les tests qui en ont besoin ; sans
  // lui, un déploiement local replie sur le port documenté du site (4321).
  delete process.env.WEB_SITE_URL
  // L'IP du VPS n'est jamais supposée déjà posée : c'est elle, et non le
  // lookup du domaine déclaré, qui décide de « Connecté ».
  delete process.env.VPS_IP4
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
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = "203.0.113.7"
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": ["203.0.113.7"],
      "admin.exemple.fr/A": ["203.0.113.7"],
    }),
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
  // Pas de lookup, pas de serveur de référence : en local on affiche
  // l'origine du dashboard, jamais le libellé pédagogique.
  expect(ligne.attendu).toBe("localhost:3001")
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
  // Même raison qu'au-dessus : un hôte courant, sinon le CNAME serait
  // « joignable » par simple contrôle de forme et la chaîne ne serait pas
  // vraiment déroulée jusqu'à une adresse COMPARÉE.
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = "203.0.113.7"
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
  // La raison traverse jusqu'à l'écran : « Non connecté » seul ne dit
  // pas si c'est le réseau, un délai, ou une absence de réponse.
  expect(verdicts[0]!.raison).toBe("Réseau : le résolveur est injoignable.")
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
  expect(site.map((e) => [e.type, e.nom, e.attendu])).toEqual([
    ["A", "exemple.fr", "localhost:4321"],
    ["A", "admin.exemple.fr", "localhost:3001"],
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
    verdicts.map(({ trouve: _t, etat: _e, raison: _r, ...enregistrement }) => enregistrement),
  )
})

test("plan : aucune fonction ne part vers le client", async () => {
  // `juger` est un prédicat porté par la même table. Un spread l'aurait
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

// ---------------------------------------------------------------------
// LE VERROU COMPARE, IL NE VÉRIFIE PLUS UNE FORME.
//
// Une IPv4 publique n'est pas *notre* IPv4. Un domaine parqué chez le
// registrar, resté chez l'ancien hébergeur, ou derrière Cloudflare en mode
// proxy en rend une — et c'est le mode d'échec le plus rapporté sur
// Traefik + Let's Encrypt (`docker/README.md` §3), sur un VPS Hostinger
// souvent livré avec son DNS chez Cloudflare. Le bouton s'armait,
// l'adoptant enregistrait, le challenge HTTP-01 échouait chez le proxy, et
// l'échec comptait dans le quota de cinq par domaine et par semaine.
//
// L'adresse de référence est `VPS_IP4`, pas le lookup du domaine déclaré.
//
// CE QUE CES TESTS DISCRIMINENT, vérifié en retirant la garde :
//   - `jugerA` qui rend `"ok"` dès qu'une IPv4 publique est trouvée (le
//     code d'avant) → 3 échecs.
//   - le lookup du domaine déclaré pris pour attendu → tautologie, 2 échecs.
// ---------------------------------------------------------------------

/** L'adresse du serveur qui sert déjà, dans tous les tests ci-dessous. */
const NOTRE_IP = "203.0.113.7"

/** Une IPv4 publique parfaitement valide, et qui n'est pas la nôtre. */
const IP_DU_PROXY = "104.21.5.9"

test("checkSite : une IP publique qui n'est pas celle du serveur n'arme rien", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": [IP_DU_PROXY],
      "admin.exemple.fr/A": [IP_DU_PROXY],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["site", "different"],
    ["admin", "different"],
  ])
  // `trouve` porte l'adresse vue : c'est la seule façon pour l'adoptant de
  // savoir laquelle des lignes de sa zone il doit corriger.
  expect(verdicts[0]!.trouve).toEqual([IP_DU_PROXY])
})

test("checkSite : l'adresse du serveur qui sert déjà arme le bouton", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": [NOTRE_IP],
      "admin.exemple.fr/A": [NOTRE_IP],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["site", "ok"],
    ["admin", "ok"],
  ])
})

test("checkSite : sans VPS_IP4 en prod, le verdict est `forme` — pas `ok`", async () => {
  // Origines publiques, pas d'IP connue : on a vu un A, on ne sait pas
  // s'il mène ICI. `forme`, pas `ok` — et surtout on ne recopie pas le
  // lookup dans l'attendu.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  vi.stubGlobal(
    "fetch",
    stubDns({ "exemple.fr/A": [IP_DU_PROXY], "admin.exemple.fr/A": [IP_DU_PROXY] }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.etat)).toEqual(["forme", "forme"])
  expect(verdicts.map((v) => v.attendu)).toEqual(["", ""])
})

test("checkSite : `forme` ne survit pas à `VPS_IP4`", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": [IP_DU_PROXY],
      "admin.exemple.fr/A": [NOTRE_IP],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.etat)).toEqual(["different", "ok"])
})

test("checkSite : une adresse privée reste fausse, référence ou pas", async () => {
  // `192.168.1.10` ne mène nulle part depuis l'extérieur, et ça se sait
  // sans rien comparer. Le dire « indisponible » parce que la référence
  // manque enverrait réessayer une lecture qui redonnera la même chose.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.VPS_IP4 = NOTRE_IP
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["192.168.1.10"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.find((v) => v.cle === "site")!.etat).toBe("different")
})

test("checkSite : le lookup ne sert qu'à juger, pas à fabriquer l'attendu", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  const appels = stubDns({
    "exemple.fr/A": [NOTRE_IP],
    "admin.exemple.fr/A": [NOTRE_IP],
  })
  vi.stubGlobal("fetch", appels)
  await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const noms = appels.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("name"))
  expect(noms).toEqual(["exemple.fr", "admin.exemple.fr"])
})

test("checkEmail : la référence du serveur ne le concerne pas", async () => {
  // SPF, DKIM et DMARC ne sont pas des A : rien à comparer à l'adresse du
  // serveur, et surtout aucune requête de plus à émettre pour eux.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.VPS_IP4 = NOTRE_IP
  const appels = stubDns({})
  vi.stubGlobal("fetch", appels)
  await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  const types = appels.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("type"))
  expect(types.every((type) => type === "TXT")).toBe(true)
})

test("checkSite : le lookup part vers Cloudflare DoH", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const appels = stubDns({ "exemple.fr/A": ["198.202.211.1"] })
  vi.stubGlobal("fetch", appels)
  await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const urls = appels.mock.calls.map(([url]) => String(url))
  expect(urls.every((url) => url.startsWith("https://cloudflare-dns.com/dns-query"))).toBe(
    true,
  )
  expect(urls.some((url) => url.includes("name=exemple.fr") && url.includes("type=A"))).toBe(
    true,
  )
})

test("checkSite : DEV + lookup Cloudflare 198.x n'est pas Connecté", async () => {
  // SITE_URL est déjà localhost (ORIGIN). Sans VPS_IP4, l'attendu est
  // localhost:port — le A public d'illith.com ne peut pas peindre du vert.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({
      "illith.com/A": ["198.202.211.1"],
      "admin.illith.com/A": ["198.202.211.1"],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "illith.com" })
  expect(verdicts.map((v) => [v.cle, v.etat, v.attendu])).toEqual([
    ["site", "different", "localhost:4321"],
    ["admin", "different", "localhost:3001"],
  ])
  expect(verdicts[0]!.trouve).toEqual(["198.202.211.1"])
  expect(verdicts.every((v) => v.etat !== "ok")).toBe(true)
})

test("checkSite : prod + VPS_IP4 = lookup Cloudflare → ok", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = "198.202.211.1"
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": ["198.202.211.1"],
      "admin.exemple.fr/A": ["198.202.211.1"],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat, v.attendu])).toEqual([
    ["site", "ok", "198.202.211.1"],
    ["admin", "ok", "198.202.211.1"],
  ])
})

test("checkSite : sans VPS_IP4, le lookup du domaine déclaré n'est pas l'attendu", async () => {
  // La tautologie : declaredDomain = illith.com, le DoH rend 198.x, et
  // l'ancien code prenait ce 198.x pour référence puis le comparait à
  // lui-même. Plus maintenant : pas d'IP connue → pas ok, pas d'attendu
  // recopié depuis le lookup.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.illith.com"
  process.env.WEB_SITE_URL = "https://illith.com"
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Illith", declaredDomain: "illith.com" }),
  )
  vi.stubGlobal(
    "fetch",
    stubDns({
      "illith.com/A": ["198.202.211.1"],
      "admin.illith.com/A": ["198.202.211.1"],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "illith.com" })
  expect(verdicts.every((v) => v.etat !== "ok")).toBe(true)
  expect(verdicts.map((v) => v.attendu)).not.toContain("198.202.211.1")
  expect(verdicts[0]!.trouve).toEqual(["198.202.211.1"])
})

test("checkSite : l'attendu d'un A est l'IP de référence, pas un libellé", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": [NOTRE_IP],
      "admin.exemple.fr/A": [NOTRE_IP],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.attendu)).toEqual([NOTRE_IP, NOTRE_IP])
  expect(verdicts[0]!.attendu).not.toMatch(/adresse IPv4/i)
})

test("plan : une origine publique n'invente pas localhost", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  const { site } = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(site.map((e) => e.attendu)).toEqual(["", ""])
  expect(site[0]!.attendu).not.toMatch(/localhost/)
})

test("plan : VPS_IP4 est l'attendu, même sans lookup", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = "198.202.211.1"
  const { site } = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(site.map((e) => e.attendu)).toEqual(["198.202.211.1", "198.202.211.1"])
})

test("plan : le port du site local vient de WEB_SITE_URL", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_SITE_URL = "http://localhost:4321"
  const { site } = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(site.find((e) => e.cle === "site")!.attendu).toBe("localhost:4321")
  expect(site.find((e) => e.cle === "admin")!.attendu).toBe("localhost:3001")
})

test("plan : pas de ligne Umami tant que UMAMI_DOMAIN est local ou absent", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const sans = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(sans.site.map((e) => e.cle)).toEqual(["site", "admin"])

  process.env.UMAMI_DOMAIN = "localhost"
  const local = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(local.site.map((e) => e.cle)).toEqual(["site", "admin"])
})

test("plan : Umami publié gagne un A sur stats.<domaine>", async () => {
  // `routing.deriverHotes` publie `stats.<déclaré>` dès que `UMAMI_DOMAIN`
  // est un hôte réel. Sans cet A, Traefik demande un certificat pour un
  // nom que le DNS ne connaît pas — quota Let's Encrypt, même piège que
  // `admin.<domaine>`.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.UMAMI_DOMAIN = "stats.exemple.fr"
  const { site } = await admin.identity.query(api.dns.plan, { domaine: "exemple.fr" })
  expect(site.map((e) => [e.cle, e.type, e.nom])).toEqual([
    ["site", "A", "exemple.fr"],
    ["admin", "A", "admin.exemple.fr"],
    ["umami", "A", "stats.exemple.fr"],
  ])
})

test("checkSite : la ligne Umami est vérifiée avec les deux autres A", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  process.env.VPS_IP4 = NOTRE_IP
  process.env.UMAMI_DOMAIN = "stats.exemple.fr"
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/A": [NOTRE_IP],
      "admin.exemple.fr/A": [NOTRE_IP],
      "stats.exemple.fr/A": [NOTRE_IP],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat, v.attendu])).toEqual([
    ["site", "ok", NOTRE_IP],
    ["admin", "ok", NOTRE_IP],
    ["umami", "ok", NOTRE_IP],
  ])
})
