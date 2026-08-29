// La navigation du site, écrite en code.
//
// Portée de `src/config/nav.config.ts` d'`astro-emdash`, débarrassée des
// clés de traduction : le site est en français et n'a qu'une langue, donc un
// libellé est un libellé.
//
// Ce template n'a pas de constructeur de menu dans l'administration, et c'est
// délibéré : une navigation stockée en base et une navigation écrite dans le
// balisage sont deux sources de vérité pour la même chose, et c'est le
// balisage qui doit rendre.

export interface NavItem {
  href: string
  label: string
}

/** Navigation principale, dans l'en-tête. */
export const mainNav: NavItem[] = [
  { href: "/", label: "Accueil" },
  { href: "/fonctionnalites", label: "Fonctionnalités" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
]

/** Colonnes du pied de page. La colonne « Social » vient de Convex. */
export const footerNav = {
  offre: [
    { href: "/fonctionnalites", label: "Fonctionnalités" },
    { href: "/tarifs", label: "Tarifs" },
  ] as NavItem[],
  site: [
    { href: "/blog", label: "Blog" },
    { href: "/contact", label: "Contact" },
  ] as NavItem[],
  /**
   * Les pages réglementaires. Dans le pied de page et nulle part ailleurs :
   * la loi demande qu'elles soient accessibles depuis toutes les pages, pas
   * qu'elles concurrencent la navigation principale.
   *
   * Chacune est un couple fichier + ligne publiée, comme toute page de ce
   * site — sans sa ligne dans l'administration, le lien mène à un 404.
   */
  legal: [
    { href: "/mentions-legales", label: "Mentions légales" },
    { href: "/confidentialite", label: "Confidentialité" },
    { href: "/cookies", label: "Cookies" },
  ] as NavItem[],
}

/**
 * Dépôt du projet, affiché dans l'en-tête et le pied de page.
 *
 * À REMPLIR : la valeur par défaut pointe le dépôt du template AstroTan
 * lui-même. Sur un site en production, remplacez-la par votre propre dépôt
 * (si vous en publiez un), ou retirez le badge GitHub de `Header.astro` et
 * `Footer.astro` si vous n'en publiez pas — un lien vers un dépôt qui n'est
 * pas le vôtre n'a rien à faire sur votre site. Couvert par le même
 * garde-fou que `legal.ts` et `facts.ts` (voir
 * `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` dans `legal.ts`).
 */
export const REPO_URL = "https://github.com/OhVignas/AstroTan"
