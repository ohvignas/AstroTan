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

**`pnpm bootstrap` (à la racine du dépôt) produit ce fichier déjà rempli,**
sous le nom `.env.vps` : toutes les variables ci-dessous, les clés HMAC
identiques à celles qu'il pose sur Convex, les secrets d'Umami, et la ligne
`ACME_CA_SERVER` laissée commentée pour la section 5. Il affiche ensuite les
commandes de copie et le
`chmod 600`. Il ne se connecte **pas** au VPS pour écrire à votre place : ce
fichier est le seul que le déploiement n'écrase jamais (`rsync --exclude`),
donc le seul point de vérité de la machine — le remplir depuis l'extérieur en
ferait une copie d'un fichier resté sur le poste de dev, périmée en silence.

La procédure manuelle ci-dessous reste la référence, et la seule voie pour qui
n'a ni `gh` ni Node sous la main.

Sur le VPS, une fois pour toutes :

```bash
mkdir -p ~/astrotan
# depuis le poste de dev — soit le fichier produit par `pnpm bootstrap` :
scp .env.vps <user>@<host>:~/astrotan/.env
# soit l'exemple du dépôt, à remplir ensuite à la main :
scp docker/.env.example <user>@<host>:~/astrotan/.env
ssh <user>@<host> 'chmod 600 ~/astrotan/.env'
```

Puis éditer `~/astrotan/.env` et remplir toutes les variables que le
déploiement ne passe pas lui-même. **La liste n'est pas recopiée ici** — elle
l'a été, elle a divergé du compose deux fois, et une liste en prose ne se
relit jamais au bon moment. Elle se demande au fichier qui fait foi :

```bash
node scripts/check-env-wiring.mjs --compose-required
```

Ce sont exactement les variables que `docker-compose.yml` exige par la
syntaxe `${VAR:?message}`, qui fait échouer le `compose up` avec le nom de la
variable manquante plutôt que de démarrer un conteneur à moitié configuré.
Chacune est commentée dans `.env.example` — **c'est ce fichier qui fait
autorité** sur ce que chaque valeur signifie, où la trouver et ce qu'elle
casse.

Certaines sont des clés HMAC, qui n'ont de sens qu'identiques des deux côtés
d'une frontière (section 6) ; d'autres appartiennent à Umami (section 13).
`pnpm bootstrap` les génère et les écrit toutes : il n'y a aucun secret à
inventer à la main.

`GHCR_OWNER` et `IMAGE_TAG` figurent aussi dans `.env.example`, mais **ne
sont pas lus depuis ce fichier en déploiement** : le workflow les passe en
tête de la commande `docker compose` par SSH, et une variable de la commande
l'emporte sur le `.env`. Leur présence dans le fichier ne sert qu'à un
`docker compose up` lancé à la main sur la machine. C'est délibéré :
`IMAGE_TAG` est ce que le déploiement décide (le sha du commit), pas ce que
la machine sait.

`ACME_CA_SERVER` est la seule variable optionnelle du fichier : elle a un
défaut (le CA de production), donc son absence ne bloque rien. Ne la laissez
pas au défaut pour votre premier essai — lisez la section suivante d'abord.

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

`PREVIEW_SECRET`, `REVALIDATE_SECRET`, `LEAD_SUBMIT_SECRET`,
`CONSENT_LOG_SECRET` et `ROUTING_SECRET` ne sont pas des mots de passe : ce
sont des clés HMAC, vérifiées des deux côtés d'une frontière. Elles n'ont de
sens qu'**identiques** sur le déploiement Convex et dans les conteneurs du
VPS — les quatre premières dans `web`, la cinquième dans `web` **et** dans
`routeur`.

**`pnpm bootstrap` est fait pour cette contrainte précise.** Il génère chaque
clé une fois par `openssl rand -hex 32`, la réécrit dans `.env.deploy` pour ne
jamais la régénérer ensuite, puis la pose telle quelle sur les trois côtés :
le déploiement Convex, `.env.vps`, et `apps/web/.env.local` pour le développement
local. Il n'affiche jamais leur valeur ; il en affiche une empreinte SHA-256
courte, ce qui suffit à vérifier d'un coup d'œil que les trois côtés portent
bien la même clé. Une divergence ne peut donc plus venir que d'une rotation
faite à la main d'un seul côté.

À la main, si vous préférez. Générer chacune une fois :

```bash
openssl rand -hex 32
```

puis poser la même valeur des deux côtés :

