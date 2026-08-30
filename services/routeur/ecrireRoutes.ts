import { estHoteNu } from "@astrotan/backend/convex/lib/hoteNu"
import type { Hotes } from "@astrotan/backend/convex/routing"

// La configuration dynamique de Traefik, composée à partir des hôtes.
//
// POURQUOI CETTE FONCTION EST PURE
//
// Elle prend des hôtes et rend du texte. Rien d'autre : ni lecture, ni
// écriture, ni horloge, ni réseau. C'est ce qui rend testable la partie où
// une erreur coûte le plus cher — un fichier mal composé ne fait pas
// tomber le site avec un message, il le fait disparaître du routage sans
// en produire aucun.
//
// CE QUE CE FICHIER REMPLACE
//
// Les labels `traefik.http.routers.{web,admin,umami}.rule` de
// `docker/docker-compose.yml`. Un label ne change qu'en RECRÉANT le
// conteneur ; un fichier surveillé par le provider fichier est relu à
// chaud. C'est toute la fonctionnalité : changer de domaine depuis
// l'administration, sans SSH et sans reconstruction d'image.
//
// CE QU'IL NE REMPLACE PAS, ET POURQUOI
//
// Les SERVICES restent déclarés par les labels Docker
// (`traefik.http.services.web.loadbalancer.server.port`). C'est là que vit
// le port du conteneur, à côté du conteneur qui l'ouvre, et le provider
// fichier n'a aucun moyen de le connaître. Un routeur du provider fichier
// qui vise un service du provider Docker doit donc le nommer AVEC son
// fournisseur — `web@docker`. Sans le suffixe, Traefik cherche `web@file`,
// ne le trouve pas, et la route ne sert rien : une panne muette, sans
// erreur de syntaxe pour la signaler.

/** Le résolveur ACME, tel qu'il est nommé dans `docker-compose.yml`. */
const RESOLVEUR = "letsencrypt"

/**
 * L'entrypoint TLS, et lui seul.
 *
 * `web` (:80) ne fait que rediriger vers celui-ci
 * (`TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_*`). Un routeur qui
 * l'écouterait servirait le site en clair.
 */
const ENTRYPOINT = "websecure"

/** Les trois services, dans l'ordre où ils sont écrits. */
const SERVICES = ["web", "admin", "umami"] as const
export type Service = (typeof SERVICES)[number]

/**
 * Les préfixes de sous-domaine que la convention du dépôt attribue à
 * chaque service — ceux que `routing.hotes` produit quand un domaine est
 * déclaré, et ceux que `docker/.env.example` donne en exemple.
 */
const PREFIXE_CONVENTION: Record<Exclude<Service, "web">, string> = {
  admin: "admin",
  umami: "stats",
}

/** L'étiquette DNS la plus à gauche : `admin` pour `admin.exemple.fr`. */
function premiereEtiquette(hote: string): string {
  return hote.slice(0, hote.indexOf("."))
}

/**
 * Refuse tout ce qui n'est pas un hôte nu.
 *
 * DÉFENSE EN PROFONDEUR, et pas redondance. `routing.hotes` valide déjà ce
 * qu'elle rend, avec la même règle (`estHoteNu`, importée et non recopiée,
 * pour que les deux barrières refusent exactement la même chose). Celle-ci
 * est la dernière avant le texte : une chaîne arbitraire qui atteindrait ce
 * YAML y injecterait ce qu'elle veut — un ``Host(`pirate.fr`)`` de plus
 * dans la règle, ou un `service:` détourné vers un conteneur qui n'est pas
 * le nôtre.
 *
 * Elle lève au lieu de composer. Un YAML douteux serait chargé par Traefik
 * comme n'importe quel autre : il n'y a pas d'étape ultérieure qui
 * s'apercevrait de quoi que ce soit.
 */
function exigerHoteNu(hote: string, ou: string): string {
  if (!estHoteNu(hote)) {
    // L'hôte est cité : ce refus est lu par l'opérateur dans les journaux
    // du service, pas répondu à un inconnu. Le taire ferait chercher
    // longtemps quelle des cinq valeurs est en cause.
    throw new Error(
      `Hôte refusé pour ${ou} : ${JSON.stringify(hote)}. ` +
        `Un hôte de routage est un hôte NU — ni schéma, ni port, ni chemin, ni joker.`,
    )
  }
  return hote
}

