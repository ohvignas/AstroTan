// Les pages qu'un site ne peut pas se permettre de perdre.
//
// Elles ne sont pas « importantes » au sens éditorial : elles sont
// RÉFÉRENCÉES depuis un endroit qu'on ne peut pas modifier au cas par cas.
// Le pied de page les affiche sur toutes les pages du site, et surtout le
// bandeau de consentement renvoie vers deux d'entre elles au moment précis
// où quelqu'un doit décider en connaissance de cause.
//
// Le défaut que ça ferme : ces pages sont des lignes en base comme les
// autres, et rien n'empêchait de les dépublier depuis l'administration.
// Elles répondent alors 404 — et le site continue de pointer vers elles.
// Un consentement dont l'information est inaccessible n'est pas éclairé,
// et le lien mort ne se voit depuis aucun écran de l'administration.
//
// Une liste écrite en dur, et c'est assumé : ces trois slugs sont ceux que
// le CODE référence (`config/nav.ts`, `config/consent.ts`). Les rendre
// configurables déplacerait le problème sans le résoudre — il faudrait
// alors garder d'accord la configuration et les liens.

export const REQUIRED_PAGE_SLUGS = [
  "mentions-legales",
  "confidentialite",
  "cookies",
] as const

export type RequiredPageSlug = (typeof REQUIRED_PAGE_SLUGS)[number]

export function isRequiredPage(slug: string): boolean {
  return (REQUIRED_PAGE_SLUGS as readonly string[]).includes(slug)
}

/**
 * La phrase montrée à l'opérateur quand il essaie de retirer une de ces
 * pages. Elle dit POURQUOI, parce qu'un refus sans motif se contourne :
 * la personne recommence, échoue, et finit par supprimer la ligne.
 */
export const REQUIRED_PAGE_REASON =
  "Cette page est référencée par le pied de page et par le bandeau de " +
  "cookies, sur tout le site. La retirer laisserait des liens morts à " +
  "l'endroit exact où un visiteur doit pouvoir s'informer avant de " +
  "décider. Modifiez son contenu si besoin, mais laissez-la en ligne."
