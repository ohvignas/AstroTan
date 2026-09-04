---
name: ui-ux-pro-max
description: Use when building or reviewing UI structure, interaction patterns, forms, accessibility, color, typography, spacing, animation or charts — in apps/admin or apps/web. Also use when a screen "doesn't look professional" and the reason is unclear. Pointer skill: the substance lives outside the repository.
---

# Qualité UI/UX — pointeur

**Lire d'abord, en entier :**
`/Users/antoinevigneau/.claude/skills/ui-ux-pro-max/SKILL.md`

Ce fichier est un POINTEUR. Le skill fait ~650 lignes et porte une base
consultable (styles, palettes, appariements de polices, 99 règles UX) via
`scripts/search.py` à côté de lui.

## Ce que le skill apporte

Dix catégories de règles ordonnées par impact. Les quatre premières
décident presque tout :

1. **Accessibilité** (CRITIQUE) — contraste 4.5:1, focus visible, labels
   d'icônes, ordre de tabulation, **la couleur ne porte jamais seule une
   information** ;
2. **Interaction** (CRITIQUE) — retour visuel sous 100 ms, bouton
   désactivé pendant un appel, erreur près du champ ;
3. **Performance** (HAUT) — réserver la place des contenus asynchrones
   (CLS), images en WebP/AVIF, `loading="lazy"` sous la ligne de flottaison ;
4. **Choix de style** (HAUT) — icônes SVG et jamais d'emoji, une seule
   famille d'icônes, **un seul CTA principal par écran**.

La §8 (Formulaires) est celle qu'on rouvre le plus souvent ici : label
visible plutôt qu'un placeholder seul, texte d'aide persistant, validation
au `blur`, message d'erreur qui dit la cause ET la sortie de secours.

## Attention en lisant

Le skill vise surtout l'UI mobile (iOS / Android / React Native) : ses
listes de contrôle parlent de safe areas, de haptique et de cibles 44 pt.
**AstroTan est du web de bureau** (Astro + TanStack Start). Traduire, ne
pas appliquer littéralement — et privilégier la cohérence avec les
composants shadcn/ui déjà en place quand les deux se contredisent.
