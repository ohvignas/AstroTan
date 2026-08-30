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
// L'adresse de référence est celle de l'hôte web COURANT, celui qui sert
// déjà — `routing.deriverHotes` : le domaine déclaré, sinon `WEB_DOMAIN`.
//
// CE QUE CES TESTS DISCRIMINENT, vérifié en retirant la garde :
//   - `jugerA` qui rend `"ok"` dès qu'une IPv4 publique est trouvée (le
//     code d'avant) → 3 échecs.
//   - la référence `indisponible` traitée comme `aucune` → 1 échec.
//   - `hoteCourant` qui rendrait toujours `null` → 4 échecs.
// ---------------------------------------------------------------------

/** L'adresse du serveur qui sert déjà, dans tous les tests ci-dessous. */
const NOTRE_IP = "203.0.113.7"

/** Une IPv4 publique parfaitement valide, et qui n'est pas la nôtre. */
const IP_DU_PROXY = "104.21.5.9"

test("checkSite : une IP publique qui n'est pas celle du serveur n'arme rien", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  // L'hôte courant, celui que Traefik sert : c'est lui qui donne
  // l'adresse de référence, sans qu'on la demande à personne.
  process.env.WEB_DOMAIN = "actuel.fr"
  vi.stubGlobal(
    "fetch",
    stubDns({
      "actuel.fr/A": [NOTRE_IP],
      // Le domaine visé pointe vers un proxy. Rien n'est « manquant » :
      // l'enregistrement existe, il mène ailleurs.
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
  process.env.WEB_DOMAIN = "actuel.fr"
  vi.stubGlobal(
    "fetch",
    stubDns({
      "actuel.fr/A": [NOTRE_IP],
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

test("checkSite : le domaine déclaré est l'hôte de référence, pas `WEB_DOMAIN`", async () => {
  // `WEB_DOMAIN` n'est plus que le repli (`routing.deriverHotes`). Après un
  // premier changement de domaine il désigne un hôte que Traefik ne sert
  // plus, et s'y référer comparerait à l'adresse d'un serveur d'avant.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_DOMAIN = "repli.fr"
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Mon site", declaredDomain: "actuel.fr" }),
  )
  vi.stubGlobal(
    "fetch",
    stubDns({
      "actuel.fr/A": ["198.51.100.4"],
      "repli.fr/A": [NOTRE_IP],
      "exemple.fr/A": [NOTRE_IP],
      "admin.exemple.fr/A": [NOTRE_IP],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  // Vert si la référence venait de `repli.fr` ; rouge parce qu'elle vient
  // du domaine déclaré.
  expect(verdicts.map((v) => v.etat)).toEqual(["different", "different"])
})

test("checkSite : sans hôte courant, un premier déploiement peut encore enregistrer", async () => {
  // Ni domaine déclaré, ni `WEB_DOMAIN` : il n'existe aucun serveur à qui
  // comparer. Refuser ici enfermerait un déploiement neuf dans un écran où
  // le premier domaine ne peut jamais être enregistré. On retombe sur ce
  // qu'on sait dire de vrai — la forme.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({ "exemple.fr/A": [IP_DU_PROXY], "admin.exemple.fr/A": [IP_DU_PROXY] }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.etat)).toEqual(["ok", "ok"])
})

test("checkSite : un hôte courant illisible ne dit ni « en place » ni « à poser »", async () => {
  // Il y a un hôte courant, et le résolveur n'a rien rendu pour lui. Les
  // trois états ne se confondent pas : ce n'est pas « en place », ce n'est
  // pas « à créer », c'est « le résolveur n'a pas répondu ». Rendre `ok`
  // ici rouvrirait le verrou à chaque hoquet du résolveur — donc en
  // permanence, pour qui insiste.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_DOMAIN = "actuel.fr"
  vi.stubGlobal(
    "fetch",
    stubDns({ "exemple.fr/A": [IP_DU_PROXY], "admin.exemple.fr/A": [IP_DU_PROXY] }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => v.etat)).toEqual(["indisponible", "indisponible"])
})

test("checkSite : une adresse privée reste fausse, référence ou pas", async () => {
  // `192.168.1.10` ne mène nulle part depuis l'extérieur, et ça se sait
  // sans rien comparer. Le dire « indisponible » parce que la référence
  // manque enverrait réessayer une lecture qui redonnera la même chose.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_DOMAIN = "actuel.fr"
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["192.168.1.10"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.find((v) => v.cle === "site")!.etat).toBe("different")
})

test("checkSite : l'hôte de référence n'est résolu qu'une fois pour les deux lignes", async () => {
  // Les deux lignes A partagent la même référence : la résoudre par ligne
  // doublerait une requête sortante pour une réponse identique.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_DOMAIN = "actuel.fr"
  const appels = stubDns({
    "actuel.fr/A": [NOTRE_IP],
    "exemple.fr/A": [NOTRE_IP],
    "admin.exemple.fr/A": [NOTRE_IP],
  })
  vi.stubGlobal("fetch", appels)
  await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const noms = appels.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("name"))
  expect(noms.filter((nom) => nom === "actuel.fr")).toHaveLength(1)
  expect(noms).toHaveLength(3)
})

test("checkEmail : la référence du serveur ne le concerne pas", async () => {
  // SPF, DKIM et DMARC ne sont pas des A : rien à comparer à l'adresse du
  // serveur, et surtout aucune requête de plus à émettre pour eux.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.WEB_DOMAIN = "actuel.fr"
  const appels = stubDns({})
  vi.stubGlobal("fetch", appels)
  await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  const noms = appels.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("name"))
  expect(noms).not.toContain("actuel.fr")
})
