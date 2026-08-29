// L'origine d'une requête publique, normalisée — partagée par tous les
// limiteurs de débit du backend qui la comptent.
//
// Deux chemins d'écriture publics l'utilisent aujourd'hui,
// `lib/leadRateLimit.ts` (formulaire de contact) et
// `lib/consentRateLimit.ts` (journal de consentement) : chacun a sa propre
// route Astro, son propre secret, son propre budget — mais la DÉCISION de
// ce qui compte comme « pas d'origine exploitable » est une seule règle de
// sécurité, pas deux. Elle vivait recopiée à l'identique dans les deux
// fichiers, commentaire compris ; une revue l'a relevé : si les deux
// copies divergent un jour (un `.trim()` oublié, un 128 devenu 129), le
// contournement se rouvre d'un seul côté, silencieusement, et rien ne
// l'empêche plus de se voir.
//
// ## L'origine n'est jamais une adresse IP en clair
//
// Chaque route Astro appelante hache l'adresse du visiteur avec son propre
// secret partagé avant de l'envoyer ici. Convex ne voit donc jamais d'IP,
// seulement une empreinte stable qui ne se remonte pas sans le secret — ce
// qui permet à la politique de confidentialité d'annoncer que le site n'en
// conserve pas.

/** L'origine quand l'appelant ne peut pas la résoudre. */
export const ORIGINE_INCONNUE = "origine-inconnue"

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
