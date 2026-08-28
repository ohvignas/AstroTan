# syntax=docker/dockerfile:1.7
# Image du site public (spec §7). Contexte de build : la RACINE du dépôt
# (`docker compose` le fait avec `context: ..`), pas `apps/web` — c'est un
# monorepo pnpm, et le lockfile qui fait foi vit à la racine.
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack active la version de pnpm épinglée par le `packageManager` de la
# racine. Ne jamais `npm i -g pnpm` ici : ce serait une seconde source de
# vérité pour la version du gestionnaire de paquets.
RUN corepack enable
WORKDIR /repo

FROM base AS build
# L'arbre entier, filtré par `.dockerignore`. Un `COPY package.json`
# préalable améliorerait le cache de couche, mais énumérer les manifestes
# d'un monorepo dont les packages bougent est précisément la liste qui
# casse ; le lockfile suffit à rendre l'installation déterministe.
COPY . .
RUN pnpm install --frozen-lockfile

# Publique, jamais secrète : Vite/Astro fige cette valeur dans le bundle
# (`import.meta.env.PUBLIC_CONVEX_URL`, apps/web/src/lib/convexClient.ts),
# y compris dans la sortie SSR. Conséquence à connaître : changer d'URL de
# déploiement Convex impose de reconstruire l'image, pas de redémarrer le
# conteneur. Le déploiement visé doit être joignable PENDANT ce build —
# `src/pages/index.astro` est prérendu et interroge Convex (spec §7, et
# c'est pourquoi `convex deploy` précède le build des images en CI).
ARG PUBLIC_CONVEX_URL
ENV PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL
RUN test -n "$PUBLIC_CONVEX_URL" || (echo "PUBLIC_CONVEX_URL build-arg is required" && exit 1)
RUN pnpm --filter @astrotan/web build

# `pnpm deploy` reconstruit un arbre autonome avec les seules dépendances
# de production de ce package. `--legacy` est obligatoire depuis pnpm 10 :
# sans lui la commande refuse de tourner sur un workspace qui n'a pas
# `inject-workspace-packages=true` (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE),
# et ce dépôt ne l'active pas — ce réglage change le mode d'installation de
# tout le monorepo pour un besoin qui n'existe qu'ici.
RUN pnpm deploy --legacy --filter @astrotan/web --prod /out
# `deploy` copie les sources du package, pas ses artefacts de build
# (`dist/` est ignoré) : le résultat du build se copie explicitement.
RUN cp -r apps/web/dist /out/dist

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321
WORKDIR /app
# `node` est l'utilisateur non-root fourni par l'image officielle (uid 1000).
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4321
# Le mode standalone de @astrojs/node sert les pages prérendues ET exécute
# les routes on-demand depuis ce même processus (spec §6.1).
CMD ["node", "./dist/server/entry.mjs"]
