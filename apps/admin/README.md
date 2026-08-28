# AstroTan — Administration

Dashboard TanStack Start (React 19, shadcn/ui) pour le CMS AstroTan. Backend
Convex partagé avec `packages/backend` (schéma, fonctions, Better Auth).

Voir [`CLAUDE.md`](../../CLAUDE.md) à la racine du repo pour la structure du
projet et les invariants, et
[`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../../docs/superpowers/specs/2026-08-27-astrotan-design.md)
pour le schéma de données et la stratégie de sécurité.

## Développement

Depuis la racine du repo (pnpm workspaces + Turborepo) :

```bash
pnpm install
pnpm --filter @astrotan/admin dev   # sert sur http://localhost:3001
```

Nécessite un backend Convex local en cours d'exécution (`packages/backend`)
et les variables d'environnement décrites dans `.env.example`.

## Composants shadcn/ui

Pour ajouter un composant :

```bash
npx shadcn@latest add button
```

Les composants sont placés dans `src/components/ui/` et s'importent avec
l'alias `@/` :

```tsx
import { Button } from "@/components/ui/button";
```
