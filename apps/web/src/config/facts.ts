// Les faits mesurés sur ce dépôt, en un seul endroit.
//
// Ils étaient dupliqués entre l'accueil et la page des fonctionnalités.
// Deux copies de chiffres qui doivent rester exacts, c'est la garantie
// qu'une des deux finira par mentir — et c'est déjà arrivé une fois : la
// page annonçait « 0 octet de JavaScript » longtemps après qu'une bascule
// de thème en eut introduit 1,3 ko.
//
// Règle : quand une de ces valeurs change, on la MESURE avant de l'écrire.
// Les commandes qui les produisent sont notées à côté de chacune.
//
// À REMPLIR (ou À RETIRER) avant un vrai déploiement : `FIGURES` décrit le
// dépôt AstroTan lui-même — « 778 tests », « 1,3 ko de JavaScript » n'ont
// aucun sens sur le site d'un adoptant, qui vend autre chose que ce
// template. `index.astro` et `fonctionnalites.astro`, qui l'affichent, sont
// eux-mêmes des pages de démonstration destinées à être réécrites. Le
// garde-fou de `legal.test.ts` (voir `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`
// dans `legal.ts`) le vérifie : il refuse ces valeurs par défaut dès que ce
// marqueur passe à `false`.

export interface Figure {
  value: string
  label: string
  detail: string
}

export interface StackPiece {
  name: string
  role: string
  icon: string
  why: string
}

/**
 * Mesurés sur le build de production servi par `@astrojs/node`.
 *
 * ```bash
 * pnpm --filter @astrotan/web run build
 * curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w '%{size_download}\n' http://127.0.0.1:4331/
 * ```
 */
export const FIGURES: Figure[] = [
  {
    value: "1,3 ko",
    label: "de JavaScript en tout",
    detail:
      "la seule bascule clair/sombre, en ligne ; aucun framework, aucune hydratation",
  },
  {
    value: "26 ko",
    label: "à la première visite",
    detail:
      "HTML + CSS, compressés ; deux polices variables en plus, mises en cache ensuite",
  },
  {
    value: "778",
    label: "tests automatisés",
    detail: "541 backend, 139 admin, 98 site",
  },
  {
    value: "1",
    label: "commande pour revenir en arrière",
    detail: "le rollback rejoue le pipeline entier sur un sha",
  },

]

/** La pile, et la raison de chaque brique. */
export const STACK: StackPiece[] = [
  {
    name: "Astro 7",
    role: "le site public",
    icon: "lucide:rocket",
    why: "Rendu au serveur, adaptateur Node, zéro JavaScript envoyé par défaut. Les images passent par astro:assets — un PNG de 95 ko sort en WebP de 910 o.",
  },
  {
    name: "TanStack Start",
    role: "le dashboard",
    icon: "lucide:code-2",
    why: "React 19 et shadcn/ui. TanStack Query est délibérément absent : Convex est déjà la couche réactive, et empiler un second cache donnerait deux sources de vérité sur la fraîcheur.",
  },
  {
    name: "Convex",
    role: "les données",
    icon: "lucide:database",
    why: "Un backend typé et réactif partagé par les deux applications. Le site public n'a ni session ni clé d'administration : il n'appelle que des queries publiques qui filtrent les brouillons côté serveur.",
  },
  {
    name: "Better Auth",
    role: "l'authentification",
    icon: "lucide:shield",
    why: "Installation locale, plugin admin, invitations expirables. Le mot de passe est jugé par le même code côté serveur et côté navigateur, pour que la jauge affichée ne mente pas sur ce qui sera accepté.",
  },
  {
    name: "Docker et Traefik",
    role: "l'hébergement",
    icon: "lucide:container",
    why: "Une pile compose sur un VPS, certificats automatiques, healthchecks. Le rollback rejoue le pipeline entier sur un sha — jamais les images seules, parce que le déploiement a aussi remplacé le schéma.",
  },
  {
    name: "Umami",
    role: "l'audience",
    icon: "lucide:bar-chart",
    why: "Auto-hébergé à côté du reste. Aucune donnée ne quitte le serveur, et le coût est écrit franchement : un service et une base de plus à sauvegarder.",
  },
]
