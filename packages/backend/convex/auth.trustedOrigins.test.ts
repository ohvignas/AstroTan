import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import type schema from "./schema"
import { FENETRE_SORTANTE_MS } from "./lib/hotesSortants"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// La preuve en EXÉCUTION du contrôle d'origine, sur la séquence à trois
// domaines — pas sur un cas abstrait.
//
// Ce fichier ne teste pas `deriverOrigines` (c'est le travail de
// `lib/origines.test.ts`) : il fait passer de vraies requêtes HTTP par
// `http.ts` → `authComponent.registerRoutes` → le routeur de better-auth →
// `originCheckMiddleware`, et regarde le code de réponse. C'est la seule
// façon de prouver ce qu'un adoptant enfermé dehors vit réellement, parce
// que le verrou n'est pas dans une mutation qu'on peut appeler : il est
// dans un middleware monté sur `/**` pour tout ce qui n'est pas
// GET/HEAD/OPTIONS.
//
// ── LE TRIPLET QUI FAIT PREUVE ─────────────────────────────────────────
//
// Sur `POST /api/auth/sign-in/email`, avec un mot de passe FAUX :
//
//   401 → la requête a passé le contrôle d'origine et s'est fait refuser
//         par les identifiants. C'est ce qu'on veut d'une origine de
//         confiance : elle laisse ENTRER, elle n'accorde rien.
//   403 `INVALID_ORIGIN` → refusée avant même de regarder les
//         identifiants. C'est l'enfermement.
//
// Deux détails de better-auth 1.6.17 rendent ce triplet lisible, et les
// deux sont vérifiés dans `dist/` plutôt que supposés :
//
//   - `signInEmail` monte `formCsrfMiddleware`
//     (`dist/api/routes/sign-in.mjs`), qui appelle `validateOrigin(ctx,
//     true)` dès qu'un en-tête `origin` est présent — donc l'origine est
//     contrôlée même sans cookie de session, ce qui est exactement le cas
//     de quelqu'un qui n'est plus connecté.
//   - `originCheckMiddleware` est monté sur `/**` (`dist/api/index.mjs`)
//     et rend la main immédiatement sur GET/HEAD/OPTIONS. C'est pour ça
//     qu'une session DÉJÀ ouverte survit au verrouillage : `/convex/token`
//     est un GET. Le verrou ne se referme que sur celui qui doit revenir.

const SECRET = "test-secret-please-do-not-use-in-prod-x"

// A, B, C. `A` n'est pas un domaine déclaré : c'est `WEB_DOMAIN`, l'hôte
// EFFECTIF d'un déploiement neuf, et `settings.update` le note comme
// sortant à la première déclaration (voir `sortantsApresChangement`). La
// séquence est donc celle du rapport, sans rien fabriquer à la main.
const A = "alpha.fr"
const B = "beta.fr"
const C = "gamma.fr"

const HEURE = 60 * 60 * 1000
const T0 = 1_700_000_000_000
const CHANGE_VERS_B = T0 + HEURE
const CHANGE_VERS_C = CHANGE_VERS_B + HEURE

const MOT_DE_PASSE = "correct horse battery staple origines"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = SECRET
  // `SITE_URL` est l'origine du PREMIER domaine, celle que better-auth
  // pousse depuis `baseURL`. Elle vaut ici l'origine locale de test, donc
  // AUCUN des trois domaines : c'est ce qui empêche `admin.alpha.fr` de
  // passer « par coïncidence », qui est précisément ce qui masquait le
  // défaut sur un vrai déploiement.
  process.env.SITE_URL = ORIGIN
  process.env.WEB_DOMAIN = A
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
})

/** Seul `Date` est simulé — simuler les minuteries ferait pendre `convex-test`. */
function figerLHorloge(instant: number) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(instant)
}

async function seedOwner(t: TestConvex<typeof schema>) {
  const email = `origines-owner-${Date.now()}-${Math.random()}@example.com`
  const user = await seedUser(t, {
    email,
    password: MOT_DE_PASSE,
    name: "Owner",
    role: "owner",
  })
  await signIn(t, email, MOT_DE_PASSE)
  return { identite: await identityFor(t, user.id), email }
}

/**
 * Une tentative de connexion depuis une origine donnée, avec un mot de
 * passe FAUX.
 *
 * Faux exprès : un mot de passe juste rendrait 200 pour les origines de
 * confiance, et 200 ne distingue pas « l'origine est passée » de « la
 * session existait déjà ». 401 ne peut venir que d'un chemin qui a
 * dépassé le contrôle d'origine.
 *
 * `x-forwarded-for` distinct à chaque appel : la limitation de débit de
 * `lib/signInRateLimit.ts` est de cinq tentatives par IP et par deux
 * minutes, et un 429 rendrait ce fichier illisible — il ne dirait rien de
 * l'origine.
 */
