// Le domaine du site, tel qu'Astro doit l'accepter — et la seule chose qui
// rende `clientAddress` vrai derrière un reverse proxy.
//
// LE DÉFAUT QUE CE FICHIER FERME
//
// `/api/contact` et `/api/consent` limitent le débit par visiteur, et la
// clé de ce compteur est l'empreinte de `clientAddress`. Derrière Traefik,
// le conteneur `web` reçoit toutes les requêtes depuis une seule adresse :
// celle du conteneur Traefik. `clientAddress` valait donc la MÊME chose
// pour tout Internet, et les deux limiteurs n'avaient qu'un seau pour
// l'ensemble des visiteurs — cinq messages de contact par heure pour la
// planète, puis `RATE_LIMITED` pour tout le monde ; vingt enregistrements
// de consentement par heure, puis plus aucune preuve écrite, en silence,
// pendant que `/confidentialite` annonce « pouvoir prouver le
// consentement ».
//
// Astro sait faire mieux, mais seulement si on le lui dit. Dans
// `astro/dist/core/app/node.js`, `x-forwarded-for` n'est lu que si l'hôte
// de la requête a été VALIDÉ (`hostValidated`) ; et `validateHost` rend
// `undefined` dès que `security.allowedDomains` est vide — ce qui est son
// défaut. Sans la configuration ci-dessous, l'en-tête est ignoré et
// `clientAddress` retombe sur `req.socket.remoteAddress`.
//
// POURQUOI PAS LIRE `x-forwarded-for` NOUS-MÊMES
//
// Parce que c'est un en-tête que le CLIENT peut poser. Le lire sans
// validation d'hôte transformerait une limite de débit en outil
// d'usurpation : n'importe qui pourrait s'attribuer l'adresse de n'importe
// qui, donc consommer le quota d'un autre, ou s'en fabriquer un neuf à
// chaque requête. Le mécanisme d'Astro n'honore l'en-tête qu'après avoir
// reconnu l'hôte — c'est cette reconnaissance qui distingue « ce proxy est
// le nôtre » de « quelqu'un prétend être derrière un proxy ».
//
// AU BUILD, PAS AU RUNTIME
//
// `astro.config.ts` est lu pendant `astro build` : la valeur est figée dans
// la sortie, exactement comme une `PUBLIC_*`. La poser dans le `.env` du
// VPS ne ferait rien. Elle traverse donc le `ARG WEB_DOMAIN` de
// `docker/web.Dockerfile` et le `build-args` de `deploy.yml`, et
// `scripts/check-env-wiring.mjs` vérifie que ces deux moitiés existent.

/** Un motif d'hôte, au format `RemotePattern` d'Astro. */
export interface MotifHote {
  hostname: string
}

/**
 * Un hôte nu : des étiquettes DNS séparées par des points. Ni schéma, ni
 * port, ni chemin, ni joker — ce que `WEB_DOMAIN` vaut dans
 * `docker/.env.example`, et ce que Traefik met dans sa règle
 * ``Host(`${WEB_DOMAIN}`)``.
 */
const HOTE_NU = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Les motifs d'hôte à donner à `security.allowedDomains`, d'après le
 * domaine du site.
 *
 * Vide quand `WEB_DOMAIN` est absent : c'est le cas du développement local,
 * où il n'y a pas de proxy et où `clientAddress` est déjà l'adresse réelle.
 * Ce n'est PAS une dégradation acceptable en production, et rien ici ne
 * peut la distinguer — c'est pourquoi le `RUN test -n "$WEB_DOMAIN"` de
 * `docker/web.Dockerfile` refuse de construire l'image sans elle.
 *
 * Le motif ne fixe aucun protocole, et ce n'est pas un oubli. Astro
 * confronte `Host` au protocole RÉEL de la socket — `http`, puisque Traefik
 * termine le TLS — et `X-Forwarded-Host` à `https` par défaut. Un motif
 * portant `protocol` refuserait donc l'un des deux ; sans lui, les deux
 * valident (`matchProtocol` rend `true` quand le motif n'en porte pas).
 */
export function domainesAutorises(webDomain: string | undefined): MotifHote[] {
  const domaine = (webDomain ?? "").trim().toLowerCase()
  if (domaine.length === 0) return []
  if (!HOTE_NU.test(domaine)) {
    // Refuser plutôt que produire un motif qui ne correspond à rien : un
    // motif faux redonne exactement la panne silencieuse que cette
    // configuration existe pour fermer, avec en plus l'illusion d'être
    // configuré.
    throw new Error(
      `WEB_DOMAIN doit être un hôte nu (« exemple.fr »), sans schéma, port ni chemin — reçu : ${JSON.stringify(webDomain)}`,
    )
  }
  return [{ hostname: domaine }]
}
