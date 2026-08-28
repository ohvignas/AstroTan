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

# La mesure d'audience. Publiques par construction — elles apparaissent dans
# le source de chaque page de tout site mesuré par Umami — et figées ici par
# Astro AU BUILD : les poser dans le `.env` du VPS ne ferait rien, le bundle
# est déjà écrit.
#
# Facultatives, et le rester est le point : sans elles, `Analytics.astro`
# n'émet aucune balise et le site ne parle à personne. Un adoptant qui ne
# veut pas de mesure n'a rien à désactiver.
ARG PUBLIC_UMAMI_URL
ENV PUBLIC_UMAMI_URL=$PUBLIC_UMAMI_URL
ARG PUBLIC_UMAMI_WEBSITE_ID
ENV PUBLIC_UMAMI_WEBSITE_ID=$PUBLIC_UMAMI_WEBSITE_ID
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
#
# Le `rm -rf` n'est pas cosmétique. Le fait que `pnpm deploy` ignore `dist/`
# dépend du `.gitignore` qui s'applique au package, et ce comportement a déjà
# changé d'une version de pnpm à l'autre (pnpm#7286). Si une version copie
# `dist/`, la cible existe, et `cp -r src dst` copie ALORS *dans* la cible :
# on obtient `/out/dist/dist`. L'image se construit sans erreur et le `CMD`
# échoue au démarrage, sur un chemin qui n'existe pas. Effacer d'abord rend
# la commande idempotente quel que soit ce que `deploy` a laissé.
RUN rm -rf /out/dist && cp -r apps/web/dist /out/dist

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
