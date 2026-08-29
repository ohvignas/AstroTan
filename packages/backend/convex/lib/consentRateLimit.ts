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
// La normalisation de l'origine elle-même (`origineDeComptage`) vit dans
// `lib/originFingerprint.ts`, partagée avec `lib/leadRateLimit.ts` : c'est
// une seule décision de sécurité, pas une par limiteur.

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