let compteur = 0
async function tenterConnexion(t: TestConvex<typeof schema>, email: string, origin: string) {
  compteur += 1
  return t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": `203.0.113.${compteur % 250}`,
    },
    body: JSON.stringify({ email, password: "ce n'est pas le bon mot de passe" }),
  })
}

async function codeErreur(res: Response) {
  const body = (await res.clone().json()) as { code?: string }
  return body.code
}

/**
 * Rejoue A → B → C par la VRAIE mutation, et rend de quoi interroger
 * l'API.
 *
 * `settings.update` est le seul chemin qui note un sortant. Poser
 * `previousDomains` à la main ici testerait la lecture en supposant
 * l'écriture — la même raison qu'en tête de `routing.test.ts`.
 */
async function jusquAuDeuxiemeChangement() {
  figerLHorloge(T0)
  const t = makeTestConvex()
  const { identite, email } = await seedOwner(t)

  figerLHorloge(CHANGE_VERS_B)
  await identite.mutation(api.settings.update, { declaredDomain: B })

  figerLHorloge(CHANGE_VERS_C)
  await identite.mutation(api.settings.update, { declaredDomain: C })

  // La séquence est bien celle qu'on croit : deux sortants, le plus
  // récent d'abord. Vérifié ici plutôt que supposé, sinon un test qui
  // n'aurait jamais changé de domaine passerait pour la mauvaise raison.
  const ligne = await t.run((ctx) => ctx.db.query("settings").first())
  expect(ligne?.declaredDomain).toBe(C)
  expect(ligne?.previousDomains).toEqual([
    { host: B, since: CHANGE_VERS_C },
    { host: A, since: CHANGE_VERS_B },
  ])

  return { t, email }
}

test("le triplet, au deuxième changement de domaine", async () => {
  const { t, email } = await jusquAuDeuxiemeChangement()
  figerLHorloge(CHANGE_VERS_C + HEURE)

  // 1. Le domaine COURANT. C n'a ni DNS ni certificat dans le scénario,
  //    mais son origine reste de confiance — c'est la moitié qui marchait
  //    déjà.
  const courant = await tenterConnexion(t, email, `https://admin.${C}`)
  expect(courant.status).toBe(401)

  // 2. Le domaine SORTANT, `admin.beta.fr` — le seul hôte que le routeur
  //    route encore, puisque C n'a jamais servi de certificat valide.
  //    C'est LE test qui compte : avant la correction, cette ligne
  //    rendait 403 `INVALID_ORIGIN`, et l'adoptant n'avait plus aucune
  //    entrée.
  const sortant = await tenterConnexion(t, email, `https://admin.${B}`)
  expect(sortant.status).toBe(401)
  expect(await codeErreur(sortant)).not.toBe("INVALID_ORIGIN")

  // 3. Une origine étrangère. La confiance accordée aux sortants est une
  //    liste, jamais un joker : ce qui n'y est pas est toujours refusé.
  const etranger = await tenterConnexion(t, email, "https://admin.pirate.fr")
  expect(etranger.status).toBe(403)
  expect(await codeErreur(etranger)).toBe("INVALID_ORIGIN")
})

test("l'origine d'origine, A, reste acceptée elle aussi — et pas par coïncidence", async () => {
  // `admin.alpha.fr` ne vaut PAS `SITE_URL` ici (elle vaut l'origine
  // locale de test), donc elle ne peut survivre que comme sortante. Sur un
  // vrai déploiement, c'est l'inverse qui masquait le défaut : A survivait
  // parce qu'elle se trouvait être `baseURL`, ce qui faisait croire que le
  // mécanisme fonctionnait alors qu'il ne gardait que le premier domaine.
  const { t, email } = await jusquAuDeuxiemeChangement()
  figerLHorloge(CHANGE_VERS_C + HEURE)

  const res = await tenterConnexion(t, email, `https://admin.${A}`)
  expect(res.status).toBe(401)
})

// CE TEST ASSERT UN ARBITRAGE, PAS UNE PROPRIÉTÉ SOUHAITABLE — et il faut
// que quiconque touche à `FENETRE_SORTANTE_MS` sache ce qu'il échange.
//
// Le scénario du fichier est celui où C n'obtient JAMAIS son certificat :
// le routeur garde donc `admin.B` routé indéfiniment (`sertUnCertificatValide`
// ne rendra jamais `true`), pendant qu'ici il cesse d'être de confiance au
// bout de trois jours. Le seul hôte encore joignable devient le seul depuis
// lequel on ne peut plus entrer : c'est la faille critique 2, différée de
// trois jours, et c'est le prix payé pour qu'un domaine revendu ne reste pas
// reconnu pour toujours. L'asymétrie entre cette fenêtre-ci et celle du
// routeur, l'issue manuelle qu'il reste avant T+72 h, et les trois voies
// examinées pour faire mieux : `lib/hotesSortants.ts`, au-dessus de
// `FENETRE_SORTANTE_MS`.
test("passé la fenêtre, l'origine sortante est de nouveau refusée", async () => {
  const { t, email } = await jusquAuDeuxiemeChangement()
  figerLHorloge(CHANGE_VERS_C + FENETRE_SORTANTE_MS + HEURE)

  const res = await tenterConnexion(t, email, `https://admin.${B}`)
  expect(res.status).toBe(403)
  expect(await codeErreur(res)).toBe("INVALID_ORIGIN")

  // Le domaine courant, lui, n'a pas de fenêtre : il reste de confiance
  // tant qu'il est déclaré.
  const courant = await tenterConnexion(t, email, `https://admin.${C}`)
  expect(courant.status).toBe(401)
})

