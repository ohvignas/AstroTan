// L'adresse publique d'une page, calculée à un seul endroit.
//
// La règle tient en une exception : la page d'accueil répond à `/`, pas à
// `/<son-slug>`. Sa ligne dit `accueil`, et c'est `index.astro` qui la sert,
// parce que `/` n'a pas de segment à nommer.
//
// Cette exception a été oubliée QUATRE fois, à quatre endroits différents,
// et chaque fois le symptôme était le même : une adresse affichée ou suivie
// qui rend 404.
//
//   1. `feeds.ts` — l'accueil absent du sitemap
//   2. `pages.list` — l'accueil badgé « sans fichier » dans le tableau
//   3. le tableau des pages — la colonne affichait `/accueil`
//   4. le bouton Prévisualiser — il ouvrait `/accueil?t=…`, une route qui
//      n'existe pas, et l'aperçu montrait donc une 404 au lieu de la page
//      qu'on s'apprêtait à publier
//
// Recopier la condition une cinquième fois aurait produit une cinquième
// occasion de l'oublier. Tout ce qui a besoin de l'adresse d'une page
// appelle cette fonction, et le test à côté est ce qui fait que la
// prochaine personne n'a pas à connaître l'exception pour l'appliquer.

/**
 * Le chemin auquel une page est réellement servie.
 *
 * `homePageSlug` vient de `settings` et peut être absent — un déploiement
 * neuf n'a pas encore choisi sa page d'accueil. Dans ce cas aucune page
 * n'est l'accueil, et toutes prennent leur slug.
 */
export function publicPath(slug: string, homePageSlug: string | null | undefined): string {
  return homePageSlug != null && slug === homePageSlug ? "/" : `/${slug}`
}

/**
 * La même adresse, absolue, pour un lien qu'on ouvre dans un onglet.
 *
 * `base` est l'origine du site public (`VITE_WEB_SITE_URL` côté admin).
 * Le slash final y est retiré : `https://exemple.fr/` + `/` aurait donné
 * `https://exemple.fr//`, que certains serveurs redirigent et d'autres non.
 */
export function publicUrl(
  base: string,
  slug: string,
  homePageSlug: string | null | undefined,
): string {
  return `${base.replace(/\/+$/, "")}${publicPath(slug, homePageSlug)}`
}
