---
name: deploy-vps
description: Use when deploying, operating or repairing the AstroTan stack on its Hostinger VPS — Docker images, Traefik, Let's Encrypt certificates, GHCR, the deploy and rollback GitHub workflows, the VPS `.env`, shared HMAC secrets, or the Umami database backup. Triggers include "déployer", "mettre en production", "mettre à jour le VPS", "rollback", "revenir en arrière", "le site est down", "502", "Traefik", "certificat", "Let's Encrypt", "ACME", "sauvegarde", "backup", "GHCR", "docker compose", "secrets", "faire tourner une clé", "première mise en service".
---

# Exploitation — VPS, Traefik, rollback

## Le modèle, en une phrase

**Un déploiement est un `sha` de commit rejoué en trois temps, dans cet
ordre : `convex deploy`, puis le build et le push des trois images sur GHCR
(`web`, `admin`, `routeur`),
puis `docker compose up` sur le VPS avec `IMAGE_TAG=<sha>`.** L'ordre n'est
pas cosmétique : `apps/web` prérend `src/pages/index.astro`, qui interroge
Convex **pendant** `astro build`. Construire l'image avant `convex deploy`
ferait lire un schéma qui n'existe pas encore.

Rien d'autre ne tourne sur cette machine que le contenu de `docker/`. Le
workflow y `rsync --delete` ce répertoire à chaque déploiement : **tout
fichier ajouté à la main sur le VPS disparaît au déploiement suivant**, à
la seule exception de `~/astrotan/.env`, exclu du `rsync`.

## Où est l'autorité

Ce skill est un point d'entrée et une liste de pièges. **La procédure
détaillée fait autorité dans [`docker/README.md`](../../../docker/README.md)**
— 14 sections, écrites dans l'ordre où on les exécute. N'y répondez pas de
mémoire : ce fichier bouge à chaque lot.

| Question | Fichier |
|---|---|
| Que fait chaque variable, et que casse-t-elle si elle est fausse | `docker/.env.example` — la référence, commentée ligne à ligne |
| Ce qui tourne sur le VPS | `docker/docker-compose.yml` |
| Vérifier les images sans VPS | `docker/docker-compose.local.yml` |
| Le pipeline | `.github/workflows/deploy.yml`, `rollback.yml` |
| La mise en service en une commande | `scripts/bootstrap.mjs` (`pnpm bootstrap`) |
| Pourquoi le rollback rejoue tout | spec §7, invariant 7 de `CLAUDE.md` |

**État réel, à dire franchement quand on vous le demande** : le lot 5 (infra)
est livré, mais la spec note que **le pipeline n'a jamais tourné contre un
vrai VPS** (§10). Tout ce qui suit est vérifié en local, dans les workflows
et dans les fichiers — pas contre une machine de production. Les sections
« pièges déjà payés » sont, elles, sourcées dans l'historique du dépôt.

## Mise en service — l'ordre, et rien d'autre

`pnpm bootstrap` fait les étapes 2 à 4. Il ne fait **pas** les autres, et
c'est délibéré.

```bash
pnpm bootstrap --dry-run   # crée .env.deploy, montre chaque action sans rien faire
$EDITOR .env.deploy        # le SEUL fichier qu'un humain remplit
pnpm bootstrap             # distribue vers Convex, GitHub, les .env locaux, .env.vps
```

Puis, dans cet ordre, et l'ordre est la partie qui compte :

1. **GHCR d'abord — prérequis bloquant.** Les packages GHCR sont **privés
   par défaut**. Soit les rendre publics (*Packages* → `astrotan-web` →
   *Package settings* → *Change visibility*), soit authentifier le VPS une
   fois avec un PAT `read:packages` :
   ```bash
   ssh <user>@<host>
   echo <PAT> | docker login ghcr.io -u <compte-github> --password-stdin
   ```
   Les packages n'existent qu'après le premier `Deploy` réussi : le premier
   déploiement échouera donc au `pull` de toute façon. C'est attendu.