test("l'issue manuelle se referme avec la fenêtre, elle ne lui survit pas", async () => {
  // L'issue que la relecture a établie : avant T+72 h, le lien reçu par
  // email pointe vers `admin.C` — mort —, mais le JETON qu'il porte n'est
  // lié à aucune origine, et recopié sur `admin.B` il fonctionne, parce
  // que le `POST` part alors d'une origine sortante de confiance. C'est ce
  // qui fait la différence entre « à moitié rouvert » et « fermé ».
  //
  // Ce test tient l'autre moitié de cette phrase, la seule qui puisse se
  // périmer en silence : l'issue vit DANS la fenêtre. À T+72 h l'origine
  // du `POST` cesse d'être de confiance, et le chemin de récupération se
  // ferme avec elle. Écrire l'issue sans écrire sa borne serait laisser un
  // commentaire rassurant sur une porte close.
  //
  // Les deux instants se repèrent à `FENETRE_SORTANTE_MS`, donc ce test
  // tient la FORME (avant : ouvert ; après : fermé) et non la DURÉE — il
  // resterait vert si quelqu'un multipliait la fenêtre par mille. C'est
  // `lib/origines.test.ts` qui tient les 72 heures elles-mêmes, en heures
  // écrites, et c'est là qu'il faut ajouter si la valeur doit être
  // défendue plus fort.
  const { t } = await jusquAuDeuxiemeChangement()
  const demander = (origin: string) =>
    t.fetch("/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: "better-auth.dummy=1",
      },
      body: JSON.stringify({ newPassword: "correct horse battery staple", token: "peu-importe" }),
    })

  // Dans la fenêtre : le contrôle d'origine laisse passer. Ce qui refuse
  // ensuite est le jeton, pas l'origine — et c'est bien le point.
  figerLHorloge(CHANGE_VERS_C + HEURE)
  expect(await codeErreur(await demander(`https://admin.${B}`))).not.toBe("INVALID_ORIGIN")

  // Passé la fenêtre : la même requête, le même hôte, toujours le seul
  // routé — et le contrôle d'origine la refuse.
  figerLHorloge(CHANGE_VERS_C + FENETRE_SORTANTE_MS + HEURE)
  const apres = await demander(`https://admin.${B}`)
  expect(apres.status).toBe(403)
  expect(await codeErreur(apres)).toBe("INVALID_ORIGIN")
})

test("le chemin de RÉCUPÉRATION rouvre avec le reste", async () => {
  // `/request-password-reset` ne rend jamais autre chose que 200 quand il
  // aboutit — pas d'oracle sur l'existence du compte. Ce qu'on mesure est
  // donc « 403 ou pas ». Un cookie est envoyé parce que
  // `originCheckMiddleware` ne contrôle l'origine que sur une requête qui
  // en porte un (`validateOrigin`, `useCookies`) ; c'est le cas d'un
  // navigateur qui a déjà visité le dashboard, et c'est le seul cas où ce
  // chemin se refermait.
  const { t } = await jusquAuDeuxiemeChangement()
  figerLHorloge(CHANGE_VERS_C + HEURE)

  const demander = (origin: string) =>
    t.fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: "better-auth.dummy=1",
      },
      body: JSON.stringify({ email: "personne@example.com" }),
    })

  const sortant = await demander(`https://admin.${B}`)
  expect(sortant.status).toBe(200)

  const etranger = await demander("https://admin.pirate.fr")
  expect(etranger.status).toBe(403)
  expect(await codeErreur(etranger)).toBe("INVALID_ORIGIN")
})

test("sans aucun changement de domaine, rien n'est ajouté à la liste", async () => {
  // Le cas de très loin le plus fréquent : aucun sortant, donc aucune
  // origine de plus. Une correction qui élargirait la confiance en régime
  // normal serait une correction ratée.
  figerLHorloge(T0)
  const t = makeTestConvex()
  const { identite, email } = await seedOwner(t)
  await identite.mutation(api.settings.update, { declaredDomain: C })

  figerLHorloge(T0 + HEURE)
  // `alpha.fr` est le `WEB_DOMAIN` sortant de CE déploiement-ci : il est
  // légitimement accepté. `beta.fr` n'a jamais existé ici.
  const jamaisVu = await tenterConnexion(t, email, `https://admin.${B}`)
  expect(jamaisVu.status).toBe(403)
  expect(await codeErreur(jamaisVu)).toBe("INVALID_ORIGIN")
})
