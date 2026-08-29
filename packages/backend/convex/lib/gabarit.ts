// Rendre un gabarit d'email modifié par l'adoptant, sans lui ouvrir de
// faille.
//
// Deux textes entrent ici et sont tous deux hostiles, par des chemins
// différents :
//
// - **Le gabarit** est écrit depuis l'administration. Son auteur est
//   authentifié, mais il n'est pas forcément prudent : `validerGabarit`
//   refuse avant l'enregistrement ce qui casserait l'envoi ou le
//   détournerait.
// - **Les valeurs** viennent d'Internet. Le nom, le sujet et le message
//   d'une notification de lead sont saisis par un visiteur du formulaire
//   de contact. Elles ne sont jamais validées : elles sont *neutralisées*
//   au moment de la substitution.
//
// La règle qui tient tout : la substitution se fait en **une seule
// passe**. Une boucle de `replace` successifs laisserait une valeur
// introduire une variable que la passe suivante substituerait — un
// visiteur écrivant `{{lien}}` dans son nom ferait afficher autre chose
// que son nom.
//
// **Ce que ce module ne fait pas, et que l'appelant doit faire :**
//
// 1. **L'objet rendu doit repasser par `singleLine`.** `validerGabarit`
//    garantit que le *gabarit* de l'objet tient sur une ligne ; il ne peut
//    rien garantir des *valeurs*, qui n'existent pas encore au moment de
//    la validation. `Nouveau message de {{nom}}` est un objet valide, et
//    un nom contenant un saut de ligne y rouvrirait l'injection
//    d'en-têtes. C'est exactement ce que `leads.ts` fait déjà aujourd'hui.
// 2. **Rien.** Ce point disait que toute valeur atterrissant dans un `href`
//    devait passer par `isSafeHref` (`lib/safeHref.ts`), et que c'était une
//    propriété des appelants. Ce n'en est plus une : depuis que `rendreHtml`
//    fabrique lui-même les ancres, c'est lui qui appelle `isSafeHref`, sur
//    la seule provenance qui a le droit d'y aller. Un appelant n'a plus
//    d'URL à mettre dans un `href` lui-même — et s'il en écrivait une, elle
//    serait à nouveau à lui de garder.
//
// **Ce que ce module met en lien, et ce qu'il ne mettra jamais en lien :**
// le texte du gabarit et les valeurs déclarées de confiance
// (`VARIABLES_DE_CONFIANCE`, `lib/catalogueEmails.ts`) deviennent des ancres
// `<a href>` ; toute autre valeur reste du texte échappé, parce qu'elle vient
// d'Internet. Le raisonnement complet est sur `rendreHtml`.

import { VARIABLES_DE_CONFIANCE, type CleEmail, type DescriptionEmail } from "./catalogueEmails"
import { isSafeHref } from "./safeHref"

/** Bornes du gabarit, en caractères. */
export const MAX_OBJET = 200
export const MAX_CORPS = 5_000

// Les espaces intérieurs sont tolérés (`{{ lien }}`) pour une seule
// raison : validation et rendu doivent voir exactement les mêmes
// variables. Un motif plus strict laisserait `{{ lien }}` passer la
// validation — aucune variable inconnue, rien à signaler — puis partir
// tel quel dans l'email.
const MOTIF_VARIABLE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

// Ce qui n'a rien à faire dans un en-tête `Subject:`. `\r` et `\n` le
// coupent — tout ce qui suit devient un en-tête, `Bcc:` compris. Les
// autres caractères de contrôle n'injectent rien à eux seuls, mais une
// ligne qui commence par une tabulation est une continuation d'en-tête
// (RFC 5322, « folding »), et aucun d'eux n'a de sens dans un objet.
const CARACTERE_INTERDIT_DANS_OBJET = /[\u0000-\u001F\u007F]/

/** Les variables employées par un texte, dédupliquées, dans l'ordre. */
export function variablesEmployees(texte: string): string[] {
  const vues: string[] = []
  for (const correspondance of texte.matchAll(MOTIF_VARIABLE)) {
    // `noUncheckedIndexedAccess` type le groupe capturé `string |
    // undefined`. Il fait partie du motif : il existe dès que le motif
    // correspond, et le `?? ""` ne se déclenche jamais.
    const nom = correspondance[1] ?? ""
    if (!vues.includes(nom)) vues.push(nom)
  }
  return vues
}

/**
 * Le message d'erreur à afficher, ou `null` quand le gabarit est bon.
 *
 * Rend un message plutôt que de lever : cette fonction sert deux
 * appelants, la mutation qui enregistre et l'écran qui prévient avant
 * d'enregistrer, et le second n'a rien à rattraper.
 */
