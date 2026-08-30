import { normalizeSlug, slugify } from "@astrotan/backend/convex/lib/slug"

// ---------------------------------------------------------------------
// Le couple titre / slug du dialogue « Nouvelle page ».
//
// Trois règles, et chacune existe parce que son absence est un défaut
// connu de cette fonctionnalité :
//
//   1. le slug suit le titre tant qu'on n'y a pas touché ;
//   2. il CESSE de le suivre dès la première frappe manuelle — sinon la
//      correction est réécrite au caractère suivant tapé dans le titre, et
//      le champ devient impossible à corriger ;
//   3. le vider le remet en laisse : c'est la seule façon de revenir au
//      titre sans rouvrir le dialogue.
//
// La translittération n'est PAS écrite ici. `slugify` vit dans
// `packages/backend/convex/lib/slug.ts`, à côté de `normalizeSlug` que
// `pages.create` applique à ce que le dialogue envoie. Deux règles de slug
// écrites à deux endroits divergent — ce dépôt l'a déjà payé une fois,
// avec les tags « Astro » et « astro ».
// ---------------------------------------------------------------------

export interface EtatSlug {
  titre: string
  slug: string
  /** Le slug suit-il encore le titre ? Faux dès qu'on l'a édité à la main. */
  lie: boolean
}

export const ETAT_SLUG_INITIAL: EtatSlug = { titre: "", slug: "", lie: true }

export function saisirTitre(etat: EtatSlug, titre: string): EtatSlug {
  return { titre, slug: etat.lie ? slugify(titre) : etat.slug, lie: etat.lie }
}

export function saisirSlug(etat: EtatSlug, slug: string): EtatSlug {
  // Pas de `slugify` sur une saisie manuelle : `pages.create` ne passe le
  // slug que par `normalizeSlug`, qui préserve la casse — le chemin d'une
  // page est choisi, pas dérivé (`lib/slug.ts`). Le réécrire ici
  // interdirait des slugs que le serveur accepte.
  return { titre: etat.titre, slug, lie: slug.trim() === "" }
}

/**
 * Ce slug est-il déjà celui d'une page ?
 *
 * Le refus arrive sinon après le clic sur « Créer », et le champ se
 * remplissant désormais tout seul, la collision est devenue plus probable
 * qu'avant.
 *
 * La comparaison est EXACTE, après `normalizeSlug`, et donc sensible à la
 * casse : c'est ce que fait `assertSlugAvailable` côté Convex, sur un index
 * `by_slug`. Une comparaison insensible refuserait ici des créations que le
 * serveur accepte — un garde-fou plus strict que la règle est un bug qui ne
 * se voit qu'au moment où il bloque quelqu'un.
 */
export function slugDejaPris(
  slug: string,
  slugsExistants: readonly string[]
): boolean {
  const candidat = normalizeSlug(slug)
  if (candidat === "") return false
  return slugsExistants.some((existant) => existant === candidat)
}