```bash
# côté Convex (déploiement de production)
pnpm --filter @astrotan/backend exec convex env set PREVIEW_SECRET <valeur>
pnpm --filter @astrotan/backend exec convex env set REVALIDATE_SECRET <valeur>
pnpm --filter @astrotan/backend exec convex env set LEAD_SUBMIT_SECRET <valeur>
pnpm --filter @astrotan/backend exec convex env set CONSENT_LOG_SECRET <valeur>
pnpm --filter @astrotan/backend exec convex env set ROUTING_SECRET <valeur>
# côté VPS — les cinq mêmes valeurs
$EDITOR ~/astrotan/.env
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
- **`LEAD_SUBMIT_SECRET` divergent ou absent** — le formulaire de contact
  refuse **chaque** envoi. `apps/web/src/pages/api/contact.ts` redirige vers
  `/contact?erreur=indisponible` dès que la clé manque, et `convex/leads.ts`
  la recompare en temps constant si elle est présente mais fausse. Le
  formulaire s'affiche, accepte la saisie, et ne transmet jamais rien —
  aucune ligne dans `leads`, aucune erreur dans les logs du conteneur.
- **`CONSENT_LOG_SECRET` divergent ou absent** — le journal de traçabilité du
  consentement n'enregistre rien. `apps/web/src/pages/api/consent.ts` répond
  204 sans corps quelle que soit l'issue, y compris en cas de refus : c'est
  délibéré du point de vue du visiteur (son choix est déjà appliqué dans son
  navigateur), et c'est ce qui rend la panne invisible côté exploitation. Le
  navigateur POSTe pourtant à chaque choix — `apps/web/src/config/consent.ts`
  pose `traceability.enabled: true`. La preuve qu'on croit conserver n'existe
  alors nulle part.
- **`ROUTING_SECRET` divergent ou absent** — c'est la plus lourde des cinq,
  parce qu'elle décide du **routage**. Elle ouvre `routing.hotes`, la query
  qui dit à Traefik quels hôtes servir : le service `routeur` l'interroge
  toutes les trente secondes et en réécrit `/dynamique/routes.yml`, et le
  conteneur `web` l'interroge pour savoir quels hôtes sont les siens — la
  condition, et la seule, pour qu'il honore `x-forwarded-for`. Divergente,
  la query refuse chaque appel. Les conséquences se lisent en deux temps :

  - **Un routage est déjà en place** — le cas ordinaire d'un déploiement qui
    tournait déjà. Il reste **figé** : le site continue de servir, mais
    changer de domaine depuis `/settings/domaine` cesse d'avoir le moindre
    effet, et rien ne le dit hors de `docker compose logs routeur`.
  - **Aucun routage n'est encore en place** — le premier démarrage de la
    version qui a retiré les labels `traefik.http.routers.*.rule`. Le
    service compose alors un routage de **secours** à partir de
    `WEB_DOMAIN` / `ADMIN_DOMAIN` / `UMAMI_DOMAIN` du `.env` du VPS, et le
    site répond. **C'est un filet, pas un régime :** les hôtes servis sont
    ceux du `.env`, pas ceux de l'administration. Le journal du conteneur
    l'écrit en erreur, avec les hôtes retenus.

  Côté `web`, une divergence dégrade en silence : les deux limiteurs de
  débit (`/api/contact`, `/api/consent`) comptent alors tous les visiteurs
  dans un seul seau, `clientAddress` valant l'adresse de Traefik.

Le déploiement Convex a par ailleurs ses propres variables, qui ne
transitent jamais par le VPS (`SITE_URL`, `WEB_SITE_URL`,
`BETTER_AUTH_SECRET`, `SECRETS_KEY`, `RESEND_API_KEY`, `RESEND_TEST_MODE`,
les six jetons de `secrets.ts`) : voir `packages/backend/.env.example`, où
chacune est documentée.

**Trois variables ont fait le chemin inverse et vivent désormais sur Convex
alors qu'elles ressemblent à de la configuration de VPS :** `WEB_DOMAIN`,
`ADMIN_DOMAIN` et `UMAMI_DOMAIN`. Elles ne sont plus interpolées dans les
labels du compose — c'est `routing.hotes` qui les lit, **sur le déploiement
Convex**, comme repli tant que rien n'a été déclaré depuis
`/settings/domaine`. Elles restent aussi dans le `.env` du VPS, à un titre
distinct et non redondant : le service `routeur` s'en sert comme routage de
secours quand la query ne répond pas et qu'aucun routage n'existe.

```bash
pnpm --filter @astrotan/backend exec convex env set WEB_DOMAIN example.com
pnpm --filter @astrotan/backend exec convex env set ADMIN_DOMAIN admin.example.com
# facultative — sa PRÉSENCE est ce qui dit qu'un Umami est déployé
pnpm --filter @astrotan/backend exec convex env set UMAMI_DOMAIN stats.example.com
```

`WEB_DOMAIN` absente de l'environnement **Convex** fait lever
`routing.hotes` en `NOT_CONFIGURED` — exactement comme un `ROUTING_SECRET`
divergent, avec les mêmes deux temps ci-dessus. `pnpm bootstrap` pose les
deux côtés à partir de la même saisie ; le workflow `Deploy`, lui, **ne pose
aucune variable Convex** (section 7).

`SECRETS_KEY` mérite une phrase à elle, parce que son absence ne casse
rien de visible. C'est la clé maîtresse qui chiffre les jetons saisis
depuis l'administration. Sans elle, `secrets.set` refuse proprement
(`SECRETS_KEY_MISSING`, bouton désactivé, commande affichée à l'écran) —
mais toute la famille `secrets` est alors inerte : les sept jetons ne se
posent plus que par `convex env set`, donc `/settings/mesure` et
`/settings/ia` sont décoratifs. `pnpm bootstrap` la génère et la pose ; à
la main, c'est exactement la commande que l'écran affiche :

```bash
cd packages/backend && npx convex env set SECRETS_KEY "$(openssl rand -base64 32)"
```

Elle ne va ni sur le VPS ni en secret GitHub : la poser ailleurs
reviendrait à ranger la clé à côté du coffre. Et elle ne se régénère pas à
la légère — tous les jetons déjà saisis deviennent indéchiffrables et sont
à ressaisir.

## 7. Secrets GitHub

À poser dans *Settings → Secrets and variables → Actions*. Le tableau
ci-dessous fait autorité sur leur provenance et sur la marche à suivre pour
les poser à la main — mais **aucun nombre n'est écrit ici**, parce qu'il a
déjà menti : la liste qui compte est celle que les workflows référencent,

```bash
grep -oh 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u
```

`GITHUB_TOKEN` mis à part (voir plus bas), tout ce que rend cette commande
doit exister dans les réglages du dépôt.

`pnpm bootstrap` en pose la plus grande partie par `gh secret set`, valeur
sur l'entrée standard. Il ne pose **pas** `PUBLIC_UMAMI_WEBSITE_ID`,
`PUBLIC_META_PIXEL_ID` ni `PUBLIC_GOOGLE_TAG_ID` : aucune de ces trois
valeurs n'existe avant qu'un humain ait ouvert Umami (13.1) ou la console de
l'annonceur. Elles se posent à la main, et les laisser vides est un choix
valide — le site ne mesure alors rien et n'appelle aucun tiers.

| Secret | Ce que c'est, et comment l'obtenir |
|---|---|
| `CONVEX_DEPLOY_KEY` | Clé de déploiement du projet Convex de production. Dashboard Convex → le déploiement → *Settings* → *Deploy keys* → *Generate production deploy key*. C'est elle qui autorise `convex deploy` à remplacer schéma et functions : la traiter comme un accès complet au backend. |
| `PUBLIC_CONVEX_URL` | URL `https://<deployment>.convex.cloud` du déploiement de production. **Pas un secret** — elle finit dans le bundle du site. Elle est ici parce que le build de l'image `web` en a besoin en build-arg, pas parce qu'elle serait confidentielle. |
| `VITE_CONVEX_URL` | La même URL, pour le build de l'image `admin` (`src/router.tsx` construit son `ConvexReactClient` avec). Non secrète, même raison. |
| `VITE_CONVEX_SITE_URL` | URL `https://<deployment>.convex.site` — l'origine HTTP du déploiement, celle que Better Auth interroge. Non secrète. |
| `VITE_WEB_SITE_URL` | Origine publique du site Astro (`https://example.com`), à laquelle le dashboard ajoute `/{slug}?t={token}` — l'aperçu s'ouvre à la vraie URL de la page, le jeton signant le slug (CLAUDE.md, invariant 2). Non secrète : seul le jeton l'est, et il est frappé par Convex. |
| `PUBLIC_UMAMI_URL` | `https://<UMAMI_DOMAIN>` — l'adresse du script de mesure. **Pas un secret** : elle est dans le source de chaque page. Elle est ici parce qu'Astro la fige dans le bundle au build, donc elle doit exister au moment du `docker build`, pas au démarrage du conteneur. **Facultative** : sans elle, le site ne mesure rien et n'émet aucune requête vers un tiers. |
| `PUBLIC_UMAMI_WEBSITE_ID` | L'identifiant rendu par Umami après *Add website* (13.1). Non secret, même raison, et facultatif de la même façon : il faut les deux ou aucune. |
| `PUBLIC_UMAMI_RECORDER` | `true` pour charger `recorder.js` en plus — Replays et Heatmaps. Non secrète, facultative, **éteinte par défaut**. Lire 13.6 avant de la poser : ce n'est pas la même promesse que le comptage. |
| `PUBLIC_META_PIXEL_ID` | L'identifiant du pixel Meta, si vous en posez un. **Pas un secret** : il est dans le source de chaque page. Figé au build comme les précédents. **Facultatif**, et son absence est indétectable à l'œil : sans lui ni `PUBLIC_GOOGLE_TAG_ID`, `shouldAskConsent()` rend `false`, le bandeau de consentement ne s'affiche jamais et `/cookies` affiche « Aucun » — ce qui est exactement le comportement légitime d'un site sans traceur. Lire 13.6 : ce n'est pas la même promesse que le comptage d'audience. |
| `PUBLIC_GOOGLE_TAG_ID` | L'identifiant Google Tag (`G-…` / `GT-…`), si vous en posez un. Non secret, figé au build, facultatif, mêmes conséquences que la ligne ci-dessus. C'est lui qui active Google Consent Mode v2 (`src/components/consent/GoogleConsentMode.astro`). |
| `VPS_HOST` | Nom d'hôte ou IP du VPS. |
| `VPS_USER` | L'utilisateur non-root de la section 1. |
| `VPS_SSH_KEY` | Clé **privée** de déploiement, au format OpenSSH, en entier (`-----BEGIN…` à `-----END…` compris). La générer dédiée à cet usage — `ssh-keygen -t ed25519 -C deploy@astrotan -f ~/.ssh/astrotan_deploy` — et poser la publique dans `~/.ssh/authorized_keys` du VPS. Jamais une clé personnelle : elle n'est ni révocable ni traçable séparément. |
| `VPS_SSH_KNOWN_HOSTS` | Empreinte de la clé d'hôte du VPS, produite par `ssh-keyscan -H <host>` (coller la sortie complète). |

