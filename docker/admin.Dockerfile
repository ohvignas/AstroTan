# syntax=docker/dockerfile:1.7
# Image du dashboard (spec §7). Même socle et mêmes règles que
# docker/web.Dockerfile — lire ses commentaires pour corepack, le `COPY .`
# et `pnpm deploy --legacy`.
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile

# Trois valeurs publiques, figées dans le bundle client par Vite. Aucune
# n'est un secret : URL du déploiement Convex, URL de son site HTTP, et
# origine publique du site Astro. Le bouton « Prévisualiser » ouvre cette
# dernière à la VRAIE URL de la page — `/{slug}?t={token}`, pas une route
# `/preview/...` parallèle : le jeton signe le slug (CLAUDE.md, invariant 2)
# et c'est Convex qui le frappe.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_WEB_SITE_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL \
    VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL \
    VITE_WEB_SITE_URL=$VITE_WEB_SITE_URL
RUN test -n "$VITE_CONVEX_URL" && test -n "$VITE_CONVEX_SITE_URL" && test -n "$VITE_WEB_SITE_URL" \
  || (echo "VITE_CONVEX_URL, VITE_CONVEX_SITE_URL and VITE_WEB_SITE_URL build-args are required" && exit 1)
RUN pnpm --filter @astrotan/admin build

RUN pnpm deploy --legacy --filter @astrotan/admin --prod /out
RUN cp -r apps/admin/dist /out/dist

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# `node dist/server/server.js` ne servirait rien : ce bundle exporte un
# handler `fetch`, pas un serveur (voir serve.mjs). D'où ce wrapper.
CMD ["node", "serve.mjs"]