2. **Le DNS ensuite, et vérifié — pas supposé.**
   ```bash
   dig +short example.com        # doit rendre l'IP DU VPS
   dig +short admin.example.com
   dig +short stats.example.com
   ```
   Si `dig` rend autre chose, **ne démarrez pas**. Le cas fréquent n'est pas
   la faute de frappe : c'est **Cloudflare en mode proxy** (nuage orange) —
   un VPS Hostinger est souvent livré avec son DNS chez Cloudflare. Le
   challenge HTTP-01 n'atteint alors jamais Traefik, et le certificat n'est
   jamais émis.

3. **Le CA de staging au premier essai.** Décommenter dans
   `~/astrotan/.env` :
   ```bash
   ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
   ```
   Let's Encrypt plafonne à **5 certificats par jeu d'identifiants tous les
   7 jours**, sans remise à zéro possible et sans recours. Un premier essai
   raté sur la production coûte une semaine sur ce domaine.

4. **Le `.env` du VPS**, copié à la main — jamais écrit à distance par un
   script :
   ```bash
   ssh <user>@<host> 'mkdir -p ~/astrotan'
   scp .env.vps <user>@<host>:~/astrotan/.env
   ssh <user>@<host> 'chmod 600 ~/astrotan/.env'
   ```
   C'est le seul fichier que le pipeline n'écrase jamais, donc le seul point
   de vérité de la machine. Le remplir depuis l'extérieur en ferait la copie
   périmée d'un fichier resté sur le poste de dev.

5. **Repasser en production** une fois le staging vert : recommenter
   `ACME_CA_SERVER`, **supprimer le volume ACME** (Traefik considère les
   certificats de staging valides et ne les remplacera pas seul), puis
   relancer :
   ```bash
   ssh <user>@<host> 'cd ~/astrotan && docker compose down && docker volume rm astrotan_acme'
   ```
   Après cela, **ne supprimez plus jamais ce volume « pour repartir
   propre »** : sa persistance est ce qui protège le quota.

6. **Pousser sur `main`.**

## Rollback

```
Actions → Rollback → Run workflow → sha complet, 40 caractères
```

Le sha à donner se lit sans ouvrir GitHub :

```bash
ssh <user>@<host> 'cat ~/astrotan/DEPLOYED_SHA'
```

Le workflow rejoue **le pipeline entier** sur l'arbre de ce sha :
`convex deploy` depuis cet arbre, vérification que **toutes** les images de ce
sha existent encore sur GHCR (`docker manifest inspect` — échouer là plutôt
qu'à mi-chemin d'un `compose up` ; la liste vient de
`scripts/rollback-images.mjs`, dérivée du compose de ce sha), `rsync` du
`docker/` **de ce sha**, puis `compose up -d --wait` avec `IMAGE_TAG=<sha>`.

### Ce que le rollback ne rattrape pas

- **Un `IMAGE_TAG` changé à la main sur le VPS n'est pas un rollback.**
  C'est le raccourci qui a l'air équivalent : il repointe les conteneurs sur
  d'anciennes images en laissant en place les functions et le schéma Convex
  que le déploiement fautif a déjà remplacés. Frontend d'hier, backend
  d'aujourd'hui — la seule configuration que personne n'a jamais testée.
- **Il n'est sûr que d'un cran**, et seulement si la discipline
  expand / migrate / contract a été tenue. Redéployer les functions d'un sha
  antérieur à une phase *contract* les fait lire des colonnes supprimées.
  **`contract` est la seule des trois étapes qui rend un rollback dangereux** :
  c'est la seule destructive.
- **Il ne rattrape pas les données.** Le contenu vit dans Convex, qui a ses
  propres sauvegardes ; les statistiques d'audience vivent dans le volume
  `astrotan_umami-db`, qui n'a que la vôtre.
- **Il ne rattrape pas une valeur figée au build.** Voir la section
  suivante : ce qui est dans le bundle ne bouge pas au redémarrage.

## Secrets — quatre lieux, et deux moments

Quatre destinations qui **ne peuvent pas se lire entre elles**. C'est la
raison d'être de `pnpm bootstrap`, qui distribue un unique `.env.deploy`
vers les trois autres.