`GITHUB_TOKEN` apparaît aussi dans les workflows : il est fourni
automatiquement par GitHub à chaque exécution et sert uniquement au `docker
login ghcr.io`. Il n'y a rien à créer.

**Aucun secret de ce tableau ne concerne le routage, et ce n'est pas un
oubli.** Le service `routeur` (introduit avec le changement de domaine
depuis le dashboard) ne lit rien du build : son image est construite et
poussée par `deploy.yml` comme les deux autres, au même `IMAGE_TAG`, et
tout ce qu'elle lui faut vient du `.env` du VPS et du déploiement Convex.

**Corollaire à connaître avant de déployer : `deploy.yml` ne pose AUCUNE
variable sur le déploiement Convex.** `CONVEX_DEPLOY_KEY` autorise
`convex deploy` à remplacer schéma et functions ; elle ne pose pas
d'environnement. Le seul outil qui pose `ROUTING_SECRET`, `WEB_DOMAIN`,
`ADMIN_DOMAIN` et `UMAMI_DOMAIN` **côté Convex** est `pnpm bootstrap` — et
il ne les pose que depuis qu'il a été enrichi pour cette fonctionnalité.
Tout déploiement amorcé avant ne les a pas, et la section 14 dit quoi
faire.

**Toute variable `PUBLIC_*` ou `VITE_*` de ce tableau a trois moitiés, pas
deux** : un `ARG` dans le Dockerfile de l'image, une ligne `build-args` dans
`deploy.yml`, et le secret lui-même. Il en manque une et la valeur arrive
vide dans le bundle, sans la moindre erreur au build. C'est arrivé aux
`PUBLIC_UMAMI_*` (25b0b43), puis aux deux identifiants de pixels. Les deux
premières moitiés sont désormais vérifiées à chaque CI par
`node scripts/check-env-wiring.mjs` ; la troisième, non — un secret GitHub
absent reste indiscernable d'un secret volontairement vide, et c'est ce qui
rend ces variables réellement facultatives.

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

**Tant que `RESEND_TEST_MODE` n'est pas passé à `false`, aucun email n'est
réellement délivré** — ni une invitation envoyée depuis le dashboard
au-delà de la première (celle de `bootstrap:createInvitation`, qui ne passe
pas par Resend), ni une réinitialisation de mot de passe : Resend accepte
l'envoi et ne le délivre qu'à ses propres adresses de test
(`packages/backend/.env.example` documente la clé). Faites-le maintenant,
une fois un domaine d'expédition vérifié dans le tableau de bord Resend —
pas après qu'un adoptant ait perdu son mot de passe pour le découvrir :

```bash
cd packages/backend && npx convex env set RESEND_TEST_MODE false
```

**Si Umami est utilisé sur ce déploiement (section 13), démarrer la purge
de rétention maintenant.** Le pipeline `Deploy` ne le fait jamais — c'est
volontaire (§13.10) — donc `/confidentialite` annoncerait une purge de 13
mois qui n'existe que si quelqu'un pense à lancer la commande. C'est cette
étape-ci :

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose --profile purge up -d umami-purge'
```

Vérifier qu'elle a bien démarré — `docker compose ps` sans profil ne liste
même pas ce service, « pas démarré » et « n'existe pas » sont donc
indistinguables sans cette commande :

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose --profile purge ps umami-purge'
```

Une ligne `Up`, et non « no such service » ni l'absence de toute ligne,
confirme que la purge tourne. Détail, ce qu'elle purge, et comment vérifier
son effet sans rien supprimer : section 13.10.

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

## 13. Umami : mise en service, lecture et sauvegarde

Umami mesure l'audience du site public. Il tourne dans le même `docker
compose` que le reste, avec sa propre base : **aucune donnée d'audience ne
quitte le VPS**, ce qui est la raison de l'auto-héberger plutôt que
d'utiliser un service tiers. Le prix est écrit franchement : un service et
une base de plus à faire tourner, mettre à jour et sauvegarder.

### 13.1 Le compte d'administration, à changer immédiatement

Umami crée au premier démarrage le compte `admin` / `umami`. Il est le même
sur toutes les installations du monde, et le sous-domaine `UMAMI_DOMAIN` est
public.

**Ouvrir `https://<UMAMI_DOMAIN>` et changer ce mot de passe avant toute
autre chose.** Tant qu'il est celui par défaut, n'importe qui connaissant le
sous-domaine lit vos statistiques et peut les effacer.