export function validerGabarit(
  description: DescriptionEmail,
  objet: string,
  corps: string,
): string | null {
  if (objet.trim().length === 0) return "L'objet ne peut pas être vide."
  if (corps.trim().length === 0) return "Le corps ne peut pas être vide."

  if (objet.length > MAX_OBJET) return `L'objet dépasse ${MAX_OBJET} caractères.`
  if (corps.length > MAX_CORPS) return `Le corps dépasse ${MAX_CORPS} caractères.`

  // Avant les variables : un objet multi-lignes est une injection
  // d'en-têtes SMTP, pas une coquetterie de mise en forme.
  if (CARACTERE_INTERDIT_DANS_OBJET.test(objet)) {
    return (
      "L'objet doit tenir sur une seule ligne : un saut de ligne y ajouterait " +
      "des en-têtes à l'email."
    )
  }

  const employees = [...variablesEmployees(objet), ...variablesEmployees(corps)]

  const inconnue = employees.find((nom) => !description.variables.includes(nom))
  if (inconnue) {
    const disponibles = description.variables.map((nom) => `{{${nom}}}`).join(", ")
    return `La variable {{${inconnue}}} n'existe pas pour cet email. Disponibles : ${disponibles}.`
  }

  // Obligatoire dans l'objet OU dans le corps : le lien d'invitation vit
  // dans le corps, et l'exiger des deux serait exiger ce que le gabarit
  // par défaut du catalogue ne fait pas lui-même.
  const manquante = description.variablesObligatoires.find((nom) => !employees.includes(nom))
  if (manquante) {
    return (
      `La variable {{${manquante}}} est obligatoire pour cet email : sans elle, ` +
      "la personne qui le reçoit ne peut rien en faire."
    )
  }

  return null
}

/**
 * Substituer les valeurs dans un gabarit, en une passe.
 *
 * `String.replace` avec une **fonction** de remplacement, pour deux
 * raisons distinctes qu'un remplacement textuel raterait toutes les
 * deux : ce que la fonction rend n'est pas rebalayé (une valeur ne peut
 * pas introduire une variable), et il n'y est pas réinterprété (une
 * valeur contenant `$&` reste `$&`).
 */
export function rendreTexte(gabarit: string, valeurs: Record<string, string>): string {
  return gabarit.replace(MOTIF_VARIABLE, (_, nom: string) => valeur(valeurs, nom))
}

/**
 * La même substitution, mais chaque valeur échappée — et les URL mises en
 * lien, segment par segment.
 *
 * Le gabarit, lui, n'est pas échappé : ce n'est pas du HTML saisi.
 * L'objet et le corps sont du texte brut, et c'est le code qui compose le
 * HTML autour.
 *
 * **Pourquoi la mise en lien se fait ICI et pas sur la chaîne finale.**
 * L'email d'invitation et celui de réinitialisation n'existent que pour leur
 * lien : l'un est le seul chemin de création de compte du dépôt, l'autre le
 * seul chemin de récupération. Une URL nue les laisse à la merci d'un client
 * de messagerie qui voudra bien la reconnaître. Mais mettre en lien le
 * résultat *rendu* traiterait de la même façon deux choses qui n'ont rien à
 * voir : le lien que le serveur a construit, et l'URL qu'un visiteur anonyme
 * a tapée dans le formulaire de contact — laquelle partirait alors, cliquable
 * et signée du domaine du site, vers un owner ou un admin. Une passe finale
 * ne peut plus distinguer les deux : d'où la mise en lien pendant la
 * substitution, où l'on sait encore d'où vient chaque caractère.
 *
 * Trois provenances, trois traitements :
 *
 * - **le texte du gabarit** — écrit depuis l'administration, par quelqu'un
 *   qui a un compte : mis en lien ;
 * - **une valeur de confiance** — `VARIABLES_DE_CONFIANCE[cle]`, celles que
 *   le serveur construit : échappée puis mise en lien ;
 * - **toute autre valeur** — elle vient d'Internet : échappée, jamais mise
 *   en lien.
 *
 * `cle` est un paramètre **obligatoire**, et c'est délibéré : une valeur par
 * défaut ferait d'un appel oublié un email au lien mort, découvert par la
 * personne qui n'arrive plus à récupérer son compte. Le compilateur est le
 * seul à pouvoir le dire à temps.
 */
export function rendreHtml(
  gabarit: string,
  valeurs: Record<string, string>,
  cle: CleEmail,
): string {
  // `?? []` : le type dit que la clé existe, mais un appelant JavaScript —
  // ou un appel écrit avant que ce paramètre n'existe — passerait
  // `undefined`. Retomber sur « aucune valeur de confiance » perd le lien ;
  // l'autre défaut possible perdrait la protection.
  const deConfiance = VARIABLES_DE_CONFIANCE[cle] ?? []

  // La substitution reste en UNE passe, avec la même garantie qu'avant :
  // les correspondances sont cherchées dans le gabarit seul, et ce que
  // chaque segment produit est concaténé sans jamais être rebalayé. Une
  // valeur ne peut donc introduire ni une variable, ni — quand elle est
  // hors confiance — une URL que la suite mettrait en lien.
  let sortie = ""
  let curseur = 0
  for (const correspondance of gabarit.matchAll(MOTIF_VARIABLE)) {
    const nom = correspondance[1] ?? ""
    const debut = correspondance.index
    sortie += lier(gabarit.slice(curseur, debut), telQuel)
    const rendue = valeur(valeurs, nom)
    sortie += deConfiance.includes(nom) ? lier(rendue, escapeHtml) : escapeHtml(rendue)
    curseur = debut + correspondance[0].length
  }
  return sortie + lier(gabarit.slice(curseur), telQuel)
}