/**
 * À quel service appartient un ANCIEN hôte.
 *
 * Le problème : `ancien` est une liste plate de noms, et rien dedans ne dit
 * lequel servait l'administration. Le garder routé vers le mauvais service
 * serait pire que de ne pas le garder — c'est précisément le dashboard
 * injoignable que cette précaution existe pour empêcher.
 *
 * La règle : on compare l'étiquette de gauche à celle de l'hôte COURANT du
 * même service, puis au préfixe de la convention. Le scénario visé est
 * celui du plan — seul le domaine de base change —, et dans ce
 * scénario-là la reconnaissance est exacte, y compris quand l'opérateur a
 * choisi son propre préfixe (`console.exemple.fr`).
 *
 * SA LIMITE, écrite plutôt que découverte : changer le domaine de base ET
 * le préfixe de l'administration dans le même geste rend l'ancien hôte
 * d'administration méconnaissable, et il retombe sur le site public. Le
 * remède est le même que pour le reste de cette fonctionnalité — changer
 * une chose à la fois.
 *
 * EXPORTÉE : `passe.ts` l'appelle aussi, pour plafonner le nombre
 * d'anciens hôtes gardés PAR SERVICE plutôt que globalement — voir le
 * commentaire à l'endroit où `passe` calcule `anciens`.
 */
export function serviceDeLAncienHote(hote: string, hotes: Hotes): Service {
  const etiquette = premiereEtiquette(hote)
  for (const service of ["admin", "umami"] as const) {
    const courant = hotes[service]
    if (courant !== null && premiereEtiquette(courant) === etiquette) return service
    if (PREFIXE_CONVENTION[service] === etiquette) return service
  }
  return "web"
}

/**
 * Le YAML dynamique de Traefik : un routeur par service, chacun portant
 * son hôte courant ET ses anciens.
 *
 * @param hotes ce que rend `routing.hotes`.
 * @param ancien les hôtes routés jusqu'ici, relus du fichier précédent.
 *
 * @throws si l'un des hôtes, courant ou ancien, n'est pas un hôte nu.
 */
export function composerRoutes(hotes: Hotes, ancien: string[]): string {
  // Un routeur par service, son hôte courant en tête.
  //
  // LES ANCIENS HÔTES RESTENT. C'est le piège numéro un du plan, et il est
  // fermé ici plutôt que dans le service qui appelle : retirer l'ancien
  // hôte au moment où le nouveau demande son certificat rend
  // l'administration injoignable sur les DEUX domaines si Let's Encrypt
  // échoue — DNS pas encore propagé, quota atteint —, et il n'existe alors
  // plus aucun moyen de revenir en arrière sans SSH. On ajoute, on
  // vérifie, et seulement ensuite on retire (passe suivante du service).
  const parService = new Map<Service, string[]>(
    SERVICES.map((service) => {
      const courant = hotes[service]
      return [service, courant === null ? [] : [exigerHoteNu(courant, service)]]
    }),
  )

  for (const brut of ancien) {
    const hote = exigerHoteNu(brut, "un ancien hôte")
    const service = serviceDeLAncienHote(hote, hotes)
    const liste = parService.get(service)
    // Le service relit les anciens hôtes du fichier qu'il a écrit : à la
    // passe qui suit un changement, l'hôte courant est aussi dans cette
    // liste. Deux `Host()` identiques dans une même règle est du bruit que
    // Traefik accepte et que personne ne relit.
    if (liste !== undefined && !liste.includes(hote)) liste.push(hote)
  }

  const lignes = [
    "# Configuration dynamique de Traefik — ENGENDRÉE par le service `routeur`.",
    "# Ne pas modifier à la main : la passe suivante réécrit ce fichier.",
    "http:",
    "  routers:",
  ]

  for (const service of SERVICES) {
    const listeHotes = parService.get(service) ?? []
    // Aucun hôte : aucun routeur. `umami` absent est le cas ordinaire —
    // ses deux services s'enlèvent du compose. Écrire un routeur pour un
    // service qui n'existe pas ferait demander à Traefik un certificat
    // pour un nom sans enregistrement DNS, et chaque échec compte dans le
    // quota Let's Encrypt : cinq par domaine et par semaine.
    if (listeHotes.length === 0) continue
    const regle = listeHotes.map((hote) => `Host(\`${hote}\`)`).join(" || ")
    lignes.push(
      `    ${service}:`,
      `      rule: "${regle}"`,
      "      entryPoints:",
      `        - ${ENTRYPOINT}`,
      `      service: ${service}@docker`,
      "      tls:",
      `        certResolver: ${RESOLVEUR}`,
    )
  }

  return lignes.join("\n") + "\n"
}
