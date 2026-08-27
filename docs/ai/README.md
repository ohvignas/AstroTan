# Références IA

Fichiers `llms.txt` vendorisés, rafraîchis par `scripts/refresh-ai-docs.sh`.
Ce sont des **index de documentation**, pas la documentation complète : ils listent
les pages et leurs URLs. Pour lire une page en entier, utiliser le serveur MCP
correspondant ou `WebFetch` sur l'URL listée.

| Fichier | Source | À jour au |
|---|---|---|
| `convex.llms.txt` | https://docs.convex.dev/llms.txt | 2026-08-27 |
| `better-auth.llms.txt` | https://www.better-auth.com/llms.txt | 2026-08-27 |
| `tanstack-start.llms.txt` | https://tanstack.com/start/latest/llms.txt | 2026-08-27 |
| `shadcn.llms.txt` | https://ui.shadcn.com/llms.txt | 2026-08-27 |

**Astro n'a pas de `llms.txt`** — `docs.astro.build/llms.txt` renvoie 404. La doc
Astro passe exclusivement par le serveur MCP `astro-docs`.

## Ordre de consultation

1. **Serveur MCP** du produit concerné — c'est la source vivante.
2. `llms.txt` ci-dessus — pour localiser rapidement la bonne page.
3. `WebFetch` sur l'URL trouvée — pour le détail.

Ne jamais coder une API de mémoire sur cette stack : Astro 7, TanStack Start 1 et
`@convex-dev/better-auth` bougent vite, et la spec (§9) n'épingle pas encore les
versions.