Ajouter ensuite le site à mesurer (*Settings → Websites → Add website*) : le
domaine public du site, pas celui d'Umami. Umami rend alors un **Website
ID** — c'est lui qui identifie le site partout ailleurs dans cette section.

### 13.2 Les deux moitiés, et pourquoi elles ne vivent pas au même endroit

La mesure a un côté qui **écrit** et un côté qui **lit**, et ils n'ont ni les
mêmes secrets ni le même lieu.

| | Ce que c'est | Où ça vit |
|---|---|---|
| `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID` | le script de mesure chargé par chaque page | secrets GitHub → build-args, **figés dans le bundle au build** |
| `PUBLIC_UMAMI_RECORDER` *(facultative)* | `"true"` charge en plus `recorder.js` — Replays et Heatmaps (13.6) | même chose, et **éteinte par défaut** |
| `UMAMI_API_URL`, `UMAMI_API_WEBSITE_ID`, `UMAMI_API_USERNAME`, `UMAMI_API_PASSWORD` | les identifiants avec lesquels le dashboard **lit** les chiffres | déploiement Convex (`convex env set`) |
| `UMAMI_API_SHARE_ID` *(optionnelle)* | l'identifiant du lien de partage, pour que le bouton « Statistiques » n'exige pas de reconnexion (13.4) | déploiement Convex (`convex env set`) |

Les premières sont publiques par construction : elles apparaissent dans le
source de chaque page de tout site mesuré par Umami. Les secondes ne le sont
pas, et c'est pour cela que la lecture passe par une `action` Convex
(`convex/analytics.ts`) et non par un appel depuis le navigateur : **un
appel depuis l'admin exposerait ces identifiants à quiconque ouvre les
outils de développement.**

Umami auto-hébergé n'a **pas** de clé d'API — ce mécanisme est réservé à son
offre Cloud. On s'authentifie par `POST /api/auth/login` avec un nom
d'utilisateur et un mot de passe, qui rend un JWT. Les identifiants de
lecture sont donc ceux d'un **compte Umami**, créé dans l'interface d'Umami.

Créer un compte dédié à la lecture (*Settings → Users → Create user*, rôle
`view-only`) plutôt que de réutiliser `admin` : si ce mot de passe fuite, il
ne donne que la lecture, et le révoquer ne vous déconnecte pas vous-même.

```bash
cd packages/backend
npx convex env set UMAMI_API_URL        https://<UMAMI_DOMAIN>
npx convex env set UMAMI_API_WEBSITE_ID <le Website ID de 13.1>
npx convex env set UMAMI_API_USERNAME   <le compte view-only>
npx convex env set UMAMI_API_PASSWORD   <son mot de passe>
```

Les quatre ou aucune : une configuration à moitié posée est traitée comme
absente, et l'éditeur affiche « aucune mesure configurée » plutôt qu'une
erreur. C'est voulu — **un template livré sans Umami ne doit pas avoir l'air
cassé**, et un service d'audience en panne ne doit jamais empêcher d'écrire
une page.

### 13.3 Ce que le navigateur envoie réellement

Umami **compte bien** les visites depuis `localhost`. Une version
antérieure de ce document affirmait le contraire ; c'était faux, et le
croire ferait chasser un problème inexistant — ou pire, prendre de vrais
zéros pour un comportement normal. Mesuré sur la 3.3.1 de ce compose, avec
un vrai navigateur sur `http://127.0.0.1:4331/` : `POST /api/send` répond
`200`.

Voici la charge utile observée dans l'onglet réseau, pas citée depuis une
brochure :

```json
{
  "type": "event",
  "payload": {
    "hostname": "127.0.0.1",
    "language": "fr",
    "referrer": "",
    "screen": "1728x1117",
    "title": "Accueil",
    "url": "http://127.0.0.1:4331/",
    "website": "fb5c1ab0-1c7a-43f5-9d91-748a073605f1"
  }
}
```

Aucun cookie n'est posé, et rien là-dedans n'identifie une personne : pas
d'identifiant stable, pas d'empreinte de navigateur, pas d'adresse IP (le
serveur la voit passer, comme pour toute requête, et ne la conserve pas
telle quelle). C'est ce qui permet de mesurer sans bandeau de
consentement — mais vérifiez-le vous-même dans l'onglet réseau plutôt que
de nous croire sur parole, c'est l'affaire de dix secondes.

**Si l'écran reste à zéro en local**, la cause est ailleurs : les deux
variables `PUBLIC_UMAMI_*` doivent être posées **avant** le build
(`apps/web/.env.local`), parce qu'Astro les fige dans le bundle. Les
ajouter après coup ne change rien tant que le site n'est pas reconstruit.
Le contrôle qui tranche :

```bash
curl -s http://127.0.0.1:4321/ | grep -o 'data-website-id="[^"]*"'
```

Une ligne : la mesure est branchée. Rien : les variables manquaient au
build.

### 13.4 Arriver sur Umami déjà connecté, en un clic

Le bouton « Statistiques » de l'administration ouvre Umami **déjà
connecté**, avec les réglages — pas seulement les chiffres. Umami fournit
le mécanisme ; il faut Redis pour qu'il fonctionne.

Le bouton est une ancre ordinaire vers `/statistiques`, une page de
l'administration qui frappe le jeton puis redirige. Ouvrir un onglet vide
au clic pour le remplir après l'appel réseau paraissait plus direct : c'est
bloqué par certains navigateurs et contextes embarqués même dans un vrai
geste utilisateur, et le bouton ne faisait alors *rien*. Un lien qui ne
fait rien est le pire résultat possible ; une ancre, aucun bloqueur ne
l'arrête.

**Comment ça marche.** Le déploiement Convex s'authentifie auprès d'Umami
avec `UMAMI_API_USERNAME` / `UMAMI_API_PASSWORD`, puis demande à
`POST /api/auth/sso` un **jeton d'échange**. Umami le dépose dans Redis, le
navigateur l'apporte à `/sso?url=/&token=…`, et Umami le consomme en
ouvrant une session.

Ce qui voyage dans l'URL n'est donc pas le mot de passe, ni le jeton du
compte : c'est un jeton à **usage unique et à vie courte**, exactement
comme un lien de connexion par email. Les identifiants, eux, ne quittent
jamais le déploiement Convex.

**Redis est ce qui l'active.** Sans lui, `POST /api/auth/sso` répond
« Redis is disabled » et le bouton retombe sur la page de connexion
d'Umami. Le service `umami-redis` du compose est là pour ça — pas pour la
performance. Il ne persiste rien sur disque : ces jetons expirent en
quelques minutes, et les écrire ferait des sessions un fichier à protéger.

