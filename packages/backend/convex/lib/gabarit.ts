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
// 2. **Une valeur qui atterrit dans un `href` doit passer par
//    `isSafeHref`** (`lib/safeHref.ts`). `escapeHtml` empêche de *sortir*
//    de l'attribut ; il ne dit rien du schéma d'URL, et `javascript:…`
//    traverse les quatre remplacements sans une égratignure. Aucune des
//    valeurs `lien` d'aujourd'hui n'est saisie par qui que ce soit — elles
//    sont construites par le serveur — mais c'est une propriété des
//    appelants, pas de ce module.

import type { DescriptionEmail } from "./catalogueEmails"

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
 * La même substitution, mais chaque valeur échappée.
 *
 * Le gabarit, lui, n'est pas échappé : ce n'est pas du HTML saisi.
 * L'objet et le corps sont du texte brut, et c'est le code qui compose le
 * HTML autour.
 */
export function rendreHtml(gabarit: string, valeurs: Record<string, string>): string {
  return gabarit.replace(MOTIF_VARIABLE, (_, nom: string) => escapeHtml(valeur(valeurs, nom)))
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
