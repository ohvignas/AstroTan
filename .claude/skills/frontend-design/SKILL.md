---
name: frontend-design
description: Use when creating or reshaping any UI in this repo — a new page of apps/web, a screen or component of apps/admin, or a visual direction (palette, typography, layout, motion). Use before writing markup, not after. Pointer skill: the substance lives outside the repository.
---

# Direction visuelle — pointeur

**Lire d'abord, en entier :**
`/Users/antoinevigneau/.agents/skills/frontend-design/SKILL.md`

Ce fichier est un POINTEUR. Il ne recopie pas le skill : une copie
divergerait de l'original au premier changement, et personne ne saurait
laquelle fait foi.

## Ce que le skill apporte

Une méthode pour éviter le rendu « templaté » : ancrer le design dans le
sujet, choisir un système de tokens (4–6 couleurs nommées, 2+ rôles
typographiques, un concept de mise en page, UN élément signature), puis
**critiquer ce plan avant de coder** — et réviser toute partie qui
ressemble au défaut qu'on produirait pour n'importe quel brief.

Il nomme trois looks que l'IA produit par défaut (crème + serif +
terracotta ; noir + accent acide ; broadsheet à filets). Les reconnaître
est la moitié du travail.

## Ce qui prime dans AstroTan

- **Le brief gagne.** Si Antoine décrit une direction, elle passe avant
  toute préférence du skill.
- **`design.md` du dépôt est la référence de style** (règle utilisateur).
  Le skill sert à décider ce qui n'y est pas tranché.
- **`apps/admin` n'est pas un terrain d'expression.** C'est un outil :
  la cohérence avec les écrans voisins (shadcn/ui, `SettingsGroup`,
  `Field`, `size="sm"`) prime sur l'audace. Garder la boldness pour
  `apps/web`.
- **Une page d'`apps/web` EST son fichier `.astro`** (invariant 5) : la
  mise en page et les mots s'écrivent en code, jamais en base.