**Le compromis, en clair.** Umami ouvre la session du compte configuré :
ce lien **prête un compte partagé**, il ne délègue pas l'identité de qui
clique. Deux conséquences à assumer :

- L'historique d'Umami ne distinguera pas les personnes. Toutes les actions
  y apparaîtront sous ce compte.
- Ce que le compte peut faire, celui qui clique peut le faire. Si
  `UMAMI_API_USERNAME` est un compte administrateur, le bouton donne
  l'administration d'Umami.

C'est pourquoi **le bouton n'est proposé qu'aux rôles `owner` et `admin`**.
Un éditeur reçoit le lien de consultation à la place — les chiffres du
tableau de bord, eux, restent lisibles par les trois rôles.

Si vous préférez que personne n'arrive administrateur, mettez un compte
`view-only` dans `UMAMI_API_USERNAME` : le clic ouvrira alors une session
en lecture, et régler Umami redemandera un mot de passe.

**Il n'y a rien à faire pour l'activer** au-delà de démarrer la pile : le
compose contient Redis, et les variables `UMAMI_API_*` sont déjà celles
qui servent à lire les chiffres.

### 13.4.1 La solution qu'on n'a pas retenue : deux comptes identiques

Créer, au moment où le propriétaire du site est créé, un compte Umami avec
les mêmes identifiants aurait l'air plus simple. Ça ne l'est pas :

- Le mot de passe en clair devrait partir vers un second service, qui le
  stockerait à son tour. Deux magasins de mots de passe au lieu d'un.
- Ils divergeraient au premier changement : modifier son mot de passe dans
  l'administration ne toucherait pas la copie d'Umami, et personne ne s'en
  apercevrait avant d'en avoir besoin.
- Et ça ne résoudrait pas la question posée : il faudrait **quand même**
  taper ce mot de passe sur le formulaire d'Umami.

Le SSO ci-dessus fait mieux sur les trois points : un seul magasin de mots
de passe, aucune divergence possible, et rien à taper.

### 13.4.2 Le partage en lecture seule, si vous n'utilisez pas le SSO

Le bouton « Statistiques » de l'administration ouvre Umami, qui redemande
un mot de passe. Umami sait éviter ça, et une seule des façons d'y arriver
est acceptable.

**Ce qu'il ne faut pas faire :** faire voyager un jeton dans l'URL. Le
jeton d'Umami est celui d'un compte qui peut écrire, et une URL se dépose
dans l'historique du navigateur, dans les en-têtes `Referer` envoyés aux
sites suivants, et dans les journaux de tout proxy traversé. Un accès en
écriture à vos statistiques resterait lisible longtemps après le clic.

**Ce qu'il faut faire :** le **lien de partage** d'Umami. Dans Umami,
*Settings → Websites → (votre site) → Edit → Share URL*, activer et noter
l'identifiant. La page `/<umami>/share/<id>` affiche alors le tableau de
bord complet, **en lecture seule et sans connexion**.

```bash
cd packages/backend
npx convex env set UMAMI_API_SHARE_ID <l'identifiant de partage>
```

Le bouton mène désormais directement au tableau de bord. Sans cette
variable, il mène à la page de connexion d'Umami — c'est le défaut, et
c'est voulu.

**Le compromis, en clair :** un lien de partage est un *secret porteur*.
Qui l'obtient voit vos statistiques, sans compte et sans trace. Elles ne
contiennent aucune donnée personnelle (c'est la raison d'utiliser Umami),
mais elles disent votre trafic et vos pages qui marchent. L'activer est
une décision, pas un réglage par défaut — d'où la variable optionnelle
plutôt qu'un partage créé automatiquement. Pour révoquer : désactiver le
Share URL dans Umami, l'ancien identifiant cesse immédiatement de
répondre.

**Administrer Umami demande toujours une vraie connexion.** Le partage ne
donne que la lecture, et il n'existe pas de troisième lien qui donnerait
l'accès d'administration sans mot de passe. Vérifié contre 3.3.1 :
`POST /api/auth/login` ne pose **aucun cookie**, et le jeton qu'il rend est
un blob chiffré que le navigateur garde lui-même. L'administration n'a donc
aucun moyen d'ouvrir une session Umami à votre place. La fabriquer
supposerait de recopier `UMAMI_APP_SECRET` dans un second service et d'y
réimplémenter le chiffrement d'Umami — un secret dupliqué, et une
réimplémentation qui casse à la première montée de version.

C'est pourquoi l'administration affiche **deux liens** quand le partage est
actif : « Tout le détail », qui ouvre les chiffres sans connexion, et
« Administrer Umami », qui va à la racine et en demandera une. Un seul
intitulé ferait chercher les réglages là où ils ne sont pas.

### 13.5 Umami en local, avant de toucher au VPS

Tout ce qui suit a été exécuté avant d'être écrit ici. Les pièges cités
sont ceux qui se sont réellement produits, pas ceux qu'on imagine.

**1. Les variables.** Le compose déclare la plupart de ses variables en
`${VAR:?}` — obligatoires. Docker Compose interpole le fichier **entier**
avant de choisir les services à lancer : un `up umami` échoue donc en
réclamant `ACME_EMAIL`, qui ne sert pourtant qu'à Traefik. Poser un
`docker/.env.local` (ignoré par git) avec de vraies valeurs pour les trois
secrets d'Umami et des valeurs bidon pour le reste :

```bash
cd docker
{
  printf 'UMAMI_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  printf 'UMAMI_APP_SECRET=%s\n' "$(openssl rand -hex 32)"
  printf 'UMAMI_TWO_FACTOR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
  cat <<'EOF'
ACME_EMAIL=dev@localhost
WEB_DOMAIN=localhost
ADMIN_DOMAIN=localhost
UMAMI_DOMAIN=localhost
GHCR_OWNER=local
IMAGE_TAG=local
PREVIEW_SECRET=dev-only-not-a-real-secret
REVALIDATE_SECRET=dev-only-not-a-real-secret
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
EOF
} > .env.local
```

**2. Démarrer.** L'override local retire Traefik du chemin et publie Umami
sur le port 3002 de l'hôte :

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d umami
curl -s http://127.0.0.1:3002/api/heartbeat   # {"ok":true}
```

Le premier démarrage applique les migrations Prisma : compter une minute
avant que le heartbeat réponde.

**Si Umami redémarre en boucle avec `password authentication failed for
user "umami"`,** c'est le piège documenté en 13.2 : Postgres n'applique
`POSTGRES_PASSWORD` qu'à **l'initialisation** du volume. Un volume créé
lors d'un essai antérieur porte l'ancien mot de passe, et régénérer le
`.env.local` ne le change pas. Le remède, sans rien détruire :

```bash
docker exec astrotan-umami-db-1 psql -U umami -d umami \
  -c "ALTER USER umami WITH PASSWORD '<celui du .env.local>';"
