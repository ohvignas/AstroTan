import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import schema from "./schema"
import { FENETRE_SORTANTE_MS } from "./lib/hotesSortants"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

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
  // Les tests de bout en bout ci-dessous passent par `settings.update`,
  // donc par une session Better Auth.
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  oublierLesVariables()
  vi.useRealTimers()
})

/**
 * Un owner, pour les tests qui passent par la vraie mutation.
 *
 * Les hôtes sortants n'existent que si quelqu'un les a NOTÉS, et le seul
 * qui les note est `settings.update`. Poser `previousDomains` à la main
 * dans la base testerait la lecture en supposant l'écriture — c'est-à-dire
 * en supposant précisément la moitié qui peut manquer.
 */
async function seedOwner(t: TestConvex<typeof schema>) {
  const email = `routing-owner-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple routing"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  return identityFor(t, user.id)
}

/**
 * Seul `Date` est simulé.
 *
 * Simuler les minuteries entières ferait pendre `convex-test`, qui attend
 * de vraies promesses ; et c'est bien `Date.now()` — lu par
 * `settings.update` à l'écriture et par `routing.hotes` à la lecture — qui
 * décide de la fenêtre.
 */
function figerLHorloge(instant: number) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(instant)
}

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
    // Aucun changement de domaine n'a eu lieu : rien à reconnaître en plus
    // des hôtes courants.
    sortants: [],
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
    // La ligne a été posée directement, sans passer par `settings.update` :
    // personne n'a noté de sortant, et la query n'en invente pas.
    sortants: [],
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
    sortants: [],
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

// ---------------------------------------------------------------------
// Les hôtes SORTANTS.
//
// Tout ce lot applique le même principe : ajouter, vérifier, puis
// seulement retirer. Le service `routeur` garde les anciens hôtes routés
// jusqu'à ce que le nouveau serve un certificat valide ; `trustedOrigins`
// ajoute la nouvelle origine sans retirer l'ancienne. Cette query ne
// rendait, elle, que les hôtes COURANTS — si bien qu'un visiteur arrivant
// encore sur l'ancien domaine n'était pas reconnu, que son
// `x-forwarded-for` n'était pas honoré, et qu'il partageait un seau de
// limitation de débit avec tous les autres retardataires.
//
// Les deux tests qui comptent sont les deux premiers : dans la fenêtre,
// l'ancien hôte est rendu ; passé la fenêtre, il ne l'est plus.
// ---------------------------------------------------------------------

const DEBUT = 1_800_000_000_000
const HEURE = 60 * 60 * 1000

test("PENDANT la fenêtre, l'ancien domaine est encore rendu comme sortant", async () => {
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })

  // Vingt-quatre heures plus tard : le DNS peut ne pas être propagé
  // partout, et le routeur garde `exemple.fr` routé tant que `nouveau.fr`
  // ne sert pas un certificat valide.
  figerLHorloge(DEBUT + 24 * HEURE)
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toEqual({
    web: "nouveau.fr",
    admin: "admin.nouveau.fr",
    umami: null,
    sortants: ["exemple.fr"],
  })
})

test("PASSÉ la fenêtre, il ne l'est plus", async () => {
  // La moitié qui BORNE. Un hôte reconnu pour toujours le resterait après
  // que l'adoptant a laissé le domaine expirer et que quelqu'un d'autre
  // l'a racheté.
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })

  figerLHorloge(DEBUT + FENETRE_SORTANTE_MS + 1)
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "nouveau.fr",
    sortants: [],
  })
})

test("la PREMIÈRE déclaration compte comme un changement", async () => {
  // Le cas de l'adoptant qui arrive, et celui que « ne noter que les
  // `declaredDomain` remplacés » laisserait sans filet : avant sa première
  // déclaration, l'hôte en vigueur est `WEB_DOMAIN`, et c'est lui qui
  // reçoit encore tout le trafic pendant la bascule.
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })

  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    sortants: ["exemple.fr"],
  })
})

test("effacer le domaine déclaré est le mouvement inverse, et se note pareil", async () => {
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })
  figerLHorloge(DEBUT + HEURE)
  await owner.mutation(api.settings.update, { declaredDomain: null })

  // On repart sur `WEB_DOMAIN`, et c'est `nouveau.fr` qui devient sortant.
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "exemple.fr",
    sortants: ["nouveau.fr"],
  })
})

test("deux changements de suite gardent la CHAÎNE, pas seulement le précédent", async () => {
  // Le cas qui tranche la question : l'adoptant se trompe de domaine et
  // corrige trois minutes plus tard. Ne garder que le précédent oublierait
  // `exemple.fr` — celui qui reçoit encore tout le trafic, et le seul que
  // le routeur route encore, puisque `faute.fr` n'a jamais obtenu de
  // certificat.
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "faute.fr" })
  figerLHorloge(DEBUT + 3 * 60_000)
  await owner.mutation(api.settings.update, { declaredDomain: "correct.fr" })

  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "correct.fr",
    sortants: ["faute.fr", "exemple.fr"],
  })
})

test("un domaine repris ne figure pas à la fois en courant et en sortant", async () => {
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })
  figerLHorloge(DEBUT + HEURE)
  await owner.mutation(api.settings.update, { declaredDomain: "exemple.fr" })

  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    web: "exemple.fr",
    sortants: ["nouveau.fr"],
  })
})

test("un enregistrement qui ne touche pas au domaine ne note rien", async () => {
  // `/settings/identite` sauvegarde automatiquement à chaque pause de
  // frappe. Si chacune de ces écritures touchait aux sortants, la moindre
  // correction du nom du site en ferait expirer un en avance.
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })
  figerLHorloge(DEBUT + HEURE)
  await owner.mutation(api.settings.update, { siteName: "Un autre nom" })

  const ligne = await t.run((ctx) => ctx.db.query("settings").first())
  expect(ligne?.previousDomains).toEqual([{ host: "exemple.fr", since: DEBUT }])
})

test("un sortant douteux posé DIRECTEMENT en base ne sort jamais", async () => {
  // `settings.update` valide à l'écriture, mais ce n'est pas le seul
  // chemin (migration, `npx convex run`, restauration de sauvegarde), et
  // cette liste décide quel `Host` fait honorer un `x-forwarded-for`.
  const t = makeTestConvex()
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      siteName: "Mon site",
      declaredDomain: "nouveau.fr",
      previousDomains: [
        { host: "exemple.fr`) || Host(`pirate.fr", since: Date.now() },
        { host: "bon.fr", since: Date.now() },
      ],
    }),
  )
  expect(await t.query(api.routing.hotes, { secret: SECRET })).toMatchObject({
    sortants: ["bon.fr"],
  })
})

test("un sortant n'est PAS une origine de lien d'email", async () => {
  // La borne de tout ce mécanisme. Un hôte sortant est reconnu pour deux
  // choses — honorer `x-forwarded-for` (ici), et laisser ENTRER
  // (`auth.ts` `trustedOrigins`, voir `auth.trustedOrigins.test.ts`) —
  // et pour rien d'autre. Le titre de ce test disait « pas une origine de
  // confiance pour l'authentification » ; ce n'est plus vrai depuis que
  // le verrouillage au deuxième changement de domaine est fermé, mais ce
  // qu'il garde vraiment, lui, n'a pas bougé. `settings.environment` rend
  // les deux origines EFFECTIVES — celles des liens d'invitation et de
  // réinitialisation de mot de passe —, et elles ne suivent que le domaine
  // COURANT. Un sortant qui s'y glisserait ferait pointer un lien d'accès
  // vers un domaine qu'on est en train de quitter.
  // L'horloge est figée AVANT la session : sauter cinq mois en avant la
  // ferait expirer, et le test échouerait sur `UNAUTHENTICATED` plutôt que
  // sur ce qu'il garde.
  figerLHorloge(DEBUT)
  const t = makeTestConvex()
  const owner = await seedOwner(t)

  await owner.mutation(api.settings.update, { declaredDomain: "nouveau.fr" })

  const env = await owner.query(api.settings.environment, {})
  expect(env.adminUrl).toBe("https://admin.nouveau.fr")
  expect(env.webUrl).toBe("https://nouveau.fr")
  expect(JSON.stringify(env)).not.toContain("exemple.fr")
})