| Lieu | Ce qui y vit | Posé par |
|---|---|---|
| `.env.deploy` (poste de dev, `0600`, gitignoré) | la seule saisie humaine | vous |
| Secrets GitHub Actions | build-args + accès SSH et `CONVEX_DEPLOY_KEY` | `gh secret set` |
| `~/astrotan/.env` (VPS) | ce que les conteneurs lisent **au runtime** | `scp .env.vps` |
| Déploiement Convex | ce que le backend lit | `npx convex env set` |

### Build ou runtime — la distinction qui fait perdre des heures

| Valeur | Lue | Conséquence |
|---|---|---|
| `PUBLIC_CONVEX_URL`, `PUBLIC_UMAMI_*` | **au build** de l'image `web` | Astro les fige dans le bundle, sortie SSR comprise. **Les poser dans le `.env` du VPS ne fait rien.** Changer de déploiement Convex impose de **reconstruire l'image**, pas de redémarrer le conteneur. |
| `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_WEB_SITE_URL` | **au build** de l'image `admin` | idem, figées par Vite dans `src/router.tsx`. |
| `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | **aussi au runtime** | `src/lib/auth-server.ts` les relit par `process.env`. **Deux sources de vérité, et rien ne détecte leur divergence** : le dashboard s'affiche normalement et l'authentification tombe. Après tout changement d'URL Convex : secrets GitHub **et** `.env` du VPS, puis redéploiement. |
| `PREVIEW_SECRET`, `REVALIDATE_SECRET` | runtime (`web`) **et** Convex | clés HMAC vérifiées des deux côtés d'une frontière. N'ont de sens qu'**identiques**. |
| `LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET` | runtime (`web`) **et** Convex | même motif que ci-dessus, ajoutés au lot 7. |

**Aucun secret ne passe jamais en build-arg.** Vite et Astro inlinent les
build-args dans le bundle : un secret qui passerait là serait lisible dans
l'image. Seules des valeurs publiques y transitent — le préfixe `PUBLIC_`
ou `VITE_` est la promesse, pas une convention de nommage.

### Ce qu'une divergence produit, précisément

- **`PREVIEW_SECRET` divergent** — tout jeton d'aperçu est rejeté par la
  première des deux barrières. Le bouton « Prévisualiser » ne rend qu'une
  erreur. Panne franche, immédiatement visible.
- **`REVALIDATE_SECRET` divergent** — l'action `drain` de Convex POSTe
  `${WEB_SITE_URL}/api/revalidate`, l'endpoint compare en temps constant et
  refuse. `drain` réessaie avec backoff puis marque `failed` après
  6 tentatives. **Rien ne tombe** : les pages publiées restent périmées
  jusqu'à expiration du `maxAge`. C'est la panne la plus discrète du
  système, et la seule chose qui la signale est l'état de publication dans
  le dashboard.
- **`LEAD_SUBMIT_SECRET` absent** — `/api/contact` renvoie
  `/contact?erreur=indisponible` sans rien écrire. Le refus est délibéré :
  un déploiement sans secret refuse, il ne laisse jamais passer.

### Faire tourner une clé HMAC

Générer une fois, poser la même valeur des deux côtés **dans la même
fenêtre**, jamais d'un seul côté :

```bash
openssl rand -hex 32
pnpm --filter @astrotan/backend exec convex env set PREVIEW_SECRET <valeur>
ssh <user>@<host> '$EDITOR ~/astrotan/.env'   # puis docker compose up -d
```

`pnpm bootstrap` affiche une **empreinte SHA-256 courte** de chaque clé, sans
jamais en révéler la valeur : c'est ce qui permet de vérifier d'un coup d'œil
que les côtés portent bien la même. Une divergence ne peut venir que d'une
rotation faite à la main d'un seul côté.

## Sauvegarde

Le volume `astrotan_umami-db` est le **seul volume applicatif du projet** :
le contenu vit dans Convex, les certificats se réémettent, les statistiques
d'audience n'existent qu'ici.

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose exec -T umami-db \
  pg_dump -U umami umami | gzip' > umami-$(date +%F).sql.gz
```