docker restart astrotan-umami-1
```

**3. Le site à mesurer.** Ouvrir <http://localhost:3002>, se connecter en
`admin` / `umami`, **changer ce mot de passe**, puis *Settings → Websites →
Add website* (domaine : `localhost`). Umami rend un **Website ID**.

**4. Brancher le dashboard de l'admin.**

```bash
cd packages/backend
npx convex env set UMAMI_API_URL        http://127.0.0.1:3002
npx convex env set UMAMI_API_WEBSITE_ID <le Website ID>
npx convex env set UMAMI_API_USERNAME   admin
npx convex env set UMAMI_API_PASSWORD   <votre nouveau mot de passe>
```

**5. Fabriquer des visites.** Le plus simple est de poser les deux
variables `PUBLIC_UMAMI_*` dans `apps/web/.env.local`, de reconstruire le
site et de le visiter : Umami compte les visites depuis `localhost` (13.3).
Pour remplir le tableau de bord sans passer par le navigateur, l'API
d'ingestion accepte aussi les événements directement :

```bash
ID=<le Website ID>
curl -s -X POST http://127.0.0.1:3002/api/send \
  -H 'content-type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36' \
  -d "{\"type\":\"event\",\"payload\":{\"website\":\"$ID\",\"hostname\":\"localhost\",\"url\":\"/contact\",\"referrer\":\"https://www.google.com/\"}}"
```

**L'en-tête `User-Agent` décide si l'événement est gardé, et l'échec est
silencieux.** Mesuré sur 3.3.1 :

| En-tête envoyé | Réponse | Résultat |
|---|---|---|
| absent ou vide | jeton de cache | **écrit** |
| `Mozilla/5.0 … Chrome/140 …` | jeton de cache | **écrit** |
| `curl/8.7.1`, `python-requests/…`, `Googlebot/2.1` | `200 {"beep":"boop"}` | **jeté** |

Une version antérieure de ce document disait « sans lui, Umami rejette
l'événement » : c'est faux dans les deux sens. Ce qui est rejeté, c'est ce
qui *ressemble à un outil* — et le rejet arrive en **HTTP 200**, ce qui le
rend invisible d'un script qui ne regarde que le code de statut. Si un
rapport reste vide après une injection, `{"beep":"boop"}` est la première
chose à chercher.

**6. Arrêter.**

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml down
```

`down` seul, **jamais `down -v`** : le `-v` détruirait le volume (13.8).

### 13.6 Replays et Heatmaps — ce qu'il faut activer des deux côtés

Le menu d'Umami propose Replays et Heatmaps à côté du trafic. Ils ne
marchent pas avec le seul script de comptage : il faut **deux
interrupteurs**, et ils ne sont pas au même endroit.

**1. Côté Umami** — *Settings → (votre site) → Replays & Heatmaps*, activer
l'un ou l'autre. Par API, le champ qui s'écrit est `replayConfig`, pas
`recorderEnabled` : ce dernier est **dérivé** (`replayEnabled ||
heatmapEnabled`) et un POST qui le porte répond 200 sans rien changer.

```bash
curl -X POST "$UMAMI/api/websites/$ID" -H "Authorization: Bearer $TOK" \
  -d '{"replayConfig":{"replayEnabled":true,"sampleRate":1,"maskLevel":"strict"}}'
```

`sampleRate` vaut **0,15 par défaut** : un visiteur sur sept est filmé, pas
tous. Et un enregistrement s'arrête définitivement au bout de 5 minutes,
en silence. Le bloc « Tracking code » de cette page affiche alors une
**seconde balise**, en plus de la première :

```html
<script defer src="https://<UMAMI_DOMAIN>/recorder.js" data-website-id="…"></script>
```

**2. Côté site** — poser `PUBLIC_UMAMI_RECORDER=true` (secret GitHub ou
`apps/web/.env.local`) et **reconstruire**. `Analytics.astro` émet alors la
seconde balise.

Les deux sont nécessaires et l'ordre est indifférent, mais l'un sans
l'autre ne produit rien : sans l'interrupteur d'Umami, `recorder.js` est
chargé pour rien ; sans la variable, l'interrupteur n'a aucun script à
commander. Le contrôle qui tranche, dans l'onglet réseau d'une page du
site :

```
GET  /recorder.js                         → 200
GET  /api/websites/<id>/recorder          → 200
POST /api/send                            → 200
```

La deuxième ligne est la plus parlante : l'enregistreur demande sa
configuration au serveur, donc l'interrupteur d'Umami commande vraiment.

**Ce n'est pas la même promesse que le comptage, et c'est la raison pour
laquelle cette variable est séparée et éteinte par défaut.** Compter une
visite note qu'une page a été vue. Un *replay* rejoue ce qu'une personne a
fait sur cette page : ses mouvements, ses clics, et selon la configuration
ce qu'elle a saisi. Une *heatmap* agrège ces mêmes traces.

Conséquences à peser avant d'allumer :

- La charge utile n'est plus celle de §13.3. L'argument « sans cookie et
  sans donnée personnelle, donc sans bandeau de consentement » ne tient
  plus tel quel — en Europe, un enregistrement de session relève d'un autre
  régime, et le formulaire de contact du site est exactement le genre
  d'endroit où quelqu'un tape son nom et son adresse.
- Le volume de données change d'ordre de grandeur. `recorder.js` pèse
  ~190 ko, et chaque session écrit dans la base d'Umami — celle-là même
  que §13.7 dit de sauvegarder.
- **Le masquage protège ce qui est tapé, pas ce qui est affiché.** Mesuré
  sur le réseau : une saisie part en astérisques — 22 caractères tapés
  donnent 22 astérisques, champ mot de passe compris — donc le contenu ne
  fuit pas, mais **la longueur exacte et la cadence de frappe partent**. Et
  en `moderate`, qui est le défaut, **tout le texte statique de la page part
  en clair** : un nom déjà affiché par votre serveur, un récapitulatif de
  commande. `maskLevel` n'a que deux valeurs, `strict` et `moderate`.
- **Il n'existe aucune suppression unitaire d'un enregistrement.** Le seul
  chemin est `DELETE /api/websites/{id}/sessions/{sessionId}`, qui emporte
  aussi les vues de page de cette session. À savoir **avant** de recevoir
  une demande d'effacement, pas pendant.
- Aucun mécanisme de rétention automatique n'a été trouvé : ce qui est
  enregistré reste jusqu'à suppression manuelle.

Allumer est un choix légitime ; le faire sans avoir lu ces trois points ne
l'est pas.

