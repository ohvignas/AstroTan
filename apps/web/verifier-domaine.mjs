// @ts-check
// apps/web/verifier-domaine.mjs — le point d'entrée RÉEL du conteneur `web`.
//
// Il fait UNE chose avant de passer la main au serveur Astro : vérifier que
// le domaine figé dans le build est celui que le conteneur sert au runtime.
// S'ils divergent, il refuse de démarrer.
//
// ── LE DÉFAUT QU'IL FERME ──────────────────────────────────────────────
//
// `WEB_DOMAIN` vit des deux côtés d'une frontière que rien ne traverse :
//
//   · AU BUILD  — `apps/web/astro.config.ts` la lit pour composer
//     `security.allowedDomains`. La valeur est figée dans `dist/`, comme
//     une `PUBLIC_*` ; la poser dans le `.env` du VPS ne ferait rien.
//   · AU RUNTIME — le label ``Host(`${WEB_DOMAIN}`)`` de
//     `docker/docker-compose.yml` dit à Traefik quel hôte router vers ce
//     conteneur. Cette valeur-là est relue à chaque `compose up`.
//
// Changer la seconde sans reconstruire l'image, c'est servir un hôte que le
// build n'a jamais appris. Astro ne valide alors plus l'hôte de la requête,
// donc n'honore plus `x-forwarded-for`, donc `clientAddress` retombe sur
// `req.socket.remoteAddress` — l'adresse du conteneur Traefik, LA MÊME pour
// tout Internet. Les deux limiteurs de débit du site (`/api/contact`,
// `/api/consent`) se retrouvent avec un seul seau pour tous les visiteurs :
// cinq messages de contact par heure pour la planète, puis `RATE_LIMITED`
// pour tout le monde. Le raisonnement complet est dans
// `src/lib/allowedDomains.ts`.
//
// Rien ne le signale. Mesuré, pas supposé : avec un `Host:` non appris au
// build et un `X-Forwarded-For` valide, `/api/consent` répond 204 comme
// d'habitude, et l'empreinte qu'il enregistre est celle de la socket au
// lieu de celle du visiteur. Les deux moitiés ont l'air debout.
//
// `scripts/bootstrap.mjs` écrit bien les deux depuis une seule lecture, donc
// l'amorçage ne peut pas diverger. C'est la MODIFICATION ULTÉRIEURE d'un
// seul côté qui le peut — et c'est celle-là qui est silencieuse.
//
// ── POURQUOI AU DÉMARRAGE, ET PAS À LA PREMIÈRE REQUÊTE ────────────────
//
// C'est un choix, et il tient en une phrase : un refus au démarrage tombe
// PENDANT LE DÉPLOIEMENT, où quelqu'un regarde et où le rollback existe
// (`docker/README.md`) ; un refus à la requête tomberait dans le trafic de
// production, sur des visiteurs, sans personne devant l'écran.
//
// Conséquence à assumer : ce fichier ne vérifie RIEN une fois le serveur
// lancé. Il ne peut donc pas faire tomber un site en cours de service —
// c'est délibéré, et une vérification par requête serait la version
// dangereuse de la même idée.
//
// Le conteneur redémarre en boucle (`restart: unless-stopped`), et son
// healthcheck ne passe jamais : `compose up -d` rend la main sur un service
// qui ne devient pas sain, et `docker compose logs web` porte le message
// ci-dessous. C'est bruyant, à l'endroit et au moment voulus.

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** Le nom du fichier écrit par l'intégration d'`astro.config.ts`. */
export const NOM_ARTEFACT = "domaine-du-build.json"

/**
 * Le domaine, réduit à la forme sous laquelle `domainesAutorises` le
 * compare — minuscules, sans espaces de bordure.
 *
 * C'est une SECONDE écriture de la normalisation de
 * `src/lib/allowedDomains.ts`, et une seconde écriture d'une même règle est
 * exactement le défaut que ce fichier existe pour fermer. Deux raisons de
 * l'accepter ici, et un garde-fou :
 *
 *   · ce module est chargé par `node` seul, dans le conteneur, sans
 *     bundler : il ne peut pas importer un `.ts` ;
 *   · la règle est minuscule, et l'autre moitié — la validation d'un hôte
 *     nu — n'a rien à faire ici : elle a déjà refusé le build.
 *
 * Le garde-fou est un test, pas un commentaire :
 * `src/lib/verifierDomaine.test.ts` exige que cette fonction rende le même
 * hôte que `domainesAutorises` pour le même argument. Les deux écritures ne
 * peuvent donc pas diverger sans faire rougir la suite.
 *
 * @param {string | undefined} valeur
 * @returns {string} l'hôte normalisé, ou `""` si la variable est absente.
 */
export function normaliserDomaine(valeur) {
  return (valeur ?? "").trim().toLowerCase()
}

/**
 * Le motif du refus de démarrer, ou `null` pour laisser partir le serveur.
 *
 * @param {{ hotesDuBuild: string[], domaineDuRuntime: string | undefined }} args
 * @returns {string | null}
 */
