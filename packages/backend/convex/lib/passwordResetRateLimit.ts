import { HOUR, type RateLimitConfig } from "@convex-dev/rate-limiter"

// La limite de débit de `/request-password-reset` — la seule route
// PUBLIQUE, NON AUTHENTIFIÉE et qui ENVOIE UN EMAIL de ce dépôt.
//
// Couche « décision », pure et sans dépendance, exactement comme
// `lib/signInRateLimit.ts` : rien ici ne touche un ctx Convex ni le client
// du composant `rateLimiter`. Le câblage — l'unique `ctx.runMutation` à
// travers le composant, et la traduction en `APIError` que le routeur
// better-auth inspecte réellement — vit dans `auth.ts`.
//
// ## Ce que `rateLimit` d'`auth.ts` couvre aujourd'hui : RIEN
//
// Vérifié avant d'écrire, pas supposé. Le bloc vaut `{ enabled: false }`,
// et même retourné à `true` il resterait inerte dans ce runtime : le
// limiteur de Better Auth vaut `storage: "memory"` par défaut, et un état
// en mémoire ne survit pas — ni ne se partage — entre deux isolats
// d'action HTTP Convex. La route est donc, à cet instant, sans aucune
// borne. `@convex-dev/rate-limiter` persiste en base, c'est ce qui la lui
// donne.
//
// ## Les deux dommages, et pourquoi ils tiennent dans UN seul seau
//
// 1. **Inonder la boîte de quelqu'un.** Le dommage est porté par
//    l'ADRESSE : c'est la boîte d'une personne nommée qui se remplit.
// 2. **Épuiser le quota Resend du déploiement.** Le quota est partagé avec
//    les invitations — et l'invitation est le SEUL chemin de création de
//    compte (`disableSignUp: true`, aucun OAuth). Vider le quota par cette
//    route, c'est fermer la porte d'entrée du produit.
//
// Un seul seau, indexé sur l'adresse revendiquée, les borne tous les deux :
// un email ne part que pour un compte qui existe (`passwordReset.envoyer`
// refuse en silence le reste), donc trois par heure et par adresse plafonne
// mécaniquement la consommation Resend à trois par heure et par compte
// réel — un nombre que l'opérateur contrôle directement, puisque c'est lui
// qui crée les comptes.
//
// ## Pourquoi PAS le seau (origine, email) de la connexion
//
// `lib/signInRateLimit.ts` garde deux seaux, et il faut dire pourquoi on
// n'en garde qu'un ici plutôt que de recopier sa forme.
//
// Là-bas, le seau par origine existe pour que le seau par email ne
// devienne pas une arme CONTRE le propriétaire du compte : épuiser le
// budget de connexion d'une adresse enfermerait dehors la personne qui la
// possède. Ici la forme du dommage est inversée — le budget par adresse
// EST la chose à protéger, puisqu'il borne ce qui atterrit dans la boîte
// de cette personne-là. Le découper par origine ne bornerait plus rien du
// tout : `getIp` de Better Auth lit `x-forwarded-for` verbatim, rien ne
// se tient devant `*.convex.site` pour le valider, et faire tourner
// l'en-tête suffirait donc à frapper une même boîte autant de fois qu'on
// veut. Un seau indépendant de l'origine, par construction, est le seul
// qui tienne cette promesse.
//
// Le prix est assumé et il est petit : quelqu'un qui connaît une adresse
// peut retarder d'une heure la réinitialisation de son titulaire. La
// fenêtre se réouvre toute seule, il n'existe aucun « déblocage » à
// demander, et la comparaison honnête n'est pas « avec ou sans gêne »
// mais « une heure d'attente » contre « une boîte inondée sans borne ».
//
// ## Pourquoi PAS non plus de seau global au déploiement
//
// Il fermerait le dernier chemin de récupération du dépôt POUR TOUT LE
// MONDE dès qu'un attaquant connaissant deux ou trois adresses l'a vidé.
// C'est un dommage plus grave que celui qu'il prévient, et le seau par
// adresse borne déjà la consommation Resend à trois par heure et par
// compte existant.
//
// ## Pourquoi la clé ne distingue pas les adresses connues des inconnues
//
// Même raison que pour la connexion, et elle compte doublement ici : la
// clé est bâtie sur ce que la requête REVENDIQUE, jamais sur une
// recherche de compte. Un limiteur qui ne compterait que les adresses
// réelles rendrait 429 pour un compte existant et 200 pour une adresse
// inconnue — c'est-à-dire exactement l'oracle d'existence que tout le
// reste de ce chemin (réponse identique, refus silencieux dans
// `passwordReset.envoyer`) est construit pour éviter.
export const PASSWORD_RESET_RATE_LIMIT_NAME = "passwordResetRequest"

// Trois demandes par adresse et par heure, fenêtre fixe.
//
// La FENÊTRE FIXE plutôt qu'un token bucket : la propriété à tenir s'écrit
// littéralement « N demandes dans une fenêtre », et une fenêtre fixe la
// dit sans rien à régler en plus. Elle se réouvre d'elle-même, donc elle
// ne peut pas enfermer quelqu'un durablement.
//
// UNE HEURE, parce que c'est déjà l'horloge de ce chemin : le lien vit
// `RESET_PASSWORD_TOKEN_TTL_SECONDS` (3600 s, voir `auth.ts`), si bien
// que la fenêtre et le jeton expirent ensemble — quand le budget se
// renouvelle, le jeton précédent vient justement de mourir. La constante
// n'est pas importée d'`auth.ts` : ce module doit rester sans dépendance
// (`auth.ts` importe celui-ci, l'inverse serait un cycle).
//
// TROIS, parce que c'est le nombre de fois qu'une personne réelle
// recommence — « l'email n'est pas arrivé », deux fois — avant d'aller
// chercher de l'aide autrement. Au-delà, ce n'est plus quelqu'un qui
// attend un email.
export const PASSWORD_RESET_RATE_LIMIT_CONFIG: RateLimitConfig = {
  kind: "fixed window",
  rate: 3,
  period: HOUR,
}

// Pure, même contrat que `buildSignInEmailRateLimitKey` : `email` est
// `unknown` et non `string` parce qu'au seul site d'appel (`auth.ts`,
// `hooks.before`) il sort de `ctx.body`, typé `any` par better-auth, et
// que `hooks.before` s'exécute AVANT la validation zod du corps par
// l'endpoint. Refuser une requête mal formée est le travail de ce
// validateur, pas de cette pré-vérification : elle dégrade (clé vide)
// plutôt que de lever.
//
// La normalisation (`trim`, `toLowerCase`) n'est pas cosmétique : sans
// elle, « Victime@exemple.fr » et « victime@exemple.fr » ouvriraient deux
// seaux distincts pour une seule et même boîte, et il suffirait de varier
// la casse pour multiplier le budget.
export function buildPasswordResetRateLimitKey(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}