### 13.7 Ce que l'API d'Umami 3 rend vraiment

Trois différences avec Umami 2 ont été trouvées en interrogeant un 3.3.1
réel. Les trois sont **silencieuses** : elles ne produisent pas d'erreur,
elles produisent des chiffres faux. Elles sont épinglées par des tests
dans `packages/backend/convex/analytics.test.ts` — les rouvrir casserait
ces tests plutôt que le tableau de bord.

| Ce qu'on croit | Ce qu'Umami 3 fait |
|---|---|
| `/stats` rend `{value, prev}` par métrique | Il rend des **nombres plats**, plus un objet `comparison` frère. Lu à l'ancienne, chaque chiffre sort à zéro. |
| `?url=/contact` filtre sur une page | **Ignoré sans erreur** : la réponse est celle du site entier. Le paramètre s'appelle `path`. Vérifié : `url=/contact` → 11 vues, `path=/contact` → 2. |
| `/metrics` rend des vues | Il rend des **visites**, une par session. Mesuré : `/` à 2 par `/metrics`, 5 vues par `/stats?path=/`. |
| `comparison` exige `compare=prev` | Non — il est rempli dans les deux cas. Ce document a affirmé le contraire : l'essai « sans drapeau » portait sur une période précédente vide, un facteur de confusion. |

Un quatrième point échoue franchement, lui : `type=url` sur `/metrics`
répond 400. Le type s'appelle `path`.

### 13.8 Sauvegarde — la première du projet

Le volume `astrotan_umami-db` est le **premier volume applicatif** de ce
VPS. Jusqu'ici, la seule chose à ne pas perdre était `astrotan_acme`, et le
contenu du site vit dans Convex, qui a ses propres sauvegardes. Ce n'est
plus vrai : les données d'audience n'existent qu'ici.

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose exec -T umami-db \
  pg_dump -U umami umami | gzip' > umami-$(date +%F).sql.gz
```

Restauration :

```bash
gunzip -c umami-<date>.sql.gz | ssh <user>@<host> \
  'cd ~/astrotan && docker compose exec -T umami-db psql -U umami umami'
```

`docker compose down -v` détruit ce volume. **Ne jamais lancer `down -v` sur
ce VPS** — `down` seul suffit à arrêter la pile.

### 13.9 Mettre à jour Umami

Le tag de l'image est épinglé exactement (`3.3.1`), jamais `latest`. Une
montée de version applique des migrations Prisma sur la base au premier
démarrage : **faire le dump de 13.8 avant**, puis changer le tag et
redéployer. Un retour arrière se fait par restauration du dump, pas par un
retour au tag précédent — une base déjà migrée n'est plus lisible par
l'ancienne version.

### 13.10 Rétention — la purge des 13 mois

`/confidentialite` annonce 13 mois de conservation pour les statistiques
d'audience. Côté Convex, `retention.ts` purge déjà `leads` (3 ans) et
`consentRecords` (365 jours) sur un cron mensuel (`crons.ts`) — mais Umami
vit dans son propre PostgreSQL, hors de portée de ce cron : aucun code
Convex ne peut l'atteindre. C'est le rôle du service `umami-purge` du
compose.

**Ce qui est purgé, et pourquoi ce n'est pas qu'une table.** Umami n'a
aucune contrainte de clé étrangère sur cette base — vérifié en interrogeant
`information_schema.table_constraints` ET `pg_constraint` : zéro ligne
`FOREIGN KEY`. Purger seulement `website_event` et `session` laisserait
donc des lignes orphelines dans tout ce qui pend de l'un ou de l'autre. La
requête (`docker/umami-purge.sql`) purge neuf tables dans une seule
transaction : `event_data`, `heatmap_event`, `revenue`, `session_data`,
`session_link` et `session_replay` sur leur propre `created_at` ;
`website_event` de même ; et deux exceptions dont la propre date ne dit pas
la bonne chose — `session` (purgée seulement si en plus aucun
`website_event` ne la référence encore, pour ne pas casser les
ventilations pays/navigateur/appareil d'une session que le décalage du sel
d'Umami garde active jusqu'à un mois après sa création) et
`session_replay_saved` (un replay épinglé par un administrateur, purgé dès
que son replay sous-jacent a disparu, **quel que soit l'âge de
l'épinglage** — épingler ne prolonge jamais la conservation au-delà de la
durée publiée). Le raisonnement complet, avec les deux cas exacts que ces
exceptions évitent, est dans l'en-tête du fichier SQL — à lire avant d'y
toucher. Volontairement absentes de la purge : `website`, `user`, `team`,
`team_user`, `app_setting`, `board`, `link`, `pixel`, `report`, `segment`,
`share`, `two_factor_*` — des comptes, des réglages ou des définitions
(tableaux de bord, segments, rapports), pas de la donnée d'audience
horodatée par visite.

`apps/web/src/config/legal.test.ts` relit ce fichier SQL et vérifie que la
durée qu'il applique (13 mois, répétée à l'identique partout où elle
apparaît) est celle que `/confidentialite` publie : les deux ne peuvent pas
diverger en silence.

**Démarrage, volontaire et unique.** Le service porte `profiles: [purge]` :
un `docker compose up` ordinaire, en développement comme sur le VPS
(y compris celui du workflow `Deploy`, section 8), ne le démarre jamais —
voir section 8 pour l'étape qui le démarre après le premier déploiement.

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose --profile purge up -d umami-purge'
```

Il tourne ensuite en boucle interne — une purge immédiate, puis une par
mois — et `restart: unless-stopped` le fait survivre aux redémarrages de
l'hôte. **Toujours avec `--profile purge`** pour le retrouver ensuite : sans
ce drapeau, `docker compose ps` ne liste même pas ce service, et « pas
démarré » devient indistinguable de « n'existe pas ».

```bash
ssh <user>@<host> 'cd ~/astrotan && docker compose --profile purge ps umami-purge && docker compose --profile purge logs --tail 20 umami-purge'
```

**Compter avant de croire qu'il ne fait rien.** Un site jeune n'a par
construction aucune ligne de plus de 13 mois : le service tourne, ne
supprime rien, et c'est le comportement correct. Pour le vérifier **sans
aucun risque**, compter — une requête en lecture seule, rien à annuler :

```bash
docker compose exec umami-db psql -U umami -d umami -c \
  "SELECT count(*) FROM website_event WHERE created_at < now() - interval '13 months';"
```

Zéro sur une instance jeune est le résultat attendu, pas un signe de panne.

