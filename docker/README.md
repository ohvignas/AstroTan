# Exploitation — VPS, secrets, rollback

Ce répertoire est la totalité de ce qui tourne sur le VPS. Le workflow
`Deploy` y `rsync` son contenu à chaque déploiement, `--delete` en prime :
tout fichier ajouté à la main sur la machine disparaît au déploiement
suivant. La seule exception est `~/astrotan/.env`, explicitement exclu du
`rsync` — c'est le fichier qui porte les valeurs propres à cette machine, et
c'est le seul.

Ordre de lecture : les sections ci-dessous sont dans l'ordre où on les
exécute la première fois. Le DNS avant l'amorçage, l'amorçage avant le
premier `push`, et le rollback avant d'en avoir besoin.

---

## 1. Prérequis VPS

- **Docker Engine + le plugin Compose v2** (`docker compose version` doit
  répondre ; `docker-compose` v1 ne comprend ni la syntaxe `${VAR:?message}`
  telle qu'elle est utilisée ici, ni la clé `name:` du compose).
- **Un utilisateur non-root membre du groupe `docker`.** C'est celui que
  `VPS_USER` nomme. Le pipeline ne fait jamais de `sudo` : un `sudo` demandé
  au milieu d'une session SSH non interactive bloque le déploiement sans
  message exploitable.
- **Ports 80 et 443 ouverts** en entrée. 80 n'est pas décoratif : il porte
  le challenge HTTP-01 de Let's Encrypt et la redirection permanente vers
  443 (`traefik/traefik.yml`). Le fermer une fois les certificats obtenus
  casse leur renouvellement 60 jours plus tard, c'est-à-dire longtemps après
  qu'on ait oublié l'avoir fermé.
- **Aucun autre service n'écoute sur 80/443.** Un nginx installé par défaut
  par l'image du VPS empêche Traefik de démarrer (`bind: address already in
  use`) — le désactiver avant le premier `up`.

## 2. Le DNS d'abord, sans exception

`WEB_DOMAIN` et `ADMIN_DOMAIN` doivent pointer en `A` (et `AAAA` si le VPS a
de l'IPv6) sur l'adresse du VPS **avant** le premier `docker compose up`.

La raison est mécanique : le résolveur ACME est configuré en `httpChallenge`
(`traefik/traefik.yml`). Let's Encrypt vient donc chercher un jeton sur
`http://<domaine>/.well-known/acme-challenge/…`. Si le DNS ne mène pas
encore ici, la validation échoue — et les échecs de validation sont
comptabilisés : cinq par compte, par domaine et par heure. Une pile démarrée
trop tôt, en `restart: unless-stopped`, réessaie en boucle et épuise ce quota
en quelques minutes ; il faut ensuite attendre que la fenêtre glisse, sans
aucun moyen d'accélérer.

Vérifier avant de démarrer :

```bash
dig +short illith.com        # doit rendre l'IP du VPS
dig +short admin.illith.com
```

## 3. Amorçage

Sur le VPS, une fois pour toutes :

```bash
mkdir -p ~/astrotan
# depuis le poste de dev, ou par copier-coller du fichier du dépôt :
scp docker/.env.example <user>@<host>:~/astrotan/.env
ssh <user>@<host> 'chmod 600 ~/astrotan/.env'
```

Puis éditer `~/astrotan/.env` et remplir les six variables qu'il contient :
`WEB_DOMAIN`, `ADMIN_DOMAIN`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`,
`PREVIEW_SECRET`, `REVALIDATE_SECRET`. Chacune est commentée dans
`.env.example` ; ce sont exactement celles que `docker-compose.yml` exige par
la syntaxe `${VAR:?message}`, qui fait échouer le `compose up` avec le nom de
la variable manquante plutôt que de démarrer un conteneur à moitié
configuré.

`GHCR_OWNER` et `IMAGE_TAG` figurent aussi dans `.env.example`, mais **ne
sont pas lus depuis ce fichier en déploiement** : le workflow les passe en
tête de la commande `docker compose` par SSH, et une variable de la commande
l'emporte sur le `.env`. Leur présence dans le fichier ne sert qu'à un
`docker compose up` lancé à la main sur la machine. C'est délibéré :
`IMAGE_TAG` est ce que le déploiement décide (le sha du commit), pas ce que
la machine sait.

**`ACME_EMAIL` n'existe pas.** Ni dans `.env.example`, ni dans le compose.
L'adresse de contact Let's Encrypt est écrite littéralement dans
`traefik/traefik.yml`, parce que Traefik n'interpole aucune variable dans sa
configuration statique : `${ACME_EMAIL}` y resterait la chaîne
« `${ACME_EMAIL}` », et dès qu'un `/etc/traefik/traefik.yml` est monté, il
devient la source exclusive — ni l'environnement ni les arguments de ligne de
commande n'y sont fusionnés (vérifié sur `traefik:v3.6`, 3.6.25 ; la trace
est en tête du fichier). Changer cette adresse est donc un commit, suivi d'un
déploiement, comme n'importe quel autre changement de configuration du VPS.

Bootstrap GHCR, une seule fois : si les packages `astrotan-web` et
`astrotan-admin` sont **privés**, le `docker compose pull` du déploiement
échoue tant que la machine n'est pas authentifiée. Le pipeline ne s'en charge
pas — il ne pousse jamais de credentials sur le VPS. Faire, sur la machine,
avec un Personal Access Token portant le scope `read:packages` :

```bash
echo <PAT> | docker login ghcr.io -u <compte-github> --password-stdin
```

Rendre les packages publics dans les réglages GHCR est l'alternative
équivalente, et supprime ce prérequis.

## 4. Secrets partagés avec Convex

`PREVIEW_SECRET` et `REVALIDATE_SECRET` ne sont pas des mots de passe : ce
sont des clés HMAC, vérifiées des deux côtés d'une frontière. Elles n'ont de
sens qu'**identiques** sur le déploiement Convex et dans le conteneur `web`.

Générer chacune une fois :

```bash
openssl rand -hex 32
```

puis poser la même valeur des deux côtés :

```bash
# côté Convex (déploiement de production)
pnpm --filter @astrotan/backend exec convex env set PREVIEW_SECRET <valeur>
pnpm --filter @astrotan/backend exec convex env set REVALIDATE_SECRET <valeur>
# côté VPS
$EDITOR ~/astrotan/.env      # PREVIEW_SECRET=…  REVALIDATE_SECRET=…
```

Ce qu'une divergence produit, précisément :

- **`PREVIEW_SECRET` divergent** — tout jeton de prévisualisation est rejeté.
  Le jeton est frappé par Convex (`convex/lib/previewToken.ts`) puis vérifié
  deux fois : dans Astro avant tout appel réseau (`src/lib/previewToken.ts`),
  puis à nouveau dans Convex. Deux clés différentes, et la première barrière
  refuse un jeton pourtant authentique. Le bouton « Prévisualiser » du
  dashboard ne rend plus qu'une erreur.
- **`REVALIDATE_SECRET` divergent** — toutes les invalidations de publication
  échouent. L'action `drain` de Convex POSTe
  `${WEB_SITE_URL}/api/revalidate` avec l'en-tête `x-revalidate-secret` ;
  l'endpoint le compare en temps constant et refuse. `drain` réessaie avec un
  backoff, puis marque la ligne `failed` **après 6 tentatives**. Rien ne
  tombe : les pages publiées restent simplement périmées jusqu'à l'expiration
  du cache, ce qui est la panne la plus discrète du système.

Le déploiement Convex a par ailleurs ses propres variables, qui ne
transitent jamais par le VPS (`SITE_URL`, `WEB_SITE_URL`,
`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_TEST_MODE`) : voir
`packages/backend/.env.example`, où chacune est documentée.

## 5. Secrets GitHub

Neuf secrets à poser dans *Settings → Secrets and variables → Actions*. Ce
sont exactement ceux que `deploy.yml` et `rollback.yml` référencent, ni plus
ni moins — la liste est vérifiable par
`grep -o 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u`.

| Secret | Ce que c'est, et comment l'obtenir |
|---|---|
| `CONVEX_DEPLOY_KEY` | Clé de déploiement du projet Convex de production. Dashboard Convex → le déploiement → *Settings* → *Deploy keys* → *Generate production deploy key*. C'est elle qui autorise `convex deploy` à remplacer schéma et functions : la traiter comme un accès complet au backend. |
| `PUBLIC_CONVEX_URL` | URL `https://<deployment>.convex.cloud` du déploiement de production. **Pas un secret** — elle finit dans le bundle du site. Elle est ici parce que le build de l'image `web` en a besoin en build-arg, pas parce qu'elle serait confidentielle. |
| `VITE_CONVEX_URL` | La même URL, pour le build de l'image `admin` (`src/router.tsx` construit son `ConvexReactClient` avec). Non secrète, même raison. |
| `VITE_CONVEX_SITE_URL` | URL `https://<deployment>.convex.site` — l'origine HTTP du déploiement, celle que Better Auth interroge. Non secrète. |
| `VITE_WEB_SITE_URL` | Origine publique du site Astro (`https://illith.com`), à laquelle le dashboard ajoute `/{slug}?t={token}` — l'aperçu s'ouvre à la vraie URL de la page, le jeton signant le slug (CLAUDE.md, invariant 2). Non secrète : seul le jeton l'est, et il est frappé par Convex. |
| `VPS_HOST` | Nom d'hôte ou IP du VPS. |
| `VPS_USER` | L'utilisateur non-root de la section 1. |
| `VPS_SSH_KEY` | Clé **privée** de déploiement, au format OpenSSH, en entier (`-----BEGIN…` à `-----END…` compris). La générer dédiée à cet usage — `ssh-keygen -t ed25519 -C deploy@astrotan -f ~/.ssh/astrotan_deploy` — et poser la publique dans `~/.ssh/authorized_keys` du VPS. Jamais une clé personnelle : elle n'est ni révocable ni traçable séparément. |
| `VPS_SSH_KNOWN_HOSTS` | Empreinte de la clé d'hôte du VPS, produite par `ssh-keyscan -H <host>` (coller la sortie complète). |

`GITHUB_TOKEN` apparaît aussi dans les workflows : il est fourni
automatiquement par GitHub à chaque exécution et sert uniquement au `docker
login ghcr.io`. Il n'y a rien à créer.

**Pourquoi `VPS_SSH_KNOWN_HOSTS` plutôt que `StrictHostKeyChecking=no`.**
Sans clé d'hôte connue, la seule façon de faire aboutir un SSH non
interactif est de désactiver la vérification — c'est-à-dire d'accepter
n'importe quelle machine qui répond à cette adresse au moment du
déploiement. Ce que le workflow lui livre ensuite n'est pas anodin : la clé
privée de déploiement est déjà sur le disque du runner, et la commande qui
suit contient le nom des images à tirer. Un détournement DNS ou un
changement d'IP suffirait. Le coût de l'alternative est une commande
`ssh-keyscan` à rejouer le jour où le VPS est réinstallé — et ce jour-là, un
échec de connexion est précisément ce qu'on veut voir.

## 6. Premier déploiement

Pousser sur `main`. Le workflow `Deploy` fait, dans cet ordre :

1. `convex deploy` — **avant** le build des images, et pas par habitude :
   `apps/web` prérend `src/pages/index.astro`, qui interroge Convex pendant
   `astro build`. Construire l'image d'abord ferait lire un schéma qui
   n'existe pas encore.
2. Build et push des deux images sur GHCR, taguées `:{sha}` **et** `:latest`.
3. `rsync` de `docker/` vers `~/astrotan/` (hors `.env`), puis
   `docker compose pull && docker compose up -d` avec `IMAGE_TAG=<sha>`.

Le sha déployé est écrit à deux endroits, exprès : dans le résumé du job
(onglet *Summary* de l'exécution) et dans `~/astrotan/DEPLOYED_SHA` sur le
VPS. Le second se lit sans ouvrir GitHub :

```bash
ssh <user>@<host> 'cat ~/astrotan/DEPLOYED_SHA'
```

`IMAGE_TAG` vaut le sha, jamais `latest` : un tag mouvant rend « ce qui
tourne » innommable, donc irreproductible, donc non rejouable. Le tag
`:latest` poussé en parallèle n'existe que pour le confort d'un `docker pull`
manuel.

Vérifier après le premier déploiement :

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose ps'   # web et admin healthy
curl -sI https://illith.com | head -1                    # 200, certificat valide
curl -sI http://illith.com  | head -1                    # 301 vers https
```

Les deux `healthy` viennent des healthchecks du compose, qui visent
`/api/health` — une route sans aucune dépendance, ni Convex ni session. Un
conteneur `healthy` atteste que le processus écoute et route ; il n'atteste
pas que Convex répond, et c'est voulu : une panne du backend ne doit pas
faire redémarrer en boucle un site qui sert encore parfaitement ses pages
prérendues.

## 7. Rollback

Lancer le workflow **Rollback** (*Actions* → *Rollback* → *Run workflow*) en
lui donnant le sha complet, 40 caractères, du déploiement à rejouer.

Il refait le pipeline entier sur l'arbre de ce sha : `convex deploy` depuis
cet arbre, vérification que les deux images de ce sha existent encore sur
GHCR, `rsync` du `docker/` de ce sha, puis `compose up -d` avec
`IMAGE_TAG=<sha>`.

**Ne jamais modifier `IMAGE_TAG` à la main sur le VPS.** C'est le
raccourci qui a l'air équivalent et ne l'est pas : il repointe les conteneurs
sur d'anciennes images tout en laissant en place les functions et le schéma
Convex actuels, que le déploiement fautif a déjà remplacés. On obtient un
frontend d'hier face à un backend d'aujourd'hui — la configuration que
personne n'a jamais testée. Le rollback n'est sûr que parce qu'il rejoue
aussi `convex deploy` (spec §7).

Corollaire : il n'est sûr que **d'un cran**, et seulement si la discipline
expand / migrate / contract a été tenue (section suivante). Redéployer les
functions d'un sha antérieur à une phase *contract* les fait s'exécuter
contre un schéma dont les colonnes qu'elles lisent ont été supprimées.

## 8. Changement de schéma : expand → migrate → contract

Trois déploiements, jamais un seul (spec §7, invariant 6 de `CLAUDE.md`) :

1. **expand** — ajouter le nouveau champ, optionnel, et le code qui sait
   lire l'ancien *et* le nouveau. Rien ne casse si on revient en arrière : le
   code précédent ignore simplement un champ qu'il ne connaît pas.
2. **migrate** — remplir le nouveau champ pour les données existantes
   (mutation dédiée, skill `convex-migration-helper`). Toujours réversible :
   les deux formes coexistent.
3. **contract** — supprimer l'ancien champ et le code qui le lisait.
   **C'est le seul des trois qui rend un rollback dangereux**, parce qu'il
   est le seul destructif. Ne le déployer qu'après avoir laissé les deux
   précédents vivre assez longtemps pour ne plus vouloir y revenir.

Fusionner ces étapes en un déploiement, c'est produire un sha vers lequel on
ne peut plus revenir — ce qui vide de sa substance tout ce qui précède dans
ce fichier.

## 9. Limites connues

Écrites ici parce qu'elles ont été constatées, pas devinées.

- **Un seul réplica de `web`, et ce n'est pas un réglage de capacité.** Le
  cache d'Astro est `memoryCache()`, donc par processus. Le POST
  `/api/revalidate` n'atteint qu'une instance : toutes les autres
  continueraient de servir la version périmée jusqu'à `maxAge` après chaque
  publication. `deploy.replicas` reste à 1 tant qu'il n'existe pas de
  provider de cache partagé (spec §6.2).
- **`PUBLIC_CONVEX_URL` et les `VITE_*` sont figées dans les bundles au
  build.** Vite et Astro les inlinent, y compris dans la sortie SSR. Changer
  de déploiement Convex impose donc de **reconstruire les images**, pas de
  redémarrer les conteneurs. Un `.env` modifié sur le VPS ne changera pas ce
  que le bundle client contient.
- **`VITE_CONVEX_URL` et `VITE_CONVEX_SITE_URL` ont deux sources de vérité,
  et rien ne détecte leur divergence.** Côté build, ce sont les secrets
  GitHub, figés par Vite dans le bundle client (`src/router.tsx`). Côté
  runtime, ce sont les entrées du `.env` du VPS, lues par `process.env` dans
  `src/lib/auth-server.ts`. Les deux sont nécessaires et doivent être
  identiques. Si elles divergent, le dashboard s'affiche normalement et
  l'authentification tombe — aucun healthcheck ne le voit, puisque
  `/api/health` est sans dépendance par construction. Après tout changement
  d'URL Convex : mettre à jour les secrets GitHub **et** le `.env` du VPS,
  puis redéployer.
- **`docker compose pull` suppose un `docker login ghcr.io` préalable** si
  les packages GHCR sont privés. C'est un prérequis d'amorçage de la machine
  (section 3), pas quelque chose que le pipeline installe : il ne pousse
  jamais de credentials sur le VPS. Symptôme : un déploiement qui échoue au
  `pull` avec `denied` sur une machine par ailleurs saine.
- **L'image `web` n'est pas construite sur les PR.** La CI ne construit que
  l'image `admin`, parce que le build du site exige un déploiement Convex
  joignable *pendant* le build — le donner à des PR venues de forks est
  impossible (les secrets n'y sont pas disponibles) et indésirable. Le
  premier build réel de cette image est donc celui du workflow `Deploy` :
  une erreur qui ne se manifeste qu'au build du site est vue sur `main`, pas
  sur la PR. Le contrepoids est le smoke-test local, qui reste la façon de
  vérifier cette image avant de pousser :

  ```bash
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml \
    up --build -d web admin
  curl -s -o /dev/null -w 'web=%{http_code}\n'   http://127.0.0.1:4321/api/health
  curl -s -o /dev/null -w 'admin=%{http_code}\n' http://127.0.0.1:3001/api/health
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down
  ```

  (L'override local exige les mêmes variables que le compose de base ; les
  exporter dans le shell.)
