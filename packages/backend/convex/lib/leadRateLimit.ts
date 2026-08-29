import { HOUR, type RateLimitConfig } from "@convex-dev/rate-limiter"

// La limite de débit du formulaire de contact.
//
// Elle manquait, et les deux fichiers concernés se renvoyaient la
// responsabilité en commentaire : `leads.ts` écrivait « appelée par une
// route Astro qui voit l'IP et limite le débit », `api/contact.ts` écrivait
// que la limitation vivait dans Convex. Ni l'un ni l'autre ne la portait —
// `clientAddress` était lu puis jeté. Une revue de sécurité l'a relevé.
//
// Ce que coûtait l'absence : chaque envoi insère un lead, PUIS planifie un
// appel de webhook sortant, PUIS un email par Resend. Une boucle sur
// `/contact` remplissait la boîte des responsables, la facture Resend et le
// trafic sortant, sans authentification et sans limite.
//
// ## Deux clés, pour la même raison qu'à la connexion
//
// - **Par origine seule** : un envoi automatisé change d'adresse et repart
//   à zéro, et tout un bureau derrière la même sortie NAT est puni pour un
//   seul auteur.
// - **Par adresse électronique seule** : le budget est partagé entre toutes
//   les origines. N'importe qui peut épuiser le budget d'une adresse qu'il
//   n'a jamais possédée, et la personne légitime se retrouve muette.
//
// Les deux ensemble bornent ce qui doit l'être sans offrir de levier contre
// quelqu'un d'autre. C'est le raisonnement de `signInRateLimit.ts`, et il
// vaut ici pour les mêmes raisons.
//
// La normalisation de l'origine elle-même (`origineDeComptage`) vit dans
// `lib/originFingerprint.ts`, partagée avec `lib/consentRateLimit.ts` :
// c'est une seule décision de sécurité, pas une par limiteur.

export const LEAD_ORIGIN_LIMIT_NAME = "leadSubmitByOrigin"

/**
 * Cinq envois par heure et par origine.
 *
 * Une personne qui écrit deux fois parce qu'elle a oublié une précision
 * doit passer. Cinq laisse même la place à une erreur de manipulation ;
 * au-delà, ce n'est plus quelqu'un qui écrit.
 *
 * `capacity` égale `rate` : pas de réserve accumulée. Une boîte à jetons
 * qui se remplit pendant une nuit d'inactivité offrirait au matin une
 * rafale de la taille de la réserve, ce qui est exactement le geste qu'on
 * cherche à empêcher.
 */
export const LEAD_ORIGIN_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 5,
  period: HOUR,
  capacity: 5,
}

export const LEAD_EMAIL_LIMIT_NAME = "leadSubmitByEmail"

/**
 * Trois envois par heure et par adresse.
 *
 * Plus serré que l'origine, parce qu'une même adresse qui écrit quatre fois
 * dans l'heure relève de l'automatisme, et parce que ce compteur-là est
 * celui qui protège la boîte de réception des responsables.
 */
export const LEAD_EMAIL_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 3,
  period: HOUR,
  capacity: 3,
}
