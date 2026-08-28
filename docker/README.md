# Exploitation — VPS, secrets, rollback

Ce répertoire est la totalité de ce qui tourne sur le VPS. Le workflow
`Deploy` y `rsync` son contenu à chaque déploiement, `--delete` en prime :
tout fichier ajouté à la main sur la machine disparaît au déploiement
suivant. La seule exception est `~/astrotan/.env`, explicitement exclu du
`rsync` — c'est le fichier qui porte les valeurs propres à cette machine, et
c'est le seul.

**Ce fichier est écrit pour quelqu'un qui vient de cloner le template.**
Partout où vous lisez `example.com`, `admin.example.com`, `<owner>`,
`<user>` ou `<host>`, remplacez par vos valeurs : vos deux domaines, le
propriétaire GitHub du dépôt cloné (organisation ou nom d'utilisateur), et
l'accès SSH de votre VPS.

Ordre de lecture : les sections ci-dessous sont dans l'ordre où on les
exécute la première fois. Les prérequis avant l'amorçage, l'amorçage avant
le premier `push`, et le rollback avant d'en avoir besoin.

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
  le challenge HTTP-01 de Let's Encrypt
  (`TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_HTTPCHALLENGE_ENTRYPOINT:
  web` dans `docker-compose.yml`) et la redirection permanente vers 443. Le
  fermer une fois les certificats obtenus casse leur renouvellement 60 jours
  plus tard, c'est-à-dire longtemps après qu'on ait oublié l'avoir fermé.
- **Aucun autre service n'écoute sur 80/443.** Un nginx installé par défaut
  par l'image du VPS empêche Traefik de démarrer (`bind: address already in
  use`) — le désactiver avant le premier `up`.
- **`rsync` installé** sur le VPS : le workflow `Deploy` y pousse `docker/`
  avec, et une machine sans `rsync` fait échouer l'étape sans autre
  diagnostic que `rsync: command not found`.

Toute la configuration statique de Traefik vit dans le bloc `environment:`
du service `traefik`. **Il n'existe aucun fichier de configuration statique
Traefik dans ce dépôt, et il ne faut pas en ajouter un** (ni le monter sous
`/etc/traefik/`) : Traefik essaie ses loaders dans l'ordre File → Flag →
Env et s'arrête au premier qui aboutit, sans fusionner. Un fichier monté (ou
un simple `command:`) ferait ignorer en silence toutes les variables
`TRAEFIK_*` — donc ACME, le provider Docker et la redirection. Le
raisonnement complet et la vérification sont en tête de
`docker-compose.yml` ; pour ajouter un réglage, ajoutez une variable.

## 2. GHCR : rendre les images tirables (prérequis bloquant)

À faire **avant** le premier déploiement, pas après l'avoir vu échouer.

Les packages GHCR sont **privés par défaut**. Le premier
`docker compose pull` d'un dépôt fraîchement cloné échoue donc avec `denied`
sur une machine par ailleurs parfaitement saine. Le pipeline ne corrige pas
ça pour vous : il ne pousse jamais de credentials sur le VPS.

Deux chemins, à choisir maintenant :

1. **Rendre les deux packages publics** — le plus simple, et il ne laisse
   aucun secret sur le VPS. Sur GitHub : *Packages* → `astrotan-web` →
   *Package settings* → *Change visibility* → *Public*. Idem pour
   `astrotan-admin`. Plus rien à faire sur la machine. Les images ne
   contiennent aucun secret par construction (seules des valeurs publiques
   passent en build-arg, section 8), mais elles contiennent votre code : ce
   choix est le vôtre.
2. **Garder les packages privés et authentifier le VPS** — une fois, avec un
   Personal Access Token portant le seul scope `read:packages` :

   ```bash
   ssh <user>@<host>
   echo <PAT> | docker login ghcr.io -u <compte-github> --password-stdin
   ```

   Le token est alors stocké dans `~/.docker/config.json` sur le VPS. Un PAT
   classique expire : le jour de son expiration, le déploiement échoue au
   `pull`, pas au build.

Les packages n'existent qu'après le premier `Deploy` réussi — donc si vous
prenez le chemin 1, le premier déploiement échouera quand même au `pull`,
le temps que les packages apparaissent et que vous les basculiez en public.
C'est attendu : relancez le workflow après.

**Cas d'échec au *push*, distinct du précédent.** Si un package GHCR du même
nom existe déjà sur le compte sans être **lié** à ce dépôt, le
`docker/build-push-action` échoue avec un refus de permission *malgré*
`permissions: packages: write` dans le workflow. Le `GITHUB_TOKEN` d'une
exécution n'a de droits que sur les packages rattachés à son dépôt. Remède :
dans les réglages du package, *Manage Actions access* → ajouter le dépôt en
`Write` ; ou supprimer le package orphelin et laisser le déploiement le
recréer.

## 3. Le DNS d'abord, sans exception — et attention au proxy

`WEB_DOMAIN` et `ADMIN_DOMAIN` doivent pointer en `A` (et `AAAA` si le VPS a
de l'IPv6) sur l'adresse du VPS **avant** le premier `docker compose up`.

La raison est mécanique : le résolveur ACME est configuré en `httpChallenge`.
Let's Encrypt vient donc chercher un jeton sur
`http://<domaine>/.well-known/acme-challenge/…`. Si le DNS ne mène pas
encore ici, la validation échoue — et les échecs de validation sont
comptabilisés : cinq par compte, par domaine et par heure. Une pile démarrée
trop tôt, en `restart: unless-stopped`, réessaie en boucle et épuise ce quota
en quelques minutes ; il faut ensuite attendre que la fenêtre glisse, sans
aucun moyen d'accélérer.

Vérifier avant de démarrer :

```bash
dig +short example.com        # doit rendre l'IP du VPS
dig +short admin.example.com
```

**Si `dig` rend une IP qui n'est pas celle du VPS, ne démarrez pas.** Le cas
le plus fréquent n'est pas une faute de frappe : c'est un **proxy devant le
VPS**, Cloudflare en tête (nuage orange). En mode proxy, `dig` rend une
adresse Cloudflare, et le challenge HTTP-01 n'atteint jamais Traefik —
Let's Encrypt reçoit un 404 servi par le proxy, et le certificat n'est
jamais émis. C'est le mode d'échec le plus rapporté sur
Traefik + Let's Encrypt, et il concerne directement ce template : un VPS
Hostinger est souvent livré avec son DNS chez Cloudflare.

Deux remèdes, au choix :

- **Désactiver le proxy le temps de l'émission** (nuage gris, « DNS only »),
  laisser Traefik obtenir les certificats, puis le réactiver si vous y
  tenez. À refaire à chaque renouvellement si le proxy reste actif — donc en
  pratique, laissez-le gris.
- **Passer en challenge DNS-01**, qui ne dépend pas du routage HTTP. Cela
  change la configuration du résolveur ACME : remplacer les variables
  `..._ACME_HTTPCHALLENGE_*` par `..._ACME_DNSCHALLENGE_PROVIDER` et fournir
  les credentials API du fournisseur DNS au conteneur Traefik. C'est aussi
  la seule voie pour un certificat wildcard.

Notez aussi qu'avec Cloudflare en mode proxy et son SSL réglé sur
« Flexible », le navigateur voit un cadenas alors que le lien
Cloudflare → VPS reste en clair. Si vous gardez le proxy, réglez le mode SSL
sur « Full (strict) ».

## 4. Amorçage du `.env` sur le VPS

Sur le VPS, une fois pour toutes :

```bash
mkdir -p ~/astrotan
# depuis le poste de dev, ou par copier-coller du fichier du dépôt :
scp docker/.env.example <user>@<host>:~/astrotan/.env
ssh <user>@<host> 'chmod 600 ~/astrotan/.env'
```

Puis éditer `~/astrotan/.env` et remplir les **sept** variables que le
déploiement ne passe pas lui-même : `WEB_DOMAIN`, `ADMIN_DOMAIN`,
`ACME_EMAIL`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `PREVIEW_SECRET`,
`REVALIDATE_SECRET`. Chacune est commentée dans `.env.example` — **c'est ce
fichier qui fait autorité** sur ce que chaque valeur signifie, où la trouver
et ce qu'elle casse. Ce sont exactement celles que `docker-compose.yml`
exige par la syntaxe `${VAR:?message}`, qui fait échouer le `compose up` avec
le nom de la variable manquante plutôt que de démarrer un conteneur à moitié
configuré.

`GHCR_OWNER` et `IMAGE_TAG` figurent aussi dans `.env.example`, mais **ne
sont pas lus depuis ce fichier en déploiement** : le workflow les passe en
tête de la commande `docker compose` par SSH, et une variable de la commande
l'emporte sur le `.env`. Leur présence dans le fichier ne sert qu'à un
`docker compose up` lancé à la main sur la machine. C'est délibéré :
`IMAGE_TAG` est ce que le déploiement décide (le sha du commit), pas ce que
la machine sait.

`ACME_CA_SERVER` est la huitième variable du fichier, et la seule qui soit
optionnelle : elle a un défaut (le CA de production). Ne la laissez pas au
défaut pour votre premier essai — lisez la section suivante d'abord.

## 5. Certificats : le CA de staging au premier essai

**Let's Encrypt limite à 5 certificats par jeu d'identifiants tous les
7 jours.** Ce quota ne se remet pas à zéro et ne s'achète pas. Un premier
essai raté sur le CA de production — DNS pas encore propagé, proxy actif,
port 80 fermé, domaine mal orthographié — vous coûte donc potentiellement
une semaine d'attente sur ce domaine. Le CA de staging a des limites bien
plus hautes et emprunte exactement le même chemin de code ; ses certificats
sont simplement rejetés par les navigateurs.

Procédure, dans cet ordre :

1. **Premier `up` sur le staging.** Dans `~/astrotan/.env`, décommenter :

   ```bash
   ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
   ```

   puis démarrer (ou laisser le workflow `Deploy` le faire).

2. **Vérifier que le certificat est bien émis.** Le navigateur affichera une
   erreur de certificat : **c'est le résultat attendu**, la chaîne est
   signée par « (STAGING) Let's Encrypt » et aucun magasin de confiance ne
   la connaît. Ce qu'il faut regarder, c'est l'émetteur :

   ```bash
   echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
     | openssl x509 -noout -issuer -dates
   # issuer=C=US, O=(STAGING) Let's Encrypt, CN=(STAGING) …
   ```

   et, en cas de doute, les logs du résolveur :

   ```bash
   ssh <user>@<host> 'cd ~/astrotan && docker compose logs traefik | grep -i acme'
   ```

   Tant que cette commande ne rend pas un certificat de staging pour vos
   **deux** domaines, ne passez pas à l'étape suivante — corrigez d'abord
   (DNS, proxy, ports).

3. **Repasser sur le CA de production** : recommenter la ligne
   `ACME_CA_SERVER` dans `~/astrotan/.env`.

4. **Supprimer le volume ACME.** Les certificats de staging y sont stockés
   et Traefik ne les remplacera pas tout seul : il les considère valides.

   ```bash
   ssh <user>@<host> 'cd ~/astrotan && docker compose down && docker volume rm astrotan_acme'
   ```

   `astrotan_acme` est bien le nom réel du volume : le projet compose est
   nommé `astrotan` (clé `name:` en tête de `docker-compose.yml`) et le
   volume `acme`. Vérifiable par `docker volume ls | grep acme`.

5. **`up` à nouveau**, et refaire la vérification de l'étape 2 : l'émetteur
   ne doit plus contenir « (STAGING) ».

Une fois les vrais certificats obtenus, **ne supprimez plus jamais ce volume
« pour repartir propre »**. C'est sa persistance qui protège le quota : sans
elle, un conteneur qui redémarre en boucle redemande un certificat à chaque
tour et brûle les 5 certificats/7 jours en quelques minutes.

## 6. Secrets partagés avec Convex

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

## 7. Secrets GitHub

Neuf secrets à poser dans *Settings → Secrets and variables → Actions*. Ce
sont exactement ceux que `deploy.yml` et `rollback.yml` référencent, ni plus
ni moins — la liste est vérifiable par
`grep -oh 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u`.

| Secret | Ce que c'est, et comment l'obtenir |
|---|---|
| `CONVEX_DEPLOY_KEY` | Clé de déploiement du projet Convex de production. Dashboard Convex → le déploiement → *Settings* → *Deploy keys* → *Generate production deploy key*. C'est elle qui autorise `convex deploy` à remplacer schéma et functions : la traiter comme un accès complet au backend. |
| `PUBLIC_CONVEX_URL` | URL `https://<deployment>.convex.cloud` du déploiement de production. **Pas un secret** — elle finit dans le bundle du site. Elle est ici parce que le build de l'image `web` en a besoin en build-arg, pas parce qu'elle serait confidentielle. |
| `VITE_CONVEX_URL` | La même URL, pour le build de l'image `admin` (`src/router.tsx` construit son `ConvexReactClient` avec). Non secrète, même raison. |
| `VITE_CONVEX_SITE_URL` | URL `https://<deployment>.convex.site` — l'origine HTTP du déploiement, celle que Better Auth interroge. Non secrète. |
| `VITE_WEB_SITE_URL` | Origine publique du site Astro (`https://example.com`), à laquelle le dashboard ajoute `/{slug}?t={token}` — l'aperçu s'ouvre à la vraie URL de la page, le jeton signant le slug (CLAUDE.md, invariant 2). Non secrète : seul le jeton l'est, et il est frappé par Convex. |
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

## 8. Premier déploiement

Pousser sur `main`. Le workflow `Deploy` fait, dans cet ordre :

1. `convex deploy` — **avant** le build des images, et pas par habitude :
   `apps/web` prérend `src/pages/index.astro`, qui interroge Convex pendant
   `astro build`. Construire l'image d'abord ferait lire un schéma qui
   n'existe pas encore.
2. Build et push des deux images sur GHCR, taguées `:{sha}` **et** `:latest`.
   Seules des valeurs publiques passent en build-arg : Vite et Astro les
   figent dans le bundle, donc un secret qui passerait là serait lisible dans
   l'image.
3. `rsync` de `docker/` vers `~/astrotan/` (hors `.env`), puis
   `docker compose pull && docker compose up -d --wait --wait-timeout 180`
   avec `IMAGE_TAG=<sha>`.

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
curl -sI https://example.com | head -1                   # 200, certificat valide
curl -sI http://example.com  | head -1                   # 301 vers https
```

Les deux `healthy` viennent des healthchecks du compose, qui visent
`/api/health` — une route sans aucune dépendance, ni Convex ni session. Un
conteneur `healthy` atteste que le processus écoute et route ; il n'atteste
pas que Convex répond, et c'est voulu : une panne du backend ne doit pas
faire redémarrer en boucle un site qui sert encore parfaitement ses pages
prérendues.

### Le déploiement n'est pas sans coupure, et c'est assumé

`docker compose up -d` **recrée** les conteneurs dont l'image a changé :
l'ancien est arrêté, le nouveau démarré. Entre les deux, Traefik n'a plus de
backend pour ce routeur et rend des 502 — quelques secondes, le temps que le
processus Node démarre et que le healthcheck passe. Sur un site vitrine, à
un déploiement par merge, c'est un coût acceptable et il vaut mieux le
connaître que le découvrir.

Ce n'est pas une omission. Un rolling update naïf derrière Traefik — démarrer
le nouveau conteneur avant d'arrêter l'ancien — fait cohabiter deux
conteneurs portant **les mêmes labels Traefik**, donc deux backends pour un
même routeur, le temps que la table de routage converge. On échange quelques
secondes de 502 franches contre une fenêtre de 404 et de 502 intermittents,
sur un mono-VPS, sans orchestrateur pour arbitrer. Faire ça correctement
demande des labels distincts par version et un drain explicite : c'est un
outillage qui n'a pas sa place dans un template mono-VPS.

Ce que le pipeline garantit en revanche, c'est qu'**un déploiement cassé
échoue au lieu de passer au vert** : `up -d` seul rend la main dès que les
conteneurs sont *créés*, sans regarder les healthchecks, et renvoie 0 même
si un conteneur meurt aussitôt après. `--wait` attend `running|healthy` et
sort en 1 sur `container <nom> is unhealthy`. `--wait-timeout 180` plafonne
cette attente : en `restart: unless-stopped`, un conteneur en boucle de crash
repart à chaque fois dans son `start_period` sans jamais se stabiliser en
`unhealthy`, et sans plafond `--wait` tiendrait le verrou de concurrence
`deploy` jusqu'au timeout de job GitHub (6 h par défaut).

## 9. Rollback

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

## 10. Changement de schéma : expand → migrate → contract

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

## 11. Contrainte pnpm : ne pas monter de version au fil de l'eau

**`pnpm@10.34.5` est épinglé par le champ `packageManager` du `package.json`
racine, et cet épinglage n'est pas cosmétique.**

Les deux Dockerfiles construisent l'arbre d'exécution avec
`pnpm deploy --legacy --filter <package> --prod /out`, qui doit produire un
répertoire **autonome**. Les versions **11.19.0 à 11.23.x** cassent
précisément ça : les dépendances workspace (`@astrotan/backend`,
`@astrotan/tokens`) y sont **symlinkées vers le monorepo source** au lieu
d'être copiées. Le symptôme est traître — le `COPY --from=build /out` de
l'étape runtime emporte des liens pendants, **l'image se construit sans la
moindre erreur**, et le conteneur meurt au démarrage sur
`Cannot find module`. Build vert, runtime mort.

Référence : [pnpm#13754](https://github.com/pnpm/pnpm/issues/13754) —
dernière version saine `11.18.0`, première cassée `11.19.0`, corrigé par la
PR [#13755](https://github.com/pnpm/pnpm/pull/13755) mergée le 2026-08-10.
La version de release qui embarque ce correctif n'est pas déterminée à ce
jour.

Règle qui en découle : **toute montée de version de pnpm se vérifie par une
construction d'image réelle**, pas par un `pnpm install` vert ni par la CI.
Le smoke-test local de la section 12 est exactement ce test — il construit
les deux images et démarre les conteneurs, ce qu'aucune autre étape ne fait
avant `Deploy`.

**Corollaire Node.** Les deux Dockerfiles partent de `node:22-alpine` et
font `RUN corepack enable`, ce qui suppose **Node ≤ 24** : corepack a été
retiré de la distribution officielle de Node à partir de **Node 25**. Passer
l'image de base à `node:25-*` (ou plus) casse cette ligne, et le remède
n'est pas `npm i -g pnpm` — ce serait une seconde source de vérité pour la
version du gestionnaire de paquets, à côté de `packageManager`. Il faut
alors installer corepack explicitement (`npm i -g corepack`) et continuer à
laisser `packageManager` décider.

## 12. Limites connues

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
- **L'image `web` n'est pas construite sur les PR.** La CI ne construit que
  l'image `admin`, parce que le build du site exige un déploiement Convex
  joignable *pendant* le build — le donner à des PR venues de forks est
  impossible (les secrets n'y sont pas disponibles) et indésirable. Le
  premier build réel de cette image est donc celui du workflow `Deploy` :
  une erreur qui ne se manifeste qu'au build du site est vue sur `main`, pas
  sur la PR. Le contrepoids est le smoke-test local, qui reste la façon de
  vérifier ces images avant de pousser :

  ```bash
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml \
    up --build -d web admin
  curl -s -o /dev/null -w 'web=%{http_code}\n'   http://127.0.0.1:4321/api/health
  curl -s -o /dev/null -w 'admin=%{http_code}\n' http://127.0.0.1:3001/api/health
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down
  ```

  (L'override local exige les mêmes variables que le compose de base ; les
  exporter dans le shell. Il retire Traefik du chemin — pas de domaine, pas
  d'ACME — et publie l'admin sur 3001 côté hôte.)

## 13. Mise à jour depuis une version antérieure du template

Si votre VPS tourne déjà avec une version de ce dépôt antérieure au passage
de Traefik en configuration par variables d'environnement, **lisez ceci
avant de déployer**.

- **`ACME_EMAIL` doit être ajoutée à `~/astrotan/.env` avant le
  déploiement.** Le `rsync` du workflow exclut `.env` (`--exclude '.env'`) :
  votre fichier n'est ni écrasé ni complété, et il lui manquera donc cette
  variable que le compose exige désormais en `${ACME_EMAIL:?…}`. Le prochain
  `compose up` échouera en la nommant explicitement — panne franche, mais
  pile pendant le déploiement. Ajoutez la ligne d'abord :

  ```bash
  ssh <user>@<host> "printf 'ACME_EMAIL=%s\n' 'vous@example.com' >> ~/astrotan/.env"
  ```

- **Le répertoire `docker/traefik/` disparaît du VPS tout seul.** Le `rsync`
  est en `--delete` : ce qui n'existe plus dans le dépôt est supprimé de
  `~/astrotan/`. Rien à nettoyer à la main, et surtout rien à recréer — un
  fichier de configuration statique remis en place ferait taire toutes les
  variables `TRAEFIK_*` (section 1).

- **Les certificats déjà obtenus sont conservés** : ils vivent dans le
  volume `astrotan_acme`, que rien de tout ceci ne touche. Ne le supprimez
  pas à cette occasion — vous repartiriez à zéro sur le quota Let's Encrypt
  pour rien.
