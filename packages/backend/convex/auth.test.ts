import { afterEach, beforeEach, expect, test } from "vitest"
import { createAuth, createAuthOptions } from "./auth"
import { FENETRE_SORTANTE_MS, noterSortie, type HoteSortant } from "./lib/hotesSortants"

// `createAuth`'s ctx is only used to build a lazy Convex database adapter
// (see createAuthOptions's `authComponent.adapter(ctx)`), which doesn't
// touch ctx synchronously beyond a duck-type check — `{} as any` is exactly
// what convex/betterAuth/auth.ts itself passes for the same reason.
const fakeCtx = {} as any

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
})

afterEach(() => {
  process.env = originalEnv
})

test("createAuth throws when BETTER_AUTH_SECRET is unset", () => {
  delete process.env.BETTER_AUTH_SECRET
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET is not set on this Convex deployment",
  )
})

test("createAuth throws when BETTER_AUTH_SECRET equals the library's public default", () => {
  process.env.BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890"
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET is set to Better Auth's public default",
  )
})

test("createAuth throws when BETTER_AUTH_SECRET is shorter than 32 characters", () => {
  process.env.BETTER_AUTH_SECRET = "short-secret-not-32-chars"
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET must be at least 32 characters",
  )
})

test("createAuth does not throw when requireSecret is false, even with no env vars set", () => {
  delete process.env.BETTER_AUTH_SECRET
  delete process.env.SITE_URL

  expect(() => createAuth(fakeCtx, { requireSecret: false })).not.toThrow()
})

// I3 (Lot 1 final review): the SITE_URL guard was untested on its own — a
// suite exercising only the three BETTER_AUTH_SECRET cases above plus one
// `requireSecret: false` case never actually runs the code path where the
// secret is fine but SITE_URL specifically is missing. Deleting the guard
// (or reordering it ahead of the secret checks) left 175/175 green before
// this test existed.
test("createAuth throws when SITE_URL is unset, even with a valid secret", () => {
  process.env.BETTER_AUTH_SECRET = "a-genuinely-long-enough-secret-value-1234"
  delete process.env.SITE_URL

  expect(() => createAuth(fakeCtx)).toThrow("SITE_URL is not set on this Convex deployment")
})

// --- `trustedOrigins` : ce qui empêche le verrouillage --------------------
//
// Ce qu'on a ÉTABLI avant d'écrire, et qui décide de la forme : `baseURL`
// ne peut pas venir de la base. Le contrat du composant est synchrone —
// `CreateAuth = (ctx) => A` (@convex-dev/better-auth 0.12.5,
// `dist/utils/index.d.ts`), et `http.ts` passe `createAuth` tel quel à
// `registerRoutes` — tandis que `betterAuth/auth.ts` appelle
// `createAuth({} as any)` au CHARGEMENT DU MODULE, sans base ni `await`.
//
// `trustedOrigins`, si : better-auth l'accepte en fonction asynchrone et la
// rappelle à chaque requête (`dist/auth/base.mjs`). C'est le seul point de
// ces options où une lecture de la base est possible — et c'est ce qui fait
// suivre l'origine du dashboard quand le domaine change. Faux, il fait
// REFUSER des requêtes légitimes : le dashboard entier devient
// inutilisable, et personne ne revient en arrière sans SSH.

/**
 * Le `ctx` d'une action : `runQuery` est ce que la fonction cherche.
 *
 * Rend la forme de `settings.domaineEtSortants` — les DEUX champs de la
 * même ligne, en une lecture. C'est le point de coût de ce bloc : better
 * -auth rappelle `trustedOrigins` à chaque requête d'authentification et
 * rien n'y est mis en cache (un cache périmé sur cette liste EST le
 * verrouillage), donc une seconde query pour les sortants doublerait la
 * charge de chaque connexion.
 */
function ctxAvecDomaine(
  declare: string | null | (() => never),
  sortants: HoteSortant[] | null = null,
) {
  return {
    runQuery: async () =>
      typeof declare === "function" ? declare() : { declare, sortants },
  } as any
}

async function originesDeConfiance(ctx: any): Promise<unknown> {
  const option = createAuthOptions(ctx).trustedOrigins
  if (typeof option !== "function") throw new Error("trustedOrigins n'est pas une fonction")
  return await option()
}

test("trustedOrigins ajoute l'origine du domaine déclaré", async () => {
  expect(await originesDeConfiance(ctxAvecDomaine("exemple.fr"))).toEqual([
    "https://admin.exemple.fr",
  ])
})

test("sans domaine déclaré, trustedOrigins n'ajoute rien — baseURL suffit", async () => {
  // Vide, et non `[SITE_URL]` : better-auth pousse déjà
  // `new URL(baseURL).origin` dans la liste
  // (`dist/context/helpers.mjs`). Repousser la même valeur ici
  // n'ajouterait qu'un doublon, et masquerait le jour où `baseURL`
  // cesserait d'être posée.
  process.env.SITE_URL = "http://localhost:3001"
  expect(await originesDeConfiance(ctxAvecDomaine(null))).toEqual([])
})

