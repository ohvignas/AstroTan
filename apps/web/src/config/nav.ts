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
  { href: "/a-propos", label: "À propos" },
  { href: "/services", label: "Services" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
]

/** Colonnes du pied de page. La colonne « Social » vient de Convex. */
export const footerNav = {
  offre: [
    { href: "/services", label: "Services" },
    { href: "/tarifs", label: "Tarifs" },
  ] as NavItem[],
  site: [
    { href: "/a-propos", label: "À propos" },
    { href: "/blog", label: "Blog" },
    { href: "/contact", label: "Contact" },
  ] as NavItem[],
}

/** Dépôt du projet, affiché dans l'en-tête et le pied de page. */
export const REPO_URL = "https://github.com/OhVignas/AstroTan"