export function comparerDomaines({ hotesDuBuild, domaineDuRuntime }) {
  const runtime = normaliserDomaine(domaineDuRuntime)
  const build = hotesDuBuild.map((h) => normaliserDomaine(h)).filter((h) => h.length > 0)

  if (build.length === 0) {
    // Inatteignable par le chemin normal : `docker/web.Dockerfile` refuse
    // de construire l'image sans `WEB_DOMAIN`. Y arriver signifie qu'autre
    // chose a cédé — et démarrer quand même redonnerait la panne muette.
    return (
      `Le build n'a appris AUCUN hôte : \`security.allowedDomains\` est vide dans l'image.\n` +
      `Astro ignorera \`x-forwarded-for\` et \`clientAddress\` vaudra l'adresse de Traefik — ` +
      `la même pour tous les visiteurs.\n` +
      `Reconstruire l'image avec le build-arg WEB_DOMAIN (docker/web.Dockerfile).`
    )
  }

  if (runtime.length === 0) {
    return (
      `WEB_DOMAIN est absente de l'environnement du conteneur, alors que le build a figé ` +
      `${build.join(", ")}.\n` +
      `La poser dans \`services.web.environment\` (docker/docker-compose.yml) — c'est la ` +
      `moitié runtime de la variable, celle que Traefik utilise déjà pour router.`
    )
  }

  if (build.length === 1 && build[0] === runtime) return null
  if (build.length > 1 && build.includes(runtime)) return null

  return (
    `WEB_DOMAIN a divergé entre le build et le runtime.\n` +
    `  figé dans l'image (security.allowedDomains) : ${build.join(", ")}\n` +
    `  servi par ce conteneur (WEB_DOMAIN)         : ${runtime}\n` +
    `Astro ne reconnaîtra pas l'hôte des requêtes, ignorera \`x-forwarded-for\`, et ` +
    `\`clientAddress\` vaudra l'adresse de Traefik — la MÊME pour tout Internet. Les deux ` +
    `limiteurs de débit du site (/api/contact, /api/consent) partageraient alors un seul ` +
    `seau, sans qu'aucun symptôme ne le dise (voir src/lib/allowedDomains.ts).\n` +
    `Corriger : reconstruire l'image avec le build-arg WEB_DOMAIN=${runtime}, ou remettre ` +
    `WEB_DOMAIN=${build[0]} dans le \`.env\` du VPS. Les deux moitiés, jamais une seule.`
  )
}

/**
 * Les hôtes que le build a figés, lus dans l'artefact que
 * `astro.config.ts` écrit à la fin de `astro build`.
 *
 * Cet artefact — et non une seconde lecture de `WEB_DOMAIN` au build — est
 * la seule source qui ne PUISSE PAS mentir : il est écrit à partir de la
 * même valeur JavaScript que celle passée à `security.allowedDomains`.
 *
 * @param {URL} url
 * @returns {string[]}
 */
export function lireHotesDuBuild(url) {
  const brut = JSON.parse(readFileSync(url, "utf8"))
  const domaines = brut?.allowedDomains
  if (!Array.isArray(domaines)) {
    throw new Error(`\`allowedDomains\` absent ou mal formé dans ${url.pathname}`)
  }
  return domaines.map((/** @type {{ hostname?: string }} */ motif) => motif?.hostname ?? "")
}

/* c8 ignore start — le corps du point d'entrée, exercé par le conteneur. */
async function demarrer() {
  const racine = new URL("./", import.meta.url)
  let hotesDuBuild
  try {
    hotesDuBuild = lireHotesDuBuild(new URL(`dist/${NOM_ARTEFACT}`, racine))
  } catch (erreur) {
    // Artefact illisible = garde-fou hors service. Démarrer quand même
    // serait rétablir en silence l'état d'avant ce fichier.
    refuser(
      `L'artefact du build (dist/${NOM_ARTEFACT}) est illisible : ${String(erreur)}\n` +
        `Il est écrit par l'intégration \`astrotan:domaine-du-build\` d'apps/web/astro.config.ts ` +
        `à la fin de \`astro build\`. Son absence signifie que l'image n'a pas été construite ` +
        `par ce pipeline — le domaine figé dans le bundle est alors invérifiable.`,
    )
    return
  }

  const refus = comparerDomaines({
    hotesDuBuild,
    domaineDuRuntime: process.env.WEB_DOMAIN,
  })
  if (refus !== null) {
    refuser(refus)
    return
  }

  // Le serveur Astro, importé — et non relancé dans un second processus :
  // ce module reste PID 1, donc Docker continue de lui adresser SIGTERM
  // directement et l'arrêt reste propre.
  await import("./dist/server/entry.mjs")
}

/**
 * @param {string} message
 * @returns {void}
 */
function refuser(message) {
  process.stderr.write(
    `\n[astrotan] REFUS DE DÉMARRER — apps/web/verifier-domaine.mjs\n\n${message}\n\n`,
  )
  process.exitCode = 1
}

// Seulement quand ce fichier EST le point d'entrée : les tests l'importent
// pour ses fonctions pures, et ne doivent pas démarrer de serveur.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await demarrer()
}
/* c8 ignore stop */
