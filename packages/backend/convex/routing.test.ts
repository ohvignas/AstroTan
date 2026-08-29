import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

const SECRET = "r".repeat(64)

// Les quatre variables que cette query lit. Elles sont posées et retirées
// explicitement à chaque test : la suite entière tourne dans UN process, et
// une variable laissée derrière ferait passer un test grâce à l'état d'un
// autre — le genre de vert qu'on ne peut pas relire.
const VARIABLES = ["ROUTING_SECRET", "WEB_DOMAIN", "ADMIN_DOMAIN", "UMAMI_DOMAIN"] as const

function oublierLesVariables() {
  for (const nom of VARIABLES) delete process.env[nom]
}

beforeEach(() => {
  oublierLesVariables()
  process.env.ROUTING_SECRET = SECRET
  process.env.WEB_DOMAIN = "exemple.fr"
})

afterEach(oublierLesVariables)

test("sans secret valide, la query refuse — et ne dit pas pourquoi", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.routing.hotes, { secret: "faux" })).rejects.toThrow()
  // Un message qui distinguerait « secret absent du déploiement » de
  // « secret faux » dirait à un attaquant s'il vaut la peine d'insister.
  // `assertSharedSecret` ne rend qu'un code, jamais l'écart mesuré, et la
  // comparaison est en temps constant des deux côtés.
})

test("sans secret configuré sur le déploiement, personne ne passe", async () => {
  // Le cas fréquent, et celui où une porte ouverte ne se voit pas : la
  // variable oubliée. Un `ROUTING_SECRET` absent doit fermer, jamais
  // ouvrir — sinon le premier venu dicte le routage de Traefik.
  delete process.env.ROUTING_SECRET
  const t = makeTestConvex()
  await expect(t.query(api.routing.hotes, { secret: "" })).rejects.toThrow()
})

test("sans domaine déclaré, les hôtes viennent de l'environnement", async () => {
  // Le repli est le cas NORMAL d'un déploiement neuf : personne n'a encore
  // ouvert l'écran des réglages, et le routage doit déjà fonctionner.
  const t = makeTestConvex()
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toEqual({
    web: "exemple.fr",
    admin: "admin.exemple.fr",
    umami: null,
  })
})

test("un ADMIN_DOMAIN posé l'emporte sur la convention", async () => {
  // La convention `admin.<domaine>` est une DÉDUCTION, pas une loi : un
  // déploiement existant a pu publier son dashboard ailleurs, et lui
  // réécrire son routage sous prétexte de convention le mettrait hors ligne.
  process.env.ADMIN_DOMAIN = "console.exemple.fr"
  const t = makeTestConvex()
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    admin: "console.exemple.fr",
  })
})

test("umami ne sort que si umami est déployé", async () => {
  // `umami: null` est un cas ORDINAIRE : les deux services s'enlèvent du
  // compose, et `UMAMI_DOMAIN` disparaît avec eux. Publier `stats.<domaine>`
  // pour un service absent ferait demander à Traefik un certificat pour un
  // nom sans enregistrement DNS — et chaque échec compte dans le quota
  // hebdomadaire de Let's Encrypt.
  process.env.UMAMI_DOMAIN = "stats.exemple.fr"
  const t = makeTestConvex()
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    umami: "stats.exemple.fr",
  })
})

test("un domaine déclaré l'emporte, et entraîne ses sous-domaines", async () => {
  // C'est tout l'objet du plan : une seule valeur change, trois hôtes suivent.
  process.env.ADMIN_DOMAIN = "admin.exemple.fr"
  process.env.UMAMI_DOMAIN = "stats.exemple.fr"
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Mon site", declaredDomain: "nouveau.fr" }),
  )
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toEqual({
    web: "nouveau.fr",
    admin: "admin.nouveau.fr",
    umami: "stats.nouveau.fr",
  })
})

test("un domaine déclaré n'invente pas un umami absent", async () => {
  // Le domaine déclaré change les hôtes ; il ne DÉPLOIE rien. Sans
  // `UMAMI_DOMAIN`, il n'y a pas de service à router.
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Mon site", declaredDomain: "nouveau.fr" }),
  )
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toEqual({
    web: "nouveau.fr",
    admin: "admin.nouveau.fr",
    umami: null,
  })
})

test("un domaine invalide en base ne produit JAMAIS d'hôte", async () => {
  // Cette valeur devient une règle de routage. Une chaîne arbitraire qui
  // arriverait jusqu'au YAML de Traefik y injecterait ce qu'elle veut : un
  // `Host(...)` de plus, un service détourné.
  //
  // `settings.update` valide déjà — mais elle n'est pas le seul chemin
  // d'écriture : une migration, un `npx convex run`, une restauration de
  // sauvegarde posent la valeur sans passer par elle.
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      siteName: "Mon site",
      declaredDomain: "exemple.fr`) || Host(`pirate.fr",
    }),
  )
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "exemple.fr",
  })
  // Repli sur l'environnement, jamais la valeur douteuse.
})

test("un domaine déclaré est normalisé avant de servir d'hôte", async () => {
  // Le point final est légal en DNS et se colle à un copier-coller depuis
  // une zone. `normaliserHote` l'enlève, et met en minuscules : deux hôtes
  // qui ne diffèrent que par là routeraient deux fois le même site, et
  // demanderaient deux certificats.
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Mon site", declaredDomain: "  NOUVEAU.FR.  " }),
  )
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "nouveau.fr",
    admin: "admin.nouveau.fr",
  })
})

test("sans domaine nulle part, la query refuse plutôt que de rendre un hôte vide", async () => {
  // L'échec reste FERMÉ : pas de routage vaut mieux qu'un mauvais routage.
  // Rendre `""` ferait composer `Host(``)`, que Traefik accepte comme une
  // règle qui ne matche rien — une panne muette au lieu d'une erreur.
  delete process.env.WEB_DOMAIN
  const t = makeTestConvex()
  await expect(t.query(api.routing.hotes, { secret: SECRET })).rejects.toThrow()
})