Restauration :

```bash
gunzip -c umami-<date>.sql.gz | ssh <user>@<host> \
  'cd ~/astrotan && docker compose exec -T umami-db psql -U umami umami'
```

**Ne jamais lancer `docker compose down -v` sur ce VPS** : `-v` détruit ce
volume et le volume ACME. `down` seul suffit à arrêter la pile.

Une montée de version d'Umami applique des migrations Prisma au premier
démarrage : **faire le dump avant**. Un retour arrière se fait par
restauration du dump, jamais par un retour au tag précédent — une base
déjà migrée n'est plus lisible par l'ancienne version.

## Les pièges déjà payés

Chacun a été commis dans ce dépôt. Le commit est cité pour qu'on puisse
vérifier plutôt que croire.

### `sharp` non déclaré — toutes les images en 500, et rien ne le dit
*(`a49daf9`)* — `astro:assets` route chaque image optimisée par `/_image`,
et le serveur Node n'a **aucun service d'image sans `sharp`**, qui n'était
déclaré ni dans `apps/web/package.json` ni dans l'image Docker. Le site se
construisait, les tests passaient, les pages s'affichaient ; seules les
images répondaient 500, et personne ne l'a vu jusqu'à ce qu'un logo entre
dans l'en-tête. **Leçon générale** : une dépendance runtime que seul un
sous-système utilise ne se manifeste ni au build ni dans les tests.

### Un build-arg qui n'existe nulle part — la moitié écrivante branchée sur rien
*(`25b0b43`)* — la lecture des statistiques était câblée de bout en bout,
mais `web.Dockerfile` ne déclarait aucun `ARG PUBLIC_UMAMI_*` et `deploy.yml`
n'en passait aucun. Toute image de production aurait été construite sans le
script de mesure ; le dashboard aurait affiché des zéros pour toujours sans
que rien ne dise pourquoi. `.env.example` les décrivait pourtant comme des
build-args — **aucun build ne les acceptait**.
**Une variable `PUBLIC_*` se vérifie sur trois lignes, pas une** : le `ARG`
et le `ENV` du Dockerfile, le `build-args:` du workflow, le secret GitHub.

### `astro dev` ne remplit pas `process.env`
*(`6ac1723`)* — `astro dev` charge les variables `PUBLIC_` dans
`import.meta.env` et ne met **rien** dans `process.env`. Le formulaire de
contact répondait donc « envoi momentanément indisponible » sur localhost
alors qu'il fonctionnait sur le build de production. Le script `dev` passe
désormais par `node --env-file-if-exists=.env.local` — `--if-exists` et non
`--env-file`, parce qu'un dépôt fraîchement cloné n'a pas ce fichier et
`pnpm dev` doit démarrer quand même.

### `pkill -f "astro dev"` rate le processus
*(`6ac1723`)* — il s'appelle `node …/astro.mjs dev`. La commande qui marche
est `astro dev stop`. Un serveur qu'on croit tué et qui tourne encore fait
attribuer au code un comportement qui vient d'un ancien processus.

### Traefik : un fichier de configuration statique fait taire toutes les variables
*(`3ec6f01`)* — la chaîne de loaders est **File → Flag → Env**, premier
servi, **sans fusion**. Toute la configuration statique vit donc dans le bloc
`environment:` du service `traefik`. **Ne jamais ajouter de `traefik.yml`, ni
de `command:`** : un seul flag fait gagner le FlagLoader et supprime en
silence toutes les variables `TRAEFIK_*` — donc ACME, le provider Docker et
la redirection 80 → 443. Vérifié : `TRAEFIK_LOG_LEVEL=DEBUG` plus un flag
donne zéro ligne `DBG`.

### `docker compose up -d` rend la main avant les healthchecks
*(`7ed2fc3`, `948e798`)* — un conteneur qui démarre et meurt aussitôt
laissait le job **vert**. D'où `--wait` (compose sort en 1 sur
`container <nom> is unhealthy`) et `--wait-timeout 180` : en
`restart: unless-stopped`, un conteneur en boucle de crash repart à chaque
fois dans son `start_period` sans jamais se stabiliser en `unhealthy`, et
`--wait` sans plafond tiendrait le verrou de concurrence jusqu'au timeout de
job GitHub (6 h).

