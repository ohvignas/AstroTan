import { HOUR, type RateLimitConfig } from "@convex-dev/rate-limiter"

// La limite de débit du journal de consentement.
//
// Même défaut que celui corrigé sur le formulaire de contact
// (`leadRateLimit.ts`) : un second chemin d'écriture public du backend,
// sans limite. `consentId` vient du client — c'est un identifiant de geste
// que le navigateur choisit pour rendre `consent.record` idempotente, pas
// un secret — donc poster N identifiants distincts insère N lignes.
//
// ## Une seule clé, pas deux
//
// `leads.submit` borne à la fois l'origine ET l'adresse, parce que
// l'adresse y protège une ressource propre à elle (la boîte de réception
// des responsables, prévenue par email à chaque envoi). Le journal de
// consentement n'a pas d'équivalent : `visitorId` désigne un appareil, pas
// une personne à qui on écrit, et rien en aval ne coûte plus cher pour un
// `visitorId` que pour un autre. Une seconde clé n'y bornerait rien de
// réel — elle ajouterait une dimension de configuration sans fermer un
// levier que la première ne ferme pas déjà.
//
// ## L'origine n'est jamais une adresse IP en clair
//
// Même construction qu'à `/api/contact` : la route Astro hache l'adresse
// avec le secret partagé avant de l'envoyer. Convex ne voit donc jamais
// d'IP, seulement une empreinte stable qui ne se remonte pas sans le
// secret — ce qui permet à la politique de confidentialité d'annoncer que
// le site n'en conserve pas.

/** L'origine quand la plateforme ne sait pas la résoudre. */
export const ORIGINE_INCONNUE = "origine-inconnue"

export const CONSENT_ORIGIN_LIMIT_NAME = "consentRecordByOrigin"

/**
 * Vingt enregistrements par heure et par origine.
 *
 * Plus large que le formulaire de contact (cinq), volontairement : changer
 * d'avis sur les cookies pendant une session — ouvrir le bandeau, revenir,
 * l'ouvrir à nouveau — est un geste légitime et répété, et chaque
 * changement écrit une ligne. Vingt laisse cette marge sans ouvrir la
 * table à un script qui poste en boucle.
 *
 * `capacity` égale `rate`, comme pour les leads : pas de réserve
 * accumulée. Une boîte à jetons qui se remplit pendant une nuit
 * d'inactivité offrirait au matin une rafale de la taille de la réserve —
 * exactement le geste qu'on cherche à empêcher.
 */
export const CONSENT_ORIGIN_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 20,
  period: HOUR,
  capacity: 20,
}

/**
 * L'origine à compter, normalisée.
 *
 * Une chaîne vide, absente ou démesurée devient une constante partagée
 * plutôt qu'une clé unique : sans cela, il suffirait d'envoyer une origine
 * différente à chaque requête pour obtenir un budget neuf à chaque fois, et
 * le compteur ne compterait plus rien.
 */
export function origineDeComptage(brute: string | undefined): string {
  const valeur = brute?.trim() ?? ""
  if (valeur.length === 0 || valeur.length > 128) return ORIGINE_INCONNUE
  return valeur
}