test("un domaine invalide en base n'entre JAMAIS dans trustedOrigins", async () => {
  // Cette liste décide qui a le droit de parler à l'authentification.
  // Une valeur douteuse arrivée par une migration ou une restauration de
  // sauvegarde ne doit pas y ouvrir une porte.
  expect(await originesDeConfiance(ctxAvecDomaine("exemple.fr evil.fr"))).toEqual([])
})

test("une base injoignable ne fait PAS échouer trustedOrigins", async () => {
  // La propriété la plus importante de ce bloc : better-auth rappelle
  // cette fonction à chaque requête d'authentification. Une exception ici
  // les casserait TOUTES, y compris celles qui n'ont rien à voir avec le
  // domaine — une panne de lecture deviendrait une panne de connexion.
  // `[]` fait retomber la liste sur `baseURL` seule, c'est-à-dire sur le
  // comportement d'avant ce changement.
  const ctx = ctxAvecDomaine(() => {
    throw new Error("base injoignable")
  })
  await expect(originesDeConfiance(ctx)).resolves.toEqual([])
})

test("un ctx sans runQuery ne fait pas échouer trustedOrigins", async () => {
  // `betterAuth/auth.ts` construit l'instance d'introspection avec
  // `{} as any` au chargement du module, dans l'environnement isolé du
  // composant. Il n'y a là ni base ni `runQuery` — et le déploiement
  // entier tombe si ce chemin lève.
  await expect(originesDeConfiance({} as any)).resolves.toEqual([])
})

// --- Les origines SORTANTES : le deuxième changement de domaine ----------
//
// Les quatre tests ci-dessus passaient déjà AVANT que les sortants
// existent, et c'est justement ce qui rendait le défaut invisible : ils
// n'exercent qu'UN changement de domaine, le seul cas où `baseURL` garde
// l'ancienne origine par coïncidence. Ceux-ci exercent le deuxième.

const HEURE = 60 * 60 * 1000

/** A → B → C, écrit par `noterSortie` comme `settings.update` l'écrit. */
function apresDeuxChangements(maintenant: number = Date.now()) {
  const apresB = noterSortie([], "alpha.fr", maintenant - 2 * HEURE)
  return noterSortie(apresB, "beta.fr", maintenant - HEURE)
}

test("trustedOrigins garde l'origine encore ROUTÉE au deuxième changement", async () => {
  // `gamma.fr` est la faute de frappe : il n'obtient jamais de certificat,
  // donc le routeur garde `admin.beta.fr` routé, et c'est le seul hôte
  // joignable. Sans les sortants, la liste valait `[admin.gamma.fr]` et
  // tout `POST` venu de `https://admin.beta.fr` était refusé en 403
  // `INVALID_ORIGIN` — connexion comme réinitialisation de mot de passe.
  const ctx = ctxAvecDomaine("gamma.fr", apresDeuxChangements())
  expect(await originesDeConfiance(ctx)).toEqual([
    "https://admin.gamma.fr",
    "https://admin.beta.fr",
    "https://admin.alpha.fr",
  ])
})

test("passé la fenêtre, une origine sortante quitte la liste", async () => {
  // Le pendant. La fenêtre est celle de `lib/hotesSortants.ts` — jamais
  // une seconde écrite ici, sous peine de voir les deux diverger.
  const vieux = apresDeuxChangements(Date.now() - FENETRE_SORTANTE_MS)
  expect(await originesDeConfiance(ctxAvecDomaine("gamma.fr", vieux))).toEqual([
    "https://admin.gamma.fr",
  ])
})

test("un sortant douteux n'entre pas plus dans la liste qu'un domaine douteux", async () => {
  const ctx = ctxAvecDomaine("gamma.fr", [
    { host: "beta.fr`) || Host(`pirate.fr", since: Date.now() },
    { host: "*.pirate.fr", since: Date.now() },
  ])
  expect(await originesDeConfiance(ctx)).toEqual(["https://admin.gamma.fr"])
})

test("sans domaine déclaré, les sortants restent rendus", async () => {
  // Le domaine déclaré effacé (ou douteux) fait replier `admin` sur
  // `SITE_URL`, que better-auth pousse déjà depuis `baseURL` — d'où la
  // liste qui ne contient QUE les sortants. Les oublier ici rouvrirait le
  // verrouillage précisément quand la ligne `settings` est en mauvais
  // état.
  process.env.SITE_URL = "http://localhost:3001"
  expect(await originesDeConfiance(ctxAvecDomaine(null, apresDeuxChangements()))).toEqual([
    "https://admin.beta.fr",
    "https://admin.alpha.fr",
  ])
})

test("une base injoignable ne fait toujours pas échouer trustedOrigins", async () => {
  // Répété après l'ajout des sortants : la lecture rend maintenant un
  // objet, et un `try` mal placé aurait pu laisser passer un
  // `TypeError` de déstructuration plutôt que de retomber sur `[]`.
  const ctx = {
    runQuery: async () => {
      throw new Error("base injoignable")
    },
  } as any
  await expect(originesDeConfiance(ctx)).resolves.toEqual([])
})
