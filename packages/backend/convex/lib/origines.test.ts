import { expect, test } from "vitest"
import { deriverOrigines } from "./origines"
import { FENETRE_SORTANTE_MS, MAX_SORTANTS, noterSortie } from "./hotesSortants"

const ENV = { SITE_URL: "http://localhost:3001", WEB_SITE_URL: "http://localhost:4321" }

test("sans domaine déclaré, l'environnement continue de valoir", () => {
  expect(deriverOrigines(null, ENV)).toEqual({
    admin: "http://localhost:3001",
    web: "http://localhost:4321",
    adminSortantes: [],
  })
  // `undefined` est ce que rend la base quand le champ n'a jamais été
  // écrit ; `null` ce que rend la query qui le normalise. Les deux
  // existent réellement, les deux doivent replier.
  expect(deriverOrigines(undefined, ENV)).toEqual(deriverOrigines(null, ENV))
})

test("un domaine déclaré l'emporte sur l'environnement, et entraîne le sous-domaine admin", () => {
  expect(deriverOrigines("exemple.fr", ENV)).toEqual({
    admin: "https://admin.exemple.fr",
    web: "https://exemple.fr",
    adminSortantes: [],
  })
})

test("la casse, les espaces et le point final d'une zone DNS ne changent rien", () => {
  // Un copier-coller depuis une zone donne `Exemple.FR.` — le point final
  // est la forme absolue, légale en DNS. Sans normalisation, l'email
  // pointerait vers `https://admin.Exemple.FR.`, un hôte que Traefik ne
  // route pas.
  expect(deriverOrigines("  Exemple.FR. ", ENV).admin).toBe("https://admin.exemple.fr")
})

test("un domaine invalide en base REPLIE, il ne sort jamais dans un lien", () => {
  // `settings.update` valide à l'écriture, mais ce n'est pas le seul
  // chemin qui écrit dans cette table (migration, `npx convex run`,
  // restauration de sauvegarde). Ce qui compte ici : la valeur douteuse
  // n'apparaît pas dans le résultat, sous aucune forme.
  for (const douteux of [
    "",
    "pas un hôte",
    "https://exemple.fr",
    "exemple.fr:8080",
    "exemple.fr/chemin",
    "*.exemple.fr",
    "exemple.fr evil.fr",
  ]) {
    const origines = deriverOrigines(douteux, ENV)
    expect(origines).toEqual({
      admin: ENV.SITE_URL,
      web: ENV.WEB_SITE_URL,
      adminSortantes: [],
    })
  }
})

test("sans domaine déclaré ET sans variable, l'origine vaut null — jamais une chaîne vide", () => {
  // `""` composerait `/accept-invite?token=…`, un chemin relatif que les
  // appelants prendraient pour une origine valide et qui partirait dans un
  // email. `null` est ce qui les fait lever.
  expect(deriverOrigines(null, {})).toEqual({ admin: null, web: null, adminSortantes: [] })
})

// ── LA SÉQUENCE À TROIS DOMAINES ───────────────────────────────────────
//
// Le défaut ne se voyait pas au premier changement de domaine, et c'est
// pour ça qu'il a tenu : `[baseURL, domaine déclaré]` contient bien
// l'ancienne origine tant que l'ancien domaine est celui de `SITE_URL`.
// Il apparaît au DEUXIÈME, et seulement là.
//
// Les sortants ne sont jamais posés à la main dans ces tests : ils sont
// écrits par `noterSortie`, exactement comme `settings.update` les écrit.
// Poser la liste soi-même testerait la lecture en supposant l'écriture,
// c'est-à-dire en supposant la moitié qui peut manquer.

const HEURE = 60 * 60 * 1000
const T0 = 1_700_000_000_000

/** A, puis B, puis C — et ce que la base retient à chaque étape. */
const CHANGE_VERS_B = T0 + HEURE
const CHANGE_VERS_C = CHANGE_VERS_B + HEURE
const SORTANTS_APRES_B = noterSortie([], "alpha.fr", CHANGE_VERS_B)
const SORTANTS_APRES_C = noterSortie(SORTANTS_APRES_B, "beta.fr", CHANGE_VERS_C)

test("premier changement A → B : l'origine de A reste de confiance", () => {
  const origines = deriverOrigines("beta.fr", {}, SORTANTS_APRES_B, CHANGE_VERS_B + HEURE)
  expect(origines.admin).toBe("https://admin.beta.fr")
  expect(origines.adminSortantes).toEqual(["https://admin.alpha.fr"])
})

