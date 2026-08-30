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

# `"true"` charge en plus `recorder.js` — Replays et Heatmaps. Éteint par
# défaut, et séparé des deux variables ci-dessus parce que ce n'est pas la
# même promesse : compter une visite n'est pas rejouer ce qu'une personne a
# fait sur la page. Voir README §13.10.
ARG PUBLIC_UMAMI_RECORDER
ENV PUBLIC_UMAMI_RECORDER=$PUBLIC_UMAMI_RECORDER

# Les identifiants de traceurs soumis à consentement, lus par
# `src/components/consent/ConsentBanner.astro` et
# `src/components/consent/GoogleConsentMode.astro`. Mêmes propriétés que les
# trois variables Umami ci-dessus, et pour les mêmes raisons : publiques par
# construction, figées AU BUILD, facultatives.
#
# « Facultatives » ne veut pas dire « sans conséquence ». Tant qu'aucune des
# deux n'est posée, `shouldAskConsent()` rend `false` : le bandeau ne
# s'affiche jamais et `/cookies` affiche « Aucun ». C'est le comportement
# légitime d'un site sans traceur — et c'est exactement ce qui rend leur
# absence indétectable à l'œil. Avant cette version, elles n'étaient ni ici
# ni dans `deploy.yml` : le parcours de consentement entier était
# inatteignable dans l'image livrée, sans qu'aucun symptôme ne le dise.
ARG PUBLIC_META_PIXEL_ID
ENV PUBLIC_META_PIXEL_ID=$PUBLIC_META_PIXEL_ID
ARG PUBLIC_GOOGLE_TAG_ID
ENV PUBLIC_GOOGLE_TAG_ID=$PUBLIC_GOOGLE_TAG_ID

# `WEB_DOMAIN` N'EST PLUS UN BUILD-ARG, et son absence ici est le sujet.
#
# Elle l'était pour `security.allowedDomains` (`apps/web/astro.config.ts`),
# donc figée dans l'image : changer de domaine imposait de reconstruire.
# La reconnaissance de l'hôte se fait maintenant au RUNTIME
# (`apps/web/src/lib/allowedDomains.ts`, qui lit la query `routing.hotes`),
# et plus aucun domaine n'entre dans cette image. C'est ce qui rend
# `/settings/domaine` possible.
#
# Le `RUN test -n "$WEB_DOMAIN"` qui gardait ce build est parti avec elle :
# il protégeait contre une image construite sans domaine, et il n'y a plus
# de domaine à construire. Ce qu'il empêchait — un déploiement qui ne
# reconnaît aucun hôte, donc un seul seau de limitation de débit pour tout
# Internet — est repris par `${ROUTING_SECRET:?…}` dans
# `docker/docker-compose.yml` : sans ce secret, le conteneur ne démarre pas.
# Le refus tombe au même endroit qu'avant, au déploiement, jamais dans le
# trafic.
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
# L'entrée standalone de @astrojs/node, lancée directement : elle sert les
# pages prérendues ET exécute les routes on-demand depuis le même processus
# (spec §6.1), et elle est PID 1, donc SIGTERM lui parvient sans relais.
#
# Ce `CMD` pointait `verifier-domaine.mjs`, un préambule qui comparait le
# domaine figé au build à celui servi au runtime et refusait de démarrer sur
# divergence. Les deux valeurs n'existent plus : rien n'est figé au build, et
# la divergence qu'il mesurait est devenue le fonctionnement normal — un
# domaine change sans qu'on reconstruise.
CMD ["node", "./dist/server/entry.mjs"]