/** Le gabarit part en HTML sans être échappé — voir `rendreHtml`. */
const telQuel = (texte: string): string => texte

// Un seul schéma, et pas par prudence excessive : `javascript:` traverse
// `escapeHtml` sans une égratignure (il n'y a ni `<`, ni `>`, ni guillemet à
// échapper), et `mailto:`/`tel:` n'ont aucun emploi dans ces trois emails.
// Le motif s'arrête au premier blanc et aux caractères qui délimitent le
// HTML, si bien qu'une URL ne peut pas déborder de son ancre.
const MOTIF_URL = /https:\/\/[^\s<>"'`]+/g

// Ce qui termine une phrase et pas une URL. `)` est traité à part : il ferme
// souvent une parenthèse ouverte DANS l'URL.
const PONCTUATION_FINALE = ".,;:!?»…"

// Une URL précédée d'un `=` ou d'un guillemet est déjà dans un attribut :
// c'est l'adoptant qui a écrit son ancre à la main. La mettre en lien
// produirait une ancre dans une ancre — du HTML cassé là où sa version
// marchait.
const AVANT_UN_ATTRIBUT = /["'=]/

/**
 * Les URL d'un segment transformées en ancres, le reste passé à `echapper`.
 *
 * `echapper` distingue les deux provenances qui ont droit au lien : le texte
 * du gabarit sort tel quel (c'est déjà ce que faisait `rendreHtml`), une
 * valeur de confiance sort échappée.
 *
 * L'URL est repérée sur le texte **brut**, puis échappée pour le `href` ET
 * pour le texte de l'ancre. C'est le bon ordre : `?a=1&b=2` devient
 * `?a=1&amp;b=2`, qui est la forme correcte d'un `&` dans un attribut — le
 * navigateur la redécode avant de suivre le lien.
 */
function lier(texte: string, echapper: (v: string) => string): string {
  let sortie = ""
  let curseur = 0
  for (const correspondance of texte.matchAll(MOTIF_URL)) {
    const debut = correspondance.index
    const url = elaguerPonctuation(correspondance[0] ?? "")
    // `isSafeHref` plutôt qu'une confiance dans le motif seul : c'est la
    // parade déjà écrite du dépôt (`lib/safeHref.ts`), et elle refuse en
    // plus les caractères de contrôle et les URL que `new URL` rejette.
    if (url.length === 0 || !isSafeHref(url)) continue
    if (AVANT_UN_ATTRIBUT.test(texte.slice(debut - 1, debut))) continue
    sortie += echapper(texte.slice(curseur, debut))
    const href = escapeHtml(url)
    sortie += `<a href="${href}">${href}</a>`
    curseur = debut + url.length
  }
  return sortie + echapper(texte.slice(curseur))
}

/**
 * La ponctuation qui suit l'URL plutôt qu'elle n'en fait partie.
 *
 * « Ouvrez https://exemple.fr/x. » ne doit pas mettre le point dans le lien.
 * La parenthèse fermante n'est retirée que si rien ne l'a ouverte dans l'URL,
 * pour ne pas amputer `…/A_(b)`.
 */
function elaguerPonctuation(url: string): string {
  let fin = url.length
  while (fin > 0) {
    const dernier = url.slice(fin - 1, fin)
    if (PONCTUATION_FINALE.includes(dernier)) fin -= 1
    else if (dernier === ")" && !url.slice(0, fin).includes("(")) fin -= 1
    else break
  }
  return url.slice(0, fin)
}

/**
 * La valeur d'une variable, ou la chaîne vide.
 *
 * `hasOwnProperty` plutôt qu'un accès direct : `valeurs["constructor"]`
 * rend une fonction héritée d'`Object`, pas `undefined`. Un `?? ""` seul
 * laisserait `{{constructor}}` afficher le code source d'`Object` dans
 * l'email.
 */
function valeur(valeurs: Record<string, string>, nom: string): string {
  if (!Object.prototype.hasOwnProperty.call(valeurs, nom)) return ""
  return valeurs[nom] ?? ""
}

/**
 * `&`, `<`, `>` et `"` échappés : le corps du message vient d'Internet.
 *
 * Ces quatre-là suffisent à l'usage exact qu'en fait ce dépôt — du texte
 * entre balises, et des attributs à **guillemets doubles**. L'apostrophe
 * n'est volontairement pas échappée : l'élargir n'apporterait rien tant
 * qu'aucun attribut à guillemets simples n'est écrit, et changerait la
 * sortie déjà envoyée par `leads.ts`. Écrire un jour `href='…'`, ou un
 * attribut sans guillemets, casserait cette hypothèse en silence — d'où
 * cette phrase.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Une seule ligne, sans retour chariot.
 *
 * Le nom et le sujet sont saisis par le visiteur et atterrissent dans
 * l'en-tête `Subject:` d'un email. Un retour à la ligne y ouvre la porte à
 * l'injection d'en-têtes ; les bornes de longueur de `content.ts` ne
 * disent rien des caractères de contrôle.
 */
export function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim()
}