test("deuxième changement B → C : l'origine encore ROUTÉE, admin.B, est acceptée", () => {
  // La situation exacte : l'adoptant se trompe de domaine en passant à C.
  // C n'obtient jamais de certificat, donc le routeur GARDE `admin.beta.fr`
  // routé — c'est le comportement voulu, et c'est le seul hôte joignable.
  // Avant cette correction, `trustedOrigins` valait `[admin.alpha.fr,
  // admin.gamma.fr]` : `admin.beta.fr` n'y figurait pas, et le
  // `POST /sign-in/email` qui en venait était refusé en 403
  // `INVALID_ORIGIN` — y compris `/request-password-reset`, donc le
  // chemin de récupération avec le reste.
  const origines = deriverOrigines("gamma.fr", {}, SORTANTS_APRES_C, CHANGE_VERS_C + HEURE)

  expect(origines.adminSortantes).toContain("https://admin.beta.fr")
  // La chaîne, pas seulement le précédent : `admin.alpha.fr` ne survit
  // ici que parce qu'il est SORTANT. Il ne vaut plus `SITE_URL` dès que
  // l'environnement en pose une autre, et c'est le cas ici (`{}`).
  expect(origines.adminSortantes).toEqual(["https://admin.beta.fr", "https://admin.alpha.fr"])
  expect(origines.admin).toBe("https://admin.gamma.fr")
})

test("passé la fenêtre, l'origine sortante n'est plus acceptée", () => {
  // Le pendant, et il compte autant : une origine de confiance qui
  // n'expire jamais est une origine que personne ne revient regarder.
  // La fenêtre est celle de `lib/hotesSortants.ts`, jamais une seconde
  // écrite ici — deux fenêtres pour la même notion divergeraient.
  //
  // Les deux bornes sont écrites EN HEURES, pas seulement en
  // `FENETRE_SORTANTE_MS`. Un test qui ne se repère qu'à la constante se
  // déplace avec elle : élargir la fenêtre à mille fois sa valeur le
  // laisserait vert, alors que c'est exactement le changement qu'il doit
  // signaler. 71 h de confiance, 73 h de refus, c'est la durée elle-même.
  expect(
    deriverOrigines("gamma.fr", {}, SORTANTS_APRES_C, CHANGE_VERS_C + 71 * HEURE)
      .adminSortantes,
  ).toEqual(["https://admin.beta.fr"])
  expect(
    deriverOrigines("gamma.fr", {}, SORTANTS_APRES_C, CHANGE_VERS_C + 73 * HEURE)
      .adminSortantes,
  ).toEqual([])

  // Et la bascule exacte, au millième de seconde près.
  const juste_avant = deriverOrigines(
    "gamma.fr",
    {},
    SORTANTS_APRES_C,
    CHANGE_VERS_C + FENETRE_SORTANTE_MS - 1,
  )
  expect(juste_avant.adminSortantes).toEqual(["https://admin.beta.fr"])

  const juste_apres = deriverOrigines(
    "gamma.fr",
    {},
    SORTANTS_APRES_C,
    CHANGE_VERS_C + FENETRE_SORTANTE_MS,
  )
  expect(juste_apres.adminSortantes).toEqual([])
  expect(juste_apres.admin).toBe("https://admin.gamma.fr")
})

test("un domaine repris (A → B → A) n'est pas rendu deux fois", () => {
  const reprise = noterSortie(SORTANTS_APRES_B, "beta.fr", CHANGE_VERS_C)
  const origines = deriverOrigines("alpha.fr", {}, reprise, CHANGE_VERS_C + HEURE)
  expect(origines.admin).toBe("https://admin.alpha.fr")
  expect(origines.adminSortantes).toEqual(["https://admin.beta.fr"])
})

test("un domaine déclaré douteux n'efface pas les origines sortantes", () => {
  // Le cas où les oublier ferait le plus de mal : le domaine courant
  // replie sur l'environnement, et les hôtes que le routeur route encore
  // sont les sortants. `admin` retombe sur `SITE_URL`, `adminSortantes`
  // reste rendue.
  const origines = deriverOrigines(
    "pas un hôte",
    ENV,
    SORTANTS_APRES_C,
    CHANGE_VERS_C + HEURE,
  )
  expect(origines.admin).toBe(ENV.SITE_URL)
  expect(origines.adminSortantes).toEqual(["https://admin.beta.fr", "https://admin.alpha.fr"])
})

test("un sortant douteux posé DIRECTEMENT en base ne devient jamais une origine", () => {
  // `settings.update` valide à l'écriture, mais ce n'est pas le seul
  // chemin qui écrit dans cette table (migration, `npx convex run`,
  // restauration de sauvegarde), et cette liste-ci décide qui peut poster
  // sur `/sign-in/email`.
  const origines = deriverOrigines(
    "gamma.fr",
    {},
    [
      { host: "beta.fr`) || Host(`pirate.fr", since: CHANGE_VERS_C },
      { host: "https://pirate.fr", since: CHANGE_VERS_C },
      { host: "*.pirate.fr", since: CHANGE_VERS_C },
      { host: "beta.fr", since: CHANGE_VERS_C },
    ],
    CHANGE_VERS_C + HEURE,
  )
  expect(origines.adminSortantes).toEqual(["https://admin.beta.fr"])
})

test("la chaîne des origines sortantes est bornée comme celle des hôtes", () => {
  let liste = noterSortie([], "hote-0.fr", T0)
  for (let i = 1; i < 12; i++) liste = noterSortie(liste, `hote-${i}.fr`, T0 + i * 60_000)
  const origines = deriverOrigines("courant.fr", {}, liste, T0 + 12 * 60_000)
  expect(origines.adminSortantes).toHaveLength(MAX_SORTANTS)
})