### `cp -r dist /out/dist` donne `/out/dist/dist`
*(`7ed2fc3`)* — quand `pnpm deploy` a déjà produit un `dist`, `cp -r` copie
**dedans**. Comportement dépendant du `.gitignore` qui s'applique et variable
selon les versions de pnpm. L'image se construit sans erreur, le `CMD` échoue
au démarrage. Corrigé par un `rm -rf` préalable.

### Les caches de build GHA s'écrasaient l'un l'autre
*(`7ed2fc3`)* — les deux images utilisaient le scope `type=gha` par défaut.
Scopés `deploy-web` / `deploy-admin`, et `ci-admin` pour la PR.

### Un secret interpolé dans un corps `run:` est substitué textuellement
*(`7ed2fc3`)* — tous les `${{ … }}` sont sortis des `run:` vers des blocs
`env:` de l'étape, relus en `"$VAR"` — **y compris `inputs.sha` du rollback**,
qui est tapé à la main par un opérateur.

### `pnpm` épinglé, et ce n'est pas cosmétique
Les versions **11.19.0 à 11.23.x** symlinkent les dépendances workspace vers
le monorepo source au lieu de les copier, ce qui casse
`pnpm deploy --legacy --prod /out`. Le `COPY --from=build /out` emporte des
liens pendants, **l'image se construit sans la moindre erreur**, et le
conteneur meurt au démarrage sur `Cannot find module`.
[pnpm#13754](https://github.com/pnpm/pnpm/issues/13754). Corollaire : les
Dockerfiles font `RUN corepack enable`, ce qui suppose **Node ≤ 24** —
corepack est retiré de Node à partir de la 25. **Toute montée de version de
pnpm ou de Node se vérifie par une construction d'image réelle**, jamais par
un `pnpm install` vert ni par la CI.

### `convex dev` exige un terminal interactif
Il ne tourne pas dans un job non interactif. Le mode anonyme local
(« Start without an account ») évite toute authentification de compte.

### Le déploiement n'est pas sans coupure, et c'est assumé
`docker compose up -d` **recrée** les conteneurs dont l'image a changé.
Entre l'arrêt de l'ancien et le passage au vert du healthcheck du nouveau,
Traefik n'a plus de backend et rend des **502** — quelques secondes. Ce n'est
pas une omission : un rolling update naïf ferait cohabiter deux conteneurs
portant **les mêmes labels Traefik**, donc deux backends pour un routeur, et
échangerait quelques secondes de 502 francs contre une fenêtre de 404 et de
502 intermittents.

## Dérives constatées dans l'arbre actuel

Vérifiées en lisant les fichiers, pas rapportées. À traiter avant de croire
qu'un premier déploiement va aboutir — chacune est le **même motif** que
`25b0b43` : une variable documentée quelque part, consommée nulle part.

- **`LEAD_SUBMIT_SECRET` et `CONSENT_LOG_SECRET` ne sont dans aucun service
  du compose.** `apps/web/src/pages/api/contact.ts` et `api/consent.ts` les
  lisent par `process.env` au runtime ; `docker-compose.yml` ne déclare que
  `PREVIEW_SECRET` et `REVALIDATE_SECRET` dans `web`. En production le
  formulaire de contact répondrait `?erreur=indisponible` sur chaque envoi,
  et `/api/consent` renverrait 204 sans jamais rien enregistrer.
  `docker/.env.example` dit déjà de le faire (« Le déclarer dans le service
  `web` du compose ») — ce n'est pas fait.
- **`PUBLIC_META_PIXEL_ID` et `PUBLIC_GOOGLE_TAG_ID` n'ont ni `ARG` dans
  `web.Dockerfile` ni `build-args:` dans `deploy.yml`.** Exactement le défaut
  de `25b0b43`, sur d'autres variables.
- **`pnpm bootstrap` n'écrit pas les quatre variables `UMAMI_*` dans
  `.env.vps`**, alors que le compose les exige en `${VAR:?…}`. Panne franche
  au premier `compose up`, en nommant la variable — le bon mode d'échec, mais
  au pire moment.
- **`docker/README.md` §4 et §7 parlent de « sept variables » et « neuf
  secrets »** ; `.env.example` en porte treize et `deploy.yml` référence
  douze secrets. Les compter avant de les citer :
  ```bash
  grep -oh 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u
  ```
  Treize lignes aujourd'hui, dont `GITHUB_TOKEN` que GitHub fournit seul :
  **douze à poser**.

## La vérification qui compte

Celles qui prouvent, séparées de celles qui rassurent.

```bash
# 1. Le certificat est-il le bon ? (pas « y a-t-il un cadenas »)
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -issuer -dates
#    l'émetteur ne doit PAS contenir « (STAGING) »

# 2. Qu'est-ce qui tourne, exactement ?
ssh <user>@<host> 'cat ~/astrotan/DEPLOYED_SHA'
ssh <user>@<host> 'cd ~/astrotan && docker compose ps'

# 3. Le site répond, et la redirection est en place
curl -sI https://example.com | head -1     # 200
curl -sI http://example.com  | head -1     # 301 vers https

# 4. Les images sont réellement servies — le piège `sharp`
#    Prendre une URL `/_image?...` telle qu'elle apparaît dans le HTML servi,
#    puis la demander : 500 = sharp absent de l'image, 200 image/webp = bon.
curl -s https://example.com | grep -o '/_image?[^"&]*[^"]*' | head -1

# 5. Le script de mesure est bien DANS la page (build-arg, pas runtime)
curl -s https://example.com | grep -c data-website-id            # 1, pas 0
```

**Ce qu'un `healthy` ne prouve pas.** Les healthchecks visent `/api/health`,
une route **sans aucune dépendance** — ni Convex, ni session. C'est
volontaire : une panne du backend ne doit pas faire redémarrer en boucle un
site qui sert encore parfaitement ses pages. Conséquence directe : deux
conteneurs `healthy` ne disent rien sur Convex, rien sur l'authentification
du dashboard, rien sur les images.

**Un `200` ne prouve pas non plus l'ingestion.** Mesuré sur Umami 3.3.1, un
`POST /api/send` avec un User-Agent qui ressemble à un outil (`curl/8.7.1`,
`python-requests`, `Googlebot`) répond **`200` avec `{"beep":"boop"}` et
l'événement est jeté**. L'échec porte un code de succès : un script qui ne
regarde que le statut ne voit rien.

**Avant de pousser — le seul test qui construit vraiment l'image `web`.**
La CI ne construit que l'image `admin` sur les PR : le build du site exige un
déploiement Convex joignable *pendant* le build, impossible à donner à une PR
venue d'un fork. Le premier build réel de `web` est donc celui de `Deploy`,
sur `main`.

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml \
  up --build -d web admin
curl -s -o /dev/null -w 'web=%{http_code}\n'   http://127.0.0.1:4321/api/health
curl -s -o /dev/null -w 'admin=%{http_code}\n' http://127.0.0.1:3001/api/health
docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down
```

## À ne jamais faire

- Modifier `IMAGE_TAG` à la main sur le VPS pour « revenir en arrière ».
- Lancer `docker compose down -v`.
- Supprimer le volume `astrotan_acme` une fois les vrais certificats obtenus.
- Ajouter un `traefik.yml` ou un `command:` au service Traefik.
- Exposer l'API ou le dashboard Traefik (`api.insecure`, un router vers le
  dashboard) : cela publie la topologie complète du VPS.
- Passer un secret en build-arg.
- Fusionner expand, migrate et contract en un seul déploiement — cela produit
  un sha vers lequel on ne peut plus revenir, ce qui vide de sa substance
  tout ce qui précède.
- Laisser le compte Umami par défaut (`admin` / `umami`) : le sous-domaine
  est public, et il est le même sur toutes les installations du monde.
