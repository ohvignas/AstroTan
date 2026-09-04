---
name: web-design-guidelines
description: Use when reviewing existing UI code against the Web Interface Guidelines — "review my UI", "check accessibility", "audit this screen", "is this form correct". Use as a review pass after building, not as a design method. Pointer skill: the substance is fetched from the web.
---

# Revue d'interface web — pointeur

**Lire d'abord, en entier :**
`/Users/antoinevigneau/.claude/skills/web-design-guidelines/SKILL.md`

Ce fichier est un POINTEUR. Le skill est court : son contenu réel est
**récupéré sur le réseau à chaque revue**, ce qui est exactement pourquoi
il ne faut pas le recopier ici.

## Comment il marche

1. Récupérer les règles à jour :
   `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
2. Lire les fichiers à relire ;
3. Appliquer toutes les règles récupérées ;
4. Rendre les constats au format `fichier:ligne`, terse.

Ce sont des règles **web de bureau**, donc mieux ajustées à AstroTan que
la liste mobile d'`ui-ux-pro-max`. C'est la revue à passer en dernier,
avant de considérer un écran fini.

## Dans ce dépôt

- Le dépôt teste ses composants au **rendu statique**
  (`renderToStaticMarkup`, `environment: "node"`). Une règle qui parle
  d'un état né d'une frappe (champ vidé, focus) demande de rendre le
  sous-composant seul — voir `ActionsDuChamp` dans
  `apps/admin/src/components/settings-secrets.tsx`.
- Attention aux assertions sur `disabled` : les classes Tailwind de
  shadcn portent déjà `disabled:opacity-50`. Chercher l'attribut
  `disabled=""`, pas la sous-chaîne.
- Le consentement a son propre skill, et il prime : `consent-rgpd`.
  Aucune balise tierce n'entre dans le HTML sans réponse (invariant 9).