**Variante avancée, pour éprouver le `DELETE` lui-même** — à réserver à
quelqu'un qui a lu la commande en entier avant de l'exécuter, jamais à
copier sans la relire : elle contient un `DELETE` réel, protégé par une
transaction qu'il faut annuler explicitement. Un `ROLLBACK` perdu ou
remplacé par erreur (par un `COMMIT`, par exemple) supprime réellement les
lignes de la fenêtre choisie.

```bash
docker compose exec umami-db psql -U umami -d umami -c \
  "BEGIN; DELETE FROM website_event WHERE created_at < now() - interval '30 seconds'; ROLLBACK;"
```

Le nombre de lignes annoncé par `DELETE` est celui qu'une vraie purge aurait
supprimé sur cette fenêtre ; `ROLLBACK` garantit que rien ne l'est
réellement.

**Sauvegarder avant la première purge.** Cette purge est irréversible sur
des données que la 13.8 est seule à couvrir : faire un dump avant de lancer
`umami-purge` pour la première fois sur une base qui contient déjà de la
donnée ancienne.

---

## 14. Mise à jour depuis une version antérieure du template

Les deux sections ci-dessous se lisent **avant** de déployer, dans l'ordre :
14.1 est la plus récente et la seule qui puisse mettre le site entier hors
ligne.

### 14.1 Le routage a quitté les labels Docker

Si votre VPS tourne avec une version antérieure au **changement de domaine
depuis le dashboard**, cette mise à jour déplace le routage. Reconnaître la
situation en une commande, sur le VPS :

```bash
grep -c 'routers\..*\.rule' ~/astrotan/docker-compose.yml   # > 0 = version antérieure
```

**Ce qui change.** Les labels `traefik.http.routers.{web,admin,umami}.rule`
sont supprimés du compose. Un label ne change qu'en **recréant** le
conteneur, donc en repassant par un déploiement et par SSH ; c'est ce qui
rendait un changement de domaine impossible depuis l'interface. Les règles
viennent désormais de `/dynamique/routes.yml`, écrit par un nouveau service
— `routeur` — et relu **à chaud** par le provider fichier de Traefik. Deux
nouveautés en découlent :

- un service `routeur` de plus, tiré au même `IMAGE_TAG` que les autres ;
- un volume `astrotan_dynamique`, monté en écriture par `routeur` et en
  **lecture seule** par Traefik. Rien à créer : `compose up` s'en charge.

**Les trois gestes à faire AVANT de déployer.** Ils sont à faire dans cet
ordre, et le second est celui qu'on oublie.

1. **`ROUTING_SECRET` dans le `.env` du VPS.** Le compose l'exige en
   `${ROUTING_SECRET:?…}` : sans elle, `compose up` refuse de démarrer en la
   nommant — panne franche, pendant le déploiement.

   ```bash
   ssh <user>@<host> "printf 'ROUTING_SECRET=%s\n' \"$(openssl rand -hex 32)\" >> ~/astrotan/.env"
   ```

2. **La MÊME valeur sur le déploiement Convex, plus les trois domaines.**
   C'est la moitié qu'aucun workflow ne pose (section 7) : `deploy.yml` ne
   touche jamais à l'environnement Convex. Reprendre la valeur exacte écrite
   à l'étape 1 :

   ```bash
   cd packages/backend
   npx convex env set ROUTING_SECRET <la même valeur qu'au 1>
   npx convex env set WEB_DOMAIN   example.com
   npx convex env set ADMIN_DOMAIN admin.example.com
   npx convex env set UMAMI_DOMAIN stats.example.com   # seulement si Umami est déployé
   ```

   Vérifier avant de déployer : `npx convex env list` doit montrer les
   quatre (trois sans Umami).

3. **Ne retirez ni `WEB_DOMAIN`, ni `ADMIN_DOMAIN`, ni `UMAMI_DOMAIN` du
   `.env` du VPS.** Elles ne sont plus interpolées dans les labels et
   ressemblent donc à des lignes mortes : elles ne le sont pas. Le service
   `routeur` s'en sert comme **routage de secours**, et `WEB_DOMAIN` y est
   exigée en `${WEB_DOMAIN:?…}` — le `.env` d'une version antérieure la
   porte déjà, il n'y a rien à ajouter, seulement à ne rien supprimer.

**Pourquoi l'étape 2 n'est pas négociable, et ce qui arrive si on l'oublie.**
Le `${ROUTING_SECRET:?}` du compose fait échouer franchement `compose up`,
et la réparation évidente est de poser la ligne dans le `.env` — l'étape 1
seule. Mais la query `routing.hotes` est gardée par la valeur posée **côté
Convex** : sans l'étape 2, elle refuse chaque appel. Le service ne peut
alors rien lire, et il n'existe encore aucun `/dynamique/routes.yml`
puisque les labels viennent d'être retirés. **Avant que ce repli n'existe,
c'était un 404 permanent sur le site comme sur l'administration**, sans
issue par l'interface.

Ce n'est plus le cas : quand la lecture échoue *et* qu'aucun routage n'est
en place, `routeur` compose les routes depuis `WEB_DOMAIN` /
`ADMIN_DOMAIN` / `UMAMI_DOMAIN` du `.env` du conteneur. Le site répond.
Mais **le filet ne remplace pas les étapes 1 et 2** : tant que la query
refuse, les hôtes servis sont ceux du `.env` et `/settings/domaine` reste
sans effet. Le seul témoin est le journal :

```bash
ssh <user>@<host> "cd astrotan && docker compose logs --tail=50 routeur"
```

Ce qu'on veut y lire, en régime normal, est `routage écrit : …`. Un
`routage de SECOURS écrit …` dit que l'étape 2 manque. Un
`lecture des hôtes impossible` répété sans écriture dit la même chose sur
un déploiement qui, lui, avait déjà un routage — il est **figé**.

**Le premier déploiement coûte une fenêtre de quelques dizaines de
secondes.** Deux lectures concordantes sont exigées avant la première
écriture (l'anti-battement qui protège le quota Let's Encrypt), et le
volume est encore vide pendant ce temps : Traefik ne connaît aucune route et
le site répond 404. Les déploiements suivants ne repayent rien — le fichier
persiste dans le volume et Traefik le lit dès son démarrage.

**Les certificats déjà obtenus sont conservés** : ils vivent dans le volume
`astrotan_acme`, que rien de tout ceci ne touche.

**Si `astrotan_dynamique` a été créé à `root`** (cas d'un `up traefik` seul
sur une pile antérieure), `routeur` échoue à chaque écriture en `EACCES`,
bruyamment dans ses journaux. Le remède tient en deux lignes, et ne perd
rien — la passe suivante réécrit tout :

```bash
docker compose down && docker volume rm astrotan_dynamique && docker compose up -d
```

### 14.2 Traefik est passé en configuration par variables d'environnement

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
