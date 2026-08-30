# syntax=docker/dockerfile:1.7
# Image du service `routeur` (plan « changer de domaine depuis le
# dashboard », tâche 3). Contexte de build : la RACINE du dépôt, comme les
# deux autres images — c'est un monorepo pnpm, et le lockfile qui fait foi
# vit à la racine.
#
# Ce que ce service fait, en entier : il interroge `routing.hotes`, compare,
# et réécrit le fichier que Traefik surveille. Pas de serveur, pas de port,
# pas de socket Docker.
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# esbuild, et pas `tsc` : `services/routeur` importe `estHoteNu` du backend
# par un spécificateur SANS extension (`@astrotan/backend/convex/lib/hoteNu`),
# que seul un bundler sait résoudre vers un `.ts`. `tsc` ne réécrit jamais un
# spécificateur de module : il émettrait un `import` que Node ne saurait pas
# suivre, et le conteneur mourrait au démarrage sur `ERR_MODULE_NOT_FOUND`.
#
# Le bundle est aussi ce qui donne à l'étape suivante son unique propriété
# intéressante : UN fichier, aucun `node_modules`. Un service qui décide du
# routage public n'embarque ainsi aucune dépendance qu'on n'a pas lue.
RUN pnpm --filter @astrotan/routeur build

# Ni `base` ni pnpm ici : rien à installer, donc rien à garder.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Les trois réglages qui ont un défaut raisonnable, posés ICI plutôt que
# laissés au seul code : c'est l'endroit où l'image se définit, et
# `scripts/check-env-wiring.mjs` compare ce que le service LIT à ce que
# quelqu'un POSE. Un `process.env` avec un défaut en dur et déclaré nulle
# part est exactement la moitié manquante que ce garde-fou existe pour
# attraper.
#
# `ROUTES_FICHIER` — dans le volume que Traefik monte en lecture seule.
# `INTERVALLE_MS` — l'intervalle entre deux passes, donc aussi le délai
#   entre un changement de domaine et sa prise d'effet : deux passes
#   concordantes sont exigées avant toute écriture (l'anti-battement qui
#   protège le quota Let's Encrypt).
# `TRAEFIK_TLS` — où frapper pour savoir si un hôte sert déjà un
#   certificat. Le conteneur Traefik directement, jamais l'adresse publique
#   du VPS : le retour du trafic sur soi-même n'est pas garanti.
ENV ROUTES_FICHIER=/dynamique/routes.yml \
    INTERVALLE_MS=30000 \
    TRAEFIK_TLS=traefik:443
WORKDIR /app
# `node` est l'utilisateur non-root fourni par l'image officielle (uid 1000).
#
# Il doit pouvoir ÉCRIRE dans le volume monté sur `/dynamique` : un volume
# nommé vide hérite des droits du point de montage de l'image, d'où ce
# répertoire créé et donné à `node` AVANT le montage. Sans lui, la première
# écriture échoue en `EACCES` — proprement journalisée par le service, mais
# le routage ne suivrait plus jamais.
RUN mkdir -p /dynamique && chown node:node /dynamique
COPY --from=build --chown=node:node /repo/services/routeur/dist/routeur.mjs ./routeur.mjs
USER node
# Aucun `EXPOSE`, et c'est la moitié de la définition de ce service : il
# n'écoute rien. Il appelle Convex, il écrit un fichier.
#
# Aucun healthcheck non plus, faute d'une question à poser : un service sans
# port n'a rien à répondre, et un `test:` qui inspecterait le fichier
# dirait la santé de la DERNIÈRE écriture, pas celle du processus. La boucle
# journalise chaque passe ; `docker compose logs routeur` est la vraie
# réponse, et `restart: unless-stopped` couvre le reste.
CMD ["node", "./routeur.mjs"]
