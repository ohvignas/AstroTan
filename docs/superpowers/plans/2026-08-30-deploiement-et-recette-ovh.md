# Déploiement et recette complète sur un serveur OVH — Plan

> **Ce plan est écrit pour un humain devant un terminal, pas pour un agent.** Il
> suppose que vous n'avez jamais lu ce dépôt. Chaque étape porte la commande
> exacte, **ce qu'on attend**, et **ce que signifie un échec**. Les étapes sont
> cochables (`- [ ]`) pour être suivies dans l'ordre.

**But :** mettre AstroTan en ligne sur un VPS OVHcloud, puis **prouver** — pas
supposer — que les quatre mécanismes que personne n'a jamais exercés sur une
vraie machine fonctionnent : le routage par fichier surveillé, le rechargement à
chaud de Traefik, le repli de routage au premier démarrage, et le rollback.

**Le fait qui justifie ce plan.** Tout ce qui a été construit les 29 et
30 août 2026 a été vérifié contre un backend Convex local anonyme et un serveur
de développement — appels HTTP réels, empreintes observées, mutants tués — mais
**jamais contre un déploiement**. Or le lot a touché précisément ce qui ne
s'exerce qu'au déploiement :

| Ce qui a changé | Ce que ça casse si c'est faux | Jamais exercé parce que… |
|---|---|---|
| Les règles Traefik ont quitté les labels Docker pour `/dynamique/routes.yml`, écrit par un service `routeur` | **Rien ne route.** Site et administration en 404, sans issue par l'interface | il faut une vraie pile Traefik |
| Le provider fichier de Traefik est censé relire à chaud | Changer de domaine depuis le dashboard n'a **aucun** effet jusqu'au prochain déploiement | idem — consigné `NON PROUVÉ` dans le registre d'exécution |
| L'image `web` n'est **jamais** construite en CI (seule celle de l'admin l'est) | Une erreur de build du site est vue sur `main`, pas sur la PR | son build exige un déploiement Convex joignable *pendant* le build |
| `web.Dockerfile` a perdu son `ARG WEB_DOMAIN` et le contrôle qui l'accompagnait | La validation d'hôte ne dépend plus du build : elle est lue au runtime depuis Convex | même raison |

Sources du dépôt, à avoir ouvertes : [`CLAUDE.md`](../../../CLAUDE.md),
[`AGENTS.md`](../../../AGENTS.md), et surtout
[`docker/README.md`](../../../docker/README.md) — le manuel d'exploitation, dont
la §14.1 est neuve et décrit exactement le déplacement du routage. Les réserves
assumées sont dans
`.superpowers/sdd/2026-08-30-changer-de-domaine-depuis-le-dashboard/progress.md`.

**Branche :** `lot1-socle`. **Spec :**
[`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md).

---

## Paramètres de l'installation

**Remplissez ce bloc une fois et exportez-le dans chaque shell** que vous
ouvrirez pendant ce plan. Toutes les commandes du document s'y réfèrent : il n'y
a aucun trou à combler au milieu d'une ligne de commande.

```bash
# ── Domaines ────────────────────────────────────────────────────────────────
export WEB_DOMAIN=exemple.fr              # le site public, hôte NU (pas d'https://)
export ADMIN_DOMAIN=admin.exemple.fr      # le dashboard
export UMAMI_DOMAIN=stats.exemple.fr      # laisser VIDE si vous ne déployez pas Umami

# ── Le VPS OVH ──────────────────────────────────────────────────────────────
export VPS_IP4=203.0.113.10               # IPv4 du VPS (panel OVH → VPS → onglet « IP »)
export VPS_IP6=                           # IPv6 du VPS, ou VIDE si vous n'en publiez pas
export VPS_USER=deploy                    # utilisateur NON-root, membre du groupe docker
export VPS_HOST="$VPS_IP4"                # ce que ssh vise (IP, ou un nom qui y mène)

# ── GitHub / GHCR ───────────────────────────────────────────────────────────
export GITHUB_REPOSITORY=moncompte/astrotan   # owner/nom du dépôt CLONÉ
export GHCR_OWNER=moncompte                   # EN MINUSCULES — GHCR refuse les majuscules

# ── Convex ──────────────────────────────────────────────────────────────────
export CONVEX_CLOUD_URL=https://xxx-yyy-123.convex.cloud
export CONVEX_SITE_URL=https://xxx-yyy-123.convex.site

# ── Adresses ────────────────────────────────────────────────────────────────
export ACME_EMAIL=vous@exemple.fr         # avis d'expiration Let's Encrypt
export ADMIN_EMAIL=vous@exemple.fr        # le PREMIER compte owner du dashboard

# ── Confort ─────────────────────────────────────────────────────────────────
export SSH="ssh $VPS_USER@$VPS_HOST"
export DC="cd ~/astrotan && docker compose"
```

Deux paramètres n'existent pas encore et se rempliront en cours de route :

- `SHA_N` — le sha du **premier** déploiement réussi.
- `SHA_N1` — le sha du **deuxième**, celui depuis lequel on rollbackera.

**Convention de lecture.** `$SSH "$DC ps"` signifie : exécuter
`docker compose ps` dans `~/astrotan` sur le VPS. Vous pouvez aussi ouvrir une
session SSH et travailler dedans — c'est équivalent et souvent plus confortable.

---

## Ce que ce plan prouve, et dans quel ordre

| # | Propriété | Prouvée en phase |
|---|---|---|
| 1 | Le repli de routage tient le site debout quand `routing.hotes` refuse **et** qu'aucun fichier de routes n'existe | 5 |
| 2 | Traefik relit `/dynamique/routes.yml` **à chaud**, sans redémarrage ni déploiement | 7 |
| 3 | Le changement de domaine depuis `/settings/domaine` fait effectivement suivre routage, certificat et authentification | 8.2 |
| 4 | Le rollback rejoue le pipeline entier sur un sha et ramène l'état antérieur | 10 |

Les phases 1 à 4 amènent le serveur à l'état où ces quatre preuves sont
possibles. Les phases 9, 11, 12 et 13 sont la recette et l'exploitation.

---

## Phase 1 — Avant de toucher au serveur

Rien ici ne touche à OVH. Tout ce qui manque à cette phase se paie plus tard,
au milieu d'un déploiement à moitié fait.

- [ ] **1.1 — Le poste de travail a les bons outils.**

  ```bash
  node --version          # attendu : v22.x  (corepack a été retiré de Node ≥ 25)
  corepack enable
  pnpm --version          # attendu : 10.34.5 exactement
  gh auth status          # doit dire « Logged in to github.com »
  openssl version
  dig -v 2>&1 | head -1   # ou `apt install dnsutils` / `brew install bind`
  ```

  **Attendu :** les cinq répondent. **Si `pnpm` n'est pas en 10.34.5 :**
  ne le montez pas « pour voir ». Les versions 11.19.0 à 11.23.x cassent
  `pnpm deploy --legacy` en symlinkant les dépendances workspace au lieu de les
  copier — l'image se construit **sans erreur** et le conteneur meurt au
  démarrage sur `Cannot find module` (`docker/README.md` §11). `corepack enable`
  à la racine du dépôt vous donne la version épinglée par `packageManager`.

- [ ] **1.2 — Le dépôt est installé et vert.**

  ```bash
  cd /chemin/vers/AstroTan
  git checkout lot1-socle && git pull
  pnpm install --frozen-lockfile
  pnpm typecheck && pnpm lint && pnpm test
  ```

  **Attendu :** ≈ 1063 tests backend, 352 admin, 211 web, 34 routeur, tous verts.
  **Si `codegen` échoue en disant que `convex/_generated` manque :** c'est un
  clone à froid. Il faut un `npx convex dev --once` réel contre un déploiement
  joignable — voir 1.4. Ne régénérez **jamais** `_generated` à la main.

- [ ] **1.3 — Les comptes tiers existent.**

  | Compte | Ce qu'il faut avoir en main | Obligatoire ? |
  |---|---|---|
  | GitHub | le dépôt cloné, sous `$GITHUB_REPOSITORY` | oui |
  | Convex | un projet, et une **clé de déploiement de production** (Dashboard → le déploiement → Settings → Deploy keys) | oui |
  | OVHcloud | un VPS commandé et démarré, l'accès au panel | oui |
  | Registrar du domaine | l'accès à la zone DNS — **pas forcément OVH**, voir phase 3 | oui |
  | Resend | un compte, une clé d'API, et un domaine d'expédition **vérifié** | oui si vous voulez que les emails partent |

  **Si vous n'avez pas encore de compte Resend :** vous pouvez déployer sans,
  mais les phases 8.3 (mot de passe oublié) et 8.4 (notification de lead) seront
  bloquées, et `RESEND_TEST_MODE` restera à `true` — Resend **accepte** alors
  chaque envoi et ne le délivre qu'à ses propres adresses de test. C'est le
  piège numéro un de ce plan : rien n'échoue, rien n'arrive.

- [ ] **1.4 — Le déploiement Convex de production existe.**

  Depuis un **vrai terminal interactif** (`convex dev` pend sans TTY) :

  ```bash
  cd packages/backend && npx convex dev
  ```

  Laissez-le créer le projet, notez les deux URL `*.convex.cloud` et
  `*.convex.site`, puis `Ctrl-C`. Reportez-les dans `CONVEX_CLOUD_URL` et
  `CONVEX_SITE_URL` du bloc de paramètres.

  **Si vous n'avez pas de terminal interactif :** créez le projet depuis le
  dashboard Convex. Les deux URL y sont affichées.

- [ ] **1.5 — La clé SSH de déploiement, dédiée.**

  ```bash
  ssh-keygen -t ed25519 -C deploy@astrotan -f ~/.ssh/astrotan_deploy -N ''
  ```

  **`-N ''` n'est pas de la paresse :** un runner GitHub ne peut pas déverrouiller
  une clé protégée par passphrase, et `scripts/bootstrap.mjs` la refuse
  explicitement pour cette raison. **Jamais votre clé personnelle :** elle n'est
  ni révocable ni traçable séparément.

- [ ] **1.6 — La décision GHCR, prise maintenant.**

  Les packages GHCR sont **privés par défaut**, et le pipeline ne pousse jamais
  de credentials sur le VPS. Choisissez :

  1. **Packages publics** (le plus simple, aucun secret sur la machine) — à faire
     *après* le premier `Deploy`, puisque les packages n'existent pas avant.
     GitHub → Packages → `astrotan-web` → Package settings → Change visibility →
     Public. Idem `astrotan-admin` **et `astrotan-routeur`**.
  2. **Packages privés** — une fois, sur le VPS, avec un PAT au seul scope
     `read:packages` :
     ```bash
     $SSH 'echo <PAT> | docker login ghcr.io -u <compte-github> --password-stdin'
     ```

  **Attendu, quoi qu'il arrive :** le **premier** `Deploy` échoue au
  `docker compose pull` avec `denied`. C'est normal — les packages viennent
  d'apparaître. Basculez-les et relancez le workflow.
  **Si l'échec est au *push* et non au *pull* :** un package du même nom existe
  déjà sur le compte sans être **lié** à ce dépôt. Remède : réglages du package
  → *Manage Actions access* → ajouter le dépôt en `Write`.

  **Trois images, pas deux.** `astrotan-routeur` est arrivée avec le changement
  de domaine ; l'oublier fait échouer le `compose pull` sur une image absente.

- [ ] **1.7 — L'identité légale : Hostinger doit disparaître du dépôt.**

  `apps/web/src/config/legal.ts` code en dur **Hostinger** comme hébergeur :

  ```
  legalHost = { name: "Hostinger International Ltd.",
                address: "61 Lordou Vironos Street, 6023 Larnaca, Chypre", … }
  ```

  Vous déployez chez OVH : cette mention serait **fausse** sur `/mentions-legales`.

  1. Remplissez `legalEntity` (votre raison sociale, adresse, directeur de
     publication, email) et `legalHost` avec l'identité d'OVHcloud telle qu'elle
     figure sur **ses propres mentions légales, relevées le jour de
     l'installation** — ce plan ne la recopie pas de mémoire (voir « Questions
     OVH ouvertes », Q9).
  2. Vérifiez aussi `apps/web/src/config/facts.ts` et `nav.ts`.
  3. Passez `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` à `false`.
  4. `pnpm test`.

  **Attendu :** vert. **Si le test rougit,** il **nomme** la valeur d'exemple
  restée en place — continuez jusqu'au vert. **Tant que le marqueur vaut `true`,**
  les trois pages légales n'affichent aucune identité et se forcent en `noindex` :
  le site ne publie donc jamais une fausse identité, mais il ne publie pas la
  vôtre non plus.

---

## Phase 2 — Le serveur OVH : ce qui diffère de Hostinger

**Toute la documentation du dépôt est écrite pour un VPS Hostinger.**
`docker/README.md` §1 et §3 le nomment. Cette phase remplace §1 pour OVH. Les
points OVH que ce plan ne peut pas affirmer avec certitude sont **posés en
question** à la fin du document plutôt qu'inventés — vérifiez-les dans le panel
avant de continuer.

- [ ] **2.1 — Repérer les trois endroits du panel OVHcloud.**

  Le panel OVH est découpé en univers, et les trois choses dont vous avez besoin
  n'y sont pas au même endroit :

  | Ce que vous cherchez | Où |
  |---|---|
  | Le VPS, son IP, la console, le mode rescue, les snapshots | **Bare Metal Cloud** → *Serveurs privés virtuels* → votre VPS |
  | Le **pare-feu réseau** et le **reverse DNS** | même univers, section ***IP*** (le pare-feu est attaché à l'IP, pas au serveur) |
  | La **zone DNS** du domaine | **Web Cloud** → *Noms de domaine* → votre domaine → *Zone DNS* |

  **Si votre domaine n'apparaît pas sous « Noms de domaine » :** il n'est pas
  chez OVH, et la zone se modifie chez votre registrar. Voir 3.1.

- [ ] **2.2 — Accès SSH et utilisateur non-root.**

  OVH livre le VPS avec un utilisateur non-root (`ubuntu`, `debian`, selon
  l'image) et l'accès root SSH généralement désactivé. Le pipeline **ne fait
  jamais de `sudo`** : un `sudo` demandé au milieu d'une session SSH non
  interactive bloque le déploiement sans message exploitable.

  ```bash
  ssh <utilisateur-initial>@$VPS_IP4
  sudo adduser --disabled-password --gecos '' deploy   # ou réutilisez l'existant
  sudo usermod -aG docker deploy
  sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  sudo tee /home/deploy/.ssh/authorized_keys < ~/.ssh/astrotan_deploy.pub  # depuis le poste
  sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
  sudo chmod 600 /home/deploy/.ssh/authorized_keys
  ```

  Puis, **depuis le poste**, la vérification qui compte :

  ```bash
  ssh -i ~/.ssh/astrotan_deploy $VPS_USER@$VPS_HOST 'id && docker ps'
  ```

  **Attendu :** la sortie de `id` contient `docker`, et `docker ps` répond une
  table (vide) **sans** demander de mot de passe.
  **Si `docker ps` répond `permission denied` :** l'appartenance au groupe
  `docker` n'est pas encore prise en compte — refermez et rouvrez la session SSH.
  **Si SSH demande un mot de passe :** la clé publique n'est pas en place, et le
  déploiement échouera de la même façon depuis GitHub Actions.

- [ ] **2.3 — Docker Engine et Compose v2.**

  ```bash
  $SSH 'docker compose version && rsync --version | head -1'
  ```

  **Attendu :** `Docker Compose version v2.x` et une version de `rsync`.
  **Si `docker compose` répond « is not a docker command » :** vous avez
  `docker-compose` v1, qui ne comprend ni la syntaxe `${VAR:?message}` utilisée
  partout dans ce compose, ni la clé `name:`. Installez le plugin Compose v2.
  **Si `rsync` manque :** le workflow `Deploy` échoue à l'étape *Ship the compose
  stack* sans autre diagnostic que `rsync: command not found`.

- [ ] **2.4 — Rien d'autre n'écoute sur 80 et 443.**

  ```bash
  $SSH 'sudo ss -lntp | grep -E ":(80|443)\b" || echo LIBRE'
  ```

  **Attendu :** `LIBRE`. **Si un `nginx` ou un `apache2` apparaît** (certaines
  images OVH avec panel préinstallé) : Traefik ne démarrera pas
  (`bind: address already in use`). Désactivez-le **avant** le premier `up` :
  `sudo systemctl disable --now nginx`.

- [ ] **2.5 — Le pare-feu réseau OVH, qui filtre *en amont de la machine*.**

  **C'est la principale différence avec Hostinger, et elle est invisible depuis
  le serveur.** OVH propose un pare-feu qui s'applique **sur le réseau, avant que
  le paquet n'atteigne le VPS** : `ss`, `iptables` et `ufw` ne le voient pas, et
  un port peut être ouvert sur la machine tout en étant bloqué en amont.

  Panel → section **IP** → l'IP du VPS → *Pare-feu réseau*.

  **Deux propriétés à vérifier vous-même dans le panel avant de continuer,
  parce qu'elles décident de la suite** (elles sont aussi en Q1 des questions
  ouvertes) :

  1. **Le pare-feu est-il activé sur cette IP ?** S'il est désactivé, il n'y a
     rien à faire — passez à 2.6.
  2. **S'il est activé, il filtre le trafic entrant et il est *sans état*.**
     Un jeu de règles « autoriser 80 et 443, refuser le reste » bloque alors
     **le trafic retour de vos connexions sortantes** : `apt update`,
     `docker pull`, les appels de Convex vers Resend, la résolution DNS. Il faut
     une règle qui autorise le TCP *established* en plus des ports ouverts.

  Le jeu de règles minimal, si le pare-feu est activé :

  | Priorité | Protocole | Port | Action | Pourquoi |
  |---|---|---|---|---|
  | 0 | TCP | 22 | Autoriser | SSH — sinon vous vous verrouillez dehors |
  | 1 | TCP | 80 | Autoriser | **challenge HTTP-01 de Let's Encrypt** + redirection vers 443 |
  | 2 | TCP | 443 | Autoriser | le site |
  | 3 | TCP | — (option *established*) | Autoriser | le trafic retour des connexions sortantes |
  | 19 | tout | — | Refuser | la règle de fin |

  **Le port 80 n'est pas décoratif.** Le résolveur ACME est configuré en
  `httpChallenge` (`TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_HTTPCHALLENGE_ENTRYPOINT: web`).
  Le fermer une fois les certificats obtenus casse leur renouvellement 60 jours
  plus tard — c'est-à-dire longtemps après qu'on ait oublié l'avoir fermé.

  La vérification, **depuis l'extérieur du VPS** (une machine tierce, ou votre
  poste) — elle est la seule qui teste le chemin réel :

  ```bash
  nc -vz -w 5 $VPS_IP4 22
  nc -vz -w 5 $VPS_IP4 80
  nc -vz -w 5 $VPS_IP4 443
  ```

  **Attendu :** trois `succeeded` (443 peut refuser tant que Traefik ne tourne
  pas — c'est un `connection refused` *depuis la machine*, pas un timeout).
  **La distinction qui tranche :** `connection refused` = le paquet est arrivé et
  personne n'écoute → le pare-feu laisse passer. **`timeout` = le paquet n'est
  jamais arrivé** → c'est le pare-feu réseau OVH, pas votre configuration.

  **Note annexe :** OVH bloque parfois le port **25 sortant** sur les VPS. Sans
  effet ici — Resend s'appelle en HTTPS depuis Convex — mais à savoir si vous
  branchez un jour un envoi SMTP direct.

- [ ] **2.6 — L'anti-DDoS, à connaître avant de le confondre avec une panne.**

  La protection anti-DDoS d'OVH est **toujours active** sur les IP OVH. En
  situation d'aspiration de trafic (« mitigation »), des requêtes légitimes
  peuvent être ralenties ou coupées quelques minutes.

  **Ce que ça veut dire pour vous :** si le site devient injoignable **depuis
  l'extérieur** alors que `docker compose ps` est vert et que les journaux
  Traefik sont muets — c'est-à-dire qu'aucune requête n'arrive —, regardez
  l'état de mitigation dans le panel avant de chercher une panne applicative.

- [ ] **2.7 — L'IPv6 : à traiter ou à ne pas publier, jamais entre les deux.**

  OVH attribue une IPv6 à chaque VPS. **Un `AAAA` mal posé casse le challenge
  Let's Encrypt de façon particulièrement traître :** quand un nom porte à la
  fois un `A` et un `AAAA`, Let's Encrypt **essaie l'IPv6 en premier**. Si
  l'IPv6 n'est pas configurée sur la machine, ou si Docker n'y écoute pas, la
  validation échoue — **et cet échec compte dans le quota** — alors que votre
  navigateur, lui, retombe sur l'IPv4 et vous montre un site qui marche.

  ```bash
  $SSH 'ip -6 addr show scope global; ip -6 route show default'
  $SSH 'curl -6 -s -m 10 https://ifconfig.co || echo "PAS DE SORTIE IPv6"'
  ```

  **Attendu si vous voulez publier un `AAAA` :** une adresse globale, une route
  par défaut, et une sortie IPv6 fonctionnelle.
  **Si la sortie IPv6 échoue** — cas fréquent sur certaines générations d'images
  OVH, où la passerelle IPv6 est **hors du préfixe** annoncé et exige une route
  explicite : **ne publiez aucun `AAAA`.** Un site en IPv4 seule fonctionne
  parfaitement ; un `AAAA` qui ne répond pas casse vos certificats. Traitez la
  configuration IPv6 comme un chantier séparé, après la mise en ligne. La forme
  exacte de la configuration dépend de l'image OVH (Q4).

- [ ] **2.8 — Le reverse DNS.**

  Panel → section **IP** → l'IP du VPS → *Modifier le reverse DNS*. Posez
  `$WEB_DOMAIN` (ou un nom dédié type `vps.$WEB_DOMAIN`).

  **OVH refuse un reverse dont le nom ne résout pas vers cette IP** : faites-le
  donc **après** la phase 3, pas avant.

  ```bash
  dig +short -x $VPS_IP4
  ```

  **Attendu :** le nom posé, avec un point final.
  **Si c'est vide ou si c'est encore `vpsXXXXX.ovh.net` :** sans conséquence pour
  le site web. Ça n'en a que pour la délivrabilité d'emails envoyés **depuis
  cette machine** — ce n'est pas le cas ici, Resend envoie depuis ses propres IP.
  Ne bloquez pas le déploiement là-dessus.

- [ ] **2.9 — Le mode rescue : le connaître AVANT d'en avoir besoin.**

  **C'est le seul recours si vous vous verrouillez dehors** — une règle de
  pare-feu qui coupe le port 22, un `sshd` cassé, un disque plein.

  Panel → le VPS → *…* → **Redémarrer en mode rescue**. Le VPS redémarre sur un
  système de secours ; OVH envoie des identifiants root temporaires à l'adresse
  du compte. Vous montez alors le disque du système normal pour le réparer :

  ```bash
  # DANS le rescue, une fois connecté en root :
  lsblk                      # identifier le disque du système normal
  mkdir -p /mnt/vps && mount /dev/<partition> /mnt/vps
  # réparer : /mnt/vps/etc/ssh/sshd_config, /mnt/vps/home/deploy/.ssh/authorized_keys, …
  umount /mnt/vps
  ```

  Puis, dans le panel, repasser en démarrage **disque dur** et redémarrer.

  Le nom exact de la partition varie selon l'image et la génération de VPS —
  d'où le `lsblk` plutôt qu'un chemin recopié (Q2).

  **Deux filets moins lourds, à connaître aussi :**
  - **La console web (KVM/noVNC)** du panel donne un clavier sur la machine sans
    passer par SSH. Elle suffit à réparer une règle de pare-feu locale.
  - **Un snapshot** avant une opération risquée. Vérifiez dans le panel si votre
    gamme de VPS en inclut un et s'il exige l'arrêt de la machine (Q3).

- [ ] **2.10 — Prenez un snapshot maintenant, si vous en avez un.**

  L'état « machine neuve, Docker installé, rien de déployé » est celui vers
  lequel vous voudrez revenir si la phase 5 tourne mal. C'est l'un des deux
  moments du plan où un snapshot vaut la peine (l'autre est avant la phase 10).

---

## Phase 3 — Le DNS d'abord, sans exception

`docker/README.md` §3 explique pourquoi, et c'est mécanique : le résolveur ACME
est en `httpChallenge`. Let's Encrypt vient chercher un jeton sur
`http://<domaine>/.well-known/acme-challenge/…`. Si le DNS ne mène pas encore au
VPS, la validation échoue — **et les échecs sont comptabilisés**.

> **Le quota Let's Encrypt : cinq certificats par domaine et par semaine,
> échecs compris.** Il ne se remet pas à zéro, ne s'achète pas, et ne s'accélère
> pas. Une pile démarrée trop tôt en `restart: unless-stopped` réessaie en
> boucle et l'épuise **en quelques minutes**. C'est la raison pour laquelle la
> phase 5 se fait **obligatoirement sur le CA de staging**.

- [ ] **3.1 — Établir où vit réellement la zone. Le cas fréquent n'est pas OVH.**

  Un domaine **acheté** chez OVH n'a pas forcément sa zone **servie** par OVH, et
  réciproquement. Ce qui décide, ce sont les serveurs de noms publiés :

  ```bash
  dig +short NS $WEB_DOMAIN
  ```

  | Réponse | Où éditer la zone |
  |---|---|
  | `dns*.ovh.net` / `ns*.ovh.net` | Panel OVHcloud → **Web Cloud** → Noms de domaine → *Zone DNS* |
  | `*.cloudflare.com` | **Cloudflare**, et lisez 3.4 avant tout |
  | autre chose (Gandi, OVH d'un autre compte, Google…) | chez ce fournisseur-là |

  **Si vous éditez la zone OVH alors que les NS pointent ailleurs, vos
  modifications n'auront strictement aucun effet** — et vous chercherez pendant
  une heure pourquoi `dig` ne bouge pas. C'est le piège de configuration le plus
  fréquent, et il ne produit aucune erreur.

- [ ] **3.2 — Abaisser le TTL AVANT de poser les enregistrements.**

  Un TTL bas rend chaque correction visible en minutes au lieu d'heures, et il
  compte doublement ici : la phase 8.2 change de domaine, et la fenêtre de
  reconnaissance des anciens hôtes est bornée à 72 h.

  Posez **300 s** (5 minutes) sur les enregistrements que vous allez créer. La
  valeur minimale acceptée varie selon le fournisseur (Q7).

  **Attendu :** l'interface accepte 300. **Si elle impose un minimum plus haut
  (souvent 3600) :** comptez ce délai à chaque correction de cette phase, et
  posez les enregistrements avec d'autant plus de soin.

- [ ] **3.3 — Poser les enregistrements.**

  | Nom | Type | Valeur | Poser ? |
  |---|---|---|---|
  | `@` (ou `$WEB_DOMAIN`) | `A` | `$VPS_IP4` | oui |
  | `admin` | `A` | `$VPS_IP4` | oui |
  | `stats` | `A` | `$VPS_IP4` | seulement si vous déployez Umami |
  | les mêmes | `AAAA` | `$VPS_IP6` | **seulement si 2.7 est vert** |

  **`UMAMI_DOMAIN` posé sans enregistrement DNS est une erreur coûteuse :**
  Traefik demanderait un certificat pour un nom qui ne résout nulle part, et
  **chaque échec compte dans le quota**. Si vous ne déployez pas Umami, laissez
  `UMAMI_DOMAIN` **vide** partout — le service `routeur` n'écrit alors aucun
  routeur pour lui, ce qui est exactement le comportement voulu.

- [ ] **3.4 — Le piège du proxy, Cloudflare en tête.**

  ```bash
  dig +short A $WEB_DOMAIN
  dig +short A $ADMIN_DOMAIN
  [ -n "$UMAMI_DOMAIN" ] && dig +short A $UMAMI_DOMAIN
  ```

  **Attendu :** exactement `$VPS_IP4`, pour chaque nom, et rien d'autre.

  **Si `dig` rend une IP qui n'est pas celle du VPS, NE DÉMARREZ PAS.** Le cas le
  plus fréquent n'est pas la faute de frappe : c'est un **proxy devant le VPS**.
  En mode proxy (nuage orange Cloudflare), `dig` rend une adresse du proxy, le
  challenge HTTP-01 n'atteint jamais Traefik, Let's Encrypt reçoit un 404 servi
  par le proxy, et **le certificat n'est jamais émis**.

  Remède : **désactiver le proxy** (nuage gris, « DNS only ») le temps de
  l'émission — et en pratique le laisser gris, sinon c'est à refaire à chaque
  renouvellement.

  **Deux conséquences propres à ce dépôt, à connaître :**
  - Si vous gardez le proxy avec SSL « Flexible », le navigateur voit un cadenas
    alors que le lien proxy → VPS reste **en clair**. Réglez sur « Full (strict) ».
  - **Le passage au challenge DNS-01 est une impasse ici** — voir « Limites
    connues », limite 2. L'écran `/settings/domaine` reste bloqué sur une
    configuration pourtant correcte.

- [ ] **3.5 — La vérification qui teste le chemin réel, pas la zone.**

  ```bash
  for h in $WEB_DOMAIN $ADMIN_DOMAIN; do
    echo "== $h"
    dig +short A    $h
    dig +short AAAA $h
    getent hosts $h
  done
  ```

  **Attendu :** un `A` valant `$VPS_IP4` ; un `AAAA` **seulement si** 2.7 est
  vert.
  **Si un `AAAA` apparaît sans que 2.7 soit vert :** supprimez-le. C'est la
  cause d'échec ACME la plus difficile à voir, parce que le site marche dans
  votre navigateur pendant que Let's Encrypt échoue.
  **Si `dig` rend un `CNAME` avant le `A` :** acceptable, la chaîne résout. Mais
  notez-le : l'écran `/settings/domaine` filtre les `CNAME` et ne juge que le `A`
  final.

---

## Phase 4 — L'amorçage

`pnpm bootstrap` est le seul endroit qui connaît toute la configuration à la
fois, parce que les trois destinations (Convex, GitHub, le VPS) ne peuvent pas
se lire entre elles. **Ce qui suit décrit ce que `scripts/bootstrap.mjs` fait
réellement aujourd'hui**, relu dans le fichier et non recopié d'une
documentation.

**Ce qu'il génère lui-même — dix secrets, aucun à inventer :**
`BETTER_AUTH_SECRET`, `PREVIEW_SECRET`, `REVALIDATE_SECRET`,
`LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET`, **`ROUTING_SECRET`**,
**`SECRETS_KEY`**, `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET`,
`UMAMI_TWO_FACTOR_ENCRYPTION_KEY`. Chacun est produit une fois, **réécrit dans
`.env.deploy`**, et retrouvé tel quel à l'exécution suivante. Il n'affiche jamais
une valeur — seulement son état, sa longueur et une empreinte SHA-256 courte.

**Ce qu'il distribue :**

| Destination | Contenu |
|---|---|
| **Déploiement Convex** (`convex env set`) | `BETTER_AUTH_SECRET`, `SITE_URL`, `PREVIEW_SECRET`, `REVALIDATE_SECRET`, `WEB_SITE_URL`, `LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET`, `SECRETS_KEY`, `RESEND_API_KEY`, `RESEND_TEST_MODE`, **`ROUTING_SECRET`, `WEB_DOMAIN`, `ADMIN_DOMAIN`, `UMAMI_DOMAIN`** |
| **Secrets GitHub** (`gh secret set`) | `CONVEX_DEPLOY_KEY`, `PUBLIC_CONVEX_URL`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_WEB_SITE_URL`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (lue du fichier), `VPS_SSH_KNOWN_HOSTS` (par `ssh-keyscan -H`) |
| **`.env.vps`** (à copier à la main) | tout ce que le compose exige, `ROUTING_SECRET` compris, avec `ACME_CA_SERVER` **laissée commentée** |
| **`apps/web/.env.local`, `apps/admin/.env.local`** | le développement local |

**Ce qu'il ne pose PAS, et c'est délibéré :** `PUBLIC_UMAMI_URL`,
`PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_UMAMI_RECORDER`, `PUBLIC_META_PIXEL_ID`,
`PUBLIC_GOOGLE_TAG_ID`. Aucune de ces valeurs n'existe avant qu'un humain ait
ouvert Umami ou la console d'un annonceur. Leur absence coûte de la mesure,
jamais un build.

**Ce que le workflow `Deploy` ne fait pas non plus, et qu'il faut avoir en tête
toute la phase 5 : `deploy.yml` ne pose AUCUNE variable sur le déploiement
Convex.** `CONVEX_DEPLOY_KEY` autorise `convex deploy` à remplacer schéma et
functions ; elle ne pose pas d'environnement. **`pnpm bootstrap` est le seul
outil qui pose `ROUTING_SECRET`, `WEB_DOMAIN`, `ADMIN_DOMAIN` et `UMAMI_DOMAIN`
côté Convex.**

- [ ] **4.1 — Remplir `.env.deploy`, le seul fichier saisi à la main.**

  ```bash
  cd /chemin/vers/AstroTan
  pnpm bootstrap --dry-run     # crée .env.deploy depuis l'exemple, n'écrit rien d'autre
  $EDITOR .env.deploy
  ```

  Reportez-y les valeurs du bloc de paramètres. Points de vigilance, chacun
  vérifié par le script :

  - `WEB_DOMAIN` / `ADMIN_DOMAIN` / `UMAMI_DOMAIN` : **hôte nu**, sans `https://`
    ni slash final. Ils partent dans une règle Traefik ``Host(`…`)``.
  - `GHCR_OWNER` : **en minuscules**.
  - `GITHUB_REPOSITORY` : `owner/nom`. Le script ne le devine jamais — un clone
    frais de ce template n'a souvent aucun remote git.
  - `VPS_USER` : **jamais `root`**, le script le refuse.
  - `VPS_SSH_KEY_PATH` : la clé **privée** (`~/.ssh/astrotan_deploy`), sans `.pub`
    et sans passphrase.
  - `RESEND_TEST_MODE` : laissez `true` **pour l'instant**. La phase 8.3 le
    passera à `false`, délibérément et en le voyant.

- [ ] **4.2 — La répétition à blanc.**

  ```bash
  pnpm bootstrap --dry-run
  ```

  **Attendu :** chaque étape s'annonce, et le script **liste ce qu'il ferait**
  sans rien écrire — il n'appelle ni `gh` ni `convex`. Lisez toute la sortie.
  **Si une étape se déclare « sautée » :** elle nomme son prérequis manquant
  (`gh` absent ou non authentifié, `node_modules` non installé). Réparez avant
  la vraie exécution — une étape sautée en silence est exactement ce que ce
  script existe pour éviter.

- [ ] **4.3 — La vraie exécution.**

  ```bash
  pnpm bootstrap
  ```

  **Attendu :** les variables Convex posées, les secrets GitHub posés, `.env.vps`
  écrit en `0600`, et **deux étapes qui se déclarent sautées** :
  `seed:demoContent` et `bootstrap:createInvitation` — « pas encore sur le
  déploiement ». **C'est normal et c'est prévu** : ces functions n'existent qu'après
  le premier `convex deploy`, qui est la première étape du workflow `Deploy`.
  Le script sera relancé en 5.7.

  **Si le script pose une question sur l'adresse du premier compte :** il ne la
  pose que si `stdin` est un TTY. Sinon il garde le défaut (`ADMIN_EMAIL`, puis
  `ACME_EMAIL`) **et dit lequel il a pris**.

- [ ] **4.4 — Vérifier les deux moitiés du secret de routage.**

  C'est la vérification la plus importante de cette phase, parce que son échec
  est **silencieux** : le site sert, mais changer de domaine depuis
  l'administration n'a plus aucun effet.

  ```bash
  cd packages/backend && npx convex env list | grep -E 'ROUTING_SECRET|WEB_DOMAIN|ADMIN_DOMAIN|UMAMI_DOMAIN'
  grep -E '^(ROUTING_SECRET|WEB_DOMAIN|ADMIN_DOMAIN|UMAMI_DOMAIN)=' ../../.env.vps | sed 's/=.*/=<posé>/'
  ```

  **Attendu :** les quatre côté Convex (trois si vous n'avez pas d'Umami), et les
  quatre lignes présentes dans `.env.vps`.
  **Si `ROUTING_SECRET` manque côté Convex :** la query `routing.hotes` refusera
  chaque appel. Sur un déploiement neuf, c'est exactement le scénario du blackout
  — que la phase 5 va **provoquer volontairement** pour vérifier que le repli
  fonctionne. Ne le corrigez pas encore.

- [ ] **4.5 — Copier le `.env` sur le VPS.**

  ```bash
  $SSH 'mkdir -p ~/astrotan'
  scp .env.vps $VPS_USER@$VPS_HOST:~/astrotan/.env
  $SSH 'chmod 600 ~/astrotan/.env'
  ```

  **Ce fichier est le seul que le déploiement n'écrase jamais** (`rsync --exclude
  '.env'`, avec `--delete` pour tout le reste). C'est ce qui en fait le point de
  vérité de la machine — et c'est pourquoi `pnpm bootstrap` ne s'y connecte pas
  pour l'écrire à votre place.

- [ ] **4.6 — Demander au compose lui-même s'il ne manque rien.**

  ```bash
  node scripts/check-env-wiring.mjs --compose-required
  ```

  **Attendu :** la liste des variables que `docker-compose.yml` exige par la
  syntaxe `${VAR:?message}`. Comparez-la à `.env.vps`. **La liste n'est écrite
  nulle part en prose parce qu'elle a divergé du compose deux fois** : c'est le
  compose qui fait foi.

- [ ] **4.7 — Le smoke-test local des images, la seule chose qui les exerce
      avant le déploiement.**

  Rappel du point qui justifie cette étape : **la CI ne construit jamais l'image
  du site.** Elle ne construit que celle de l'admin, parce que le build d'Astro
  exige un déploiement Convex joignable *pendant* le build — impossible à donner
  à une PR venue d'un fork. Le premier build réel de `web.Dockerfile` est donc
  celui du workflow `Deploy`, sur `main`. Ce smoke-test est ce qui vous évite de
  le découvrir là.

  ```bash
  set -a; . ./.env.vps; set +a
  export GHCR_OWNER IMAGE_TAG=local
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml \
    up --build -d web admin
  curl -s -o /dev/null -w 'web=%{http_code}\n'   http://127.0.0.1:4321/api/health
  curl -s -o /dev/null -w 'admin=%{http_code}\n' http://127.0.0.1:3001/api/health
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.local.yml down
  ```

  **Attendu :** `web=200` et `admin=200`.
  **Si un conteneur meurt sur `Cannot find module` :** c'est le bug pnpm de
  `docker/README.md` §11 — l'image s'est construite sans erreur, et l'arbre
  d'exécution contient des liens pendants. Revenez à `pnpm@10.34.5`.
  **Si le build de `web` échoue en interrogeant Convex :** `convex deploy` n'a
  pas encore tourné sur ce déploiement. C'est attendu à ce stade ; ce smoke-test
  sera plus concluant après le premier déploiement.

---

## Phase 5 — Le premier déploiement, et la provocation volontaire du blackout

**C'est la phase la plus délicate du plan.** Elle fait trois choses dans un
ordre qui n'est pas négociable :

1. elle démarre sur le **CA de staging**, pour que rien de ce qui suit ne touche
   au quota de production ;
2. elle **provoque délibérément** le scénario du blackout — `routing.hotes` qui
   refuse alors qu'aucun fichier de routes n'existe — pour vérifier que le repli
   tient le site debout. Ce cas a été fermé dans le code **sans jamais pouvoir
   être testé** ;
3. elle rétablit ensuite le régime normal et vérifie qu'il prend le dessus.

- [ ] **5.1 — Basculer sur le CA de staging. Non négociable.**

  ```bash
  $SSH "sed -i 's|^# *ACME_CA_SERVER=|ACME_CA_SERVER=|' ~/astrotan/.env"
  $SSH "grep ACME_CA_SERVER ~/astrotan/.env"
  ```

  **Attendu :** `ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory`,
  **décommentée**.
  **Si la ligne est absente** (`.env` venu d'une version antérieure) :
  ```bash
  $SSH "printf 'ACME_CA_SERVER=%s\n' 'https://acme-staging-v02.api.letsencrypt.org/directory' >> ~/astrotan/.env"
  ```
  **Ce que ça coûte de sauter cette étape :** un premier essai raté sur le CA de
  production — DNS pas propagé, proxy actif, port 80 filtré en amont, domaine mal
  orthographié — vous coûte potentiellement **une semaine d'attente** sur ce
  domaine. Le CA de staging emprunte exactement le même chemin de code.

- [ ] **5.2 — Retirer volontairement la moitié Convex du secret de routage.**

  **C'est la provocation.** On se met dans l'état exact d'un adoptant qui a
  amorcé son déploiement avec une version antérieure du script : `ROUTING_SECRET`
  présent dans le `.env` du VPS (le compose l'exige en `${…:?}`), **absent du
  déploiement Convex**. Et le volume `dynamique` est vide, puisque rien n'a
  jamais été déployé.

  ```bash
  cd packages/backend
  npx convex env get ROUTING_SECRET > /tmp/routing_secret.txt   # on la remettra en 5.6
  npx convex env remove ROUTING_SECRET
  npx convex env list | grep -c ROUTING_SECRET                  # attendu : 0
  ```

  **Attendu :** `0`.
  **Pourquoi c'est sûr :** le repli est précisément là pour ce cas, et il est
  borné par construction — il n'écrit **qu'une fois** (le fichier existe après,
  donc la branche ne se reprend plus), ce qui protège le quota Let's Encrypt.
  Vous êtes de plus sur le CA de staging.

- [ ] **5.3 — Déclencher le premier déploiement.**

  ```bash
  git push origin lot1-socle:main
  # ou, si main existe déjà : Actions → Deploy → Run workflow
  ```

  Suivez l'exécution. L'ordre du pipeline, et la raison de chaque étape :

  1. `convex deploy` — **avant** le build des images ;
  2. build et push des **trois** images (`web`, `admin`, `routeur`), taguées
     `:{sha}` **et** `:latest` ;
  3. `rsync` de `docker/` vers `~/astrotan/` (hors `.env`, avec `--delete`) ;
  4. `docker compose pull && docker compose up -d --wait --wait-timeout 180`
     avec `IMAGE_TAG=<sha>`.

  **Attendu du premier essai : un échec au `pull`, avec `denied`.** C'est le
  point 1.6 — les packages GHCR viennent d'apparaître et sont privés. Basculez-les
  en public (les **trois**) ou faites le `docker login` sur le VPS, puis
  relancez le workflow.

  **Si l'échec est ailleurs :**
  - `ACME_EMAIL is required` / `ROUTING_SECRET is required` / autre `${VAR:?}` →
    la variable manque dans `~/astrotan/.env`. Panne **franche**, pendant le
    déploiement : c'est la bonne façon d'échouer. Ajoutez la ligne et relancez.
  - `container astrotan-web-1 is unhealthy` → le conteneur démarre puis meurt.
    `$SSH "$DC logs --tail=100 web"`. `Cannot find module` = le bug pnpm (§11).
  - le job **pend** puis échoue à 180 s → un conteneur en boucle de crash ;
    `restart: unless-stopped` le fait repartir dans son `start_period` sans jamais
    se stabiliser en `unhealthy`. C'est ce que `--wait-timeout` plafonne.

- [ ] **5.4 — LA VÉRIFICATION DU BLACKOUT. Le site tient-il debout ?**

  Attendez **90 secondes** après la fin du job, puis :

  ```bash
  $SSH "$DC logs --tail=50 routeur"
  ```

  **Attendu — la ligne exacte à trouver :**

  ```
  AUCUN routage n'était en place : routage de SECOURS écrit depuis l'environnement du …
  ```

  précédée de `lecture des hôtes impossible — …`. **C'est le résultat qu'on
  cherche.** Il dit que la query a bien refusé, que le service l'a vu, et qu'il a
  composé le routage depuis `WEB_DOMAIN` / `ADMIN_DOMAIN` / `UMAMI_DOMAIN` du
  `.env` du conteneur.

  Puis, la preuve qui compte — **depuis l'extérieur** :

  ```bash
  curl -skI  https://$WEB_DOMAIN   | head -1     # attendu : HTTP/2 200
  curl -skI  https://$ADMIN_DOMAIN | head -1     # attendu : HTTP/2 200 (ou 302 vers /login)
  curl -sI   http://$WEB_DOMAIN    | head -1     # attendu : 301 vers https
  ```

  `-k` parce que le certificat est de staging : votre navigateur **affichera une
  erreur de certificat, et c'est le résultat attendu**.

  **Ce que ça veut dire si ça échoue :**

  | Symptôme | Ce que ça signifie |
  |---|---|
  | `404 page not found` sur les deux domaines, et le journal `routeur` ne dit **rien** | Le service n'a pas encore écrit. **Deux lectures concordantes sont exigées avant la première écriture** (l'anti-battement qui protège le quota), à 30 s d'intervalle : attendez 60 s de plus. Au-delà, c'est une vraie panne. |
  | `404` persistant **et** journal `routage de secours impossible à écrire — EACCES` | Le volume `astrotan_dynamique` a été créé à `root`. Remède : `$SSH "$DC down && docker volume rm astrotan_dynamique && $DC up -d"` |
  | `404` persistant et journal `AUCUN routage en place et aucun hôte dans l'environnement du conteneur` | `WEB_DOMAIN` manque dans `~/astrotan/.env`. C'est la seule variable sans laquelle il n'y a littéralement rien à router. |
  | `curl` en **timeout** et non en 404 | Le paquet n'arrive pas. Retournez en 2.5 : c'est le pare-feu réseau OVH, pas l'application. |
  | 200 sur `$WEB_DOMAIN` mais 404 sur `$ADMIN_DOMAIN` | `ADMIN_DOMAIN` est vide dans le `.env` du VPS. Le repli lui donne `admin.<WEB_DOMAIN>` par défaut ; si votre dashboard est ailleurs, la ligne est nécessaire. |

  **Si le site tient debout : la propriété 1 est prouvée.** Notez-le — c'est le
  scénario que le code fermait sans preuve.

- [ ] **5.5 — Vérifier que les certificats de staging sont bien émis.**

  ```bash
  echo | openssl s_client -connect $WEB_DOMAIN:443 -servername $WEB_DOMAIN 2>/dev/null \
    | openssl x509 -noout -issuer -dates
  echo | openssl s_client -connect $ADMIN_DOMAIN:443 -servername $ADMIN_DOMAIN 2>/dev/null \
    | openssl x509 -noout -issuer -dates
  ```

  **Attendu :** `issuer=… O=(STAGING) Let's Encrypt …` pour **les deux**, avec des
  dates de validité.
  **Si un seul des deux a un certificat :** ne passez pas à la production. Le
  `admin.` compte au quota autant que le site. Corrigez le DNS d'abord.
  **Si aucun n'en a :**
  ```bash
  $SSH "$DC logs traefik | grep -i acme | tail -40"
  ```
  Cherchez `unable to obtain ACME certificate`, `404` sur
  `/.well-known/acme-challenge/`, ou `timeout`. Un 404 servi par un tiers = un
  proxy devant le VPS (3.4). Un timeout = le port 80 est filtré en amont (2.5).

- [ ] **5.6 — Rétablir le régime normal et vérifier qu'il prend le dessus.**

  ```bash
  cd packages/backend
  npx convex env set ROUTING_SECRET "$(cat /tmp/routing_secret.txt)"
  rm /tmp/routing_secret.txt
  npx convex env list | grep -E 'ROUTING_SECRET|WEB_DOMAIN|ADMIN_DOMAIN'
  ```

  Attendez **60 secondes** (deux passes du service, qui tourne toutes les 30 s),
  puis :

  ```bash
  $SSH "$DC logs --tail=30 routeur"
  ```

  **Attendu :** une ligne `routage écrit : …` **sans** le mot `SECOURS`, listant
  vos hôtes.

  **Si le journal continue à dire `lecture des hôtes impossible` :** les deux
  moitiés du secret divergent. Le `.env` du VPS et le déploiement Convex doivent
  porter la **même** valeur, octet pour octet. Comparez leurs empreintes :
  ```bash
  $SSH "grep '^ROUTING_SECRET=' ~/astrotan/.env | cut -d= -f2-" | tr -d '\n' | shasum -a 256 | cut -c1-8
  (cd packages/backend && npx convex env get ROUTING_SECRET) | tr -d '\n' | shasum -a 256 | cut -c1-8
  ```
  Les huit caractères doivent être identiques.

  **Si le journal dit `routage écrit` mais que rien ne change pour vous :** c'est
  normal — les hôtes sont les mêmes qu'en repli. Ce qui a changé, c'est **d'où
  ils viennent**, et c'est ce qui rend la phase 8.2 possible.

- [ ] **5.7 — Relancer `pnpm bootstrap`, une dernière fois.**

  Les deux étapes sautées en 4.3 avaient simplement besoin que les functions
  existent. **Sans elles, un déploiement dont le pipeline est vert et dont les
  conteneurs sont `healthy` est inutilisable :**

  ```bash
  cd /chemin/vers/AstroTan && pnpm bootstrap
  ```

  **Attendu :**
  - `seed:demoContent` — crée les lignes `pages`. **Malgré son nom, ce n'est pas
    de la décoration : c'est le seul code du dépôt qui crée ces lignes, et sans
    elles TOUTE URL répond 404, `/` compris.** Une page est une paire : son
    fichier `.astro` **et** sa ligne. Idempotent par slug.
  - `bootstrap:createInvitation` — émet l'invitation du premier compte, en
    `role: "owner"`, et **affiche le lien**. Copiez-le : c'est la seule sortie du
    script qui contient une valeur, et elle n'a d'intérêt que lue par un humain.

  **Si `createInvitation` se déclare sautée en disant qu'un owner existe déjà :**
  bien. Le script lit `bootstrap:owners` avant d'émettre, plutôt que de frapper
  un lien qui serait refusé à l'acceptation.
  **`owner` et jamais `admin` :** `invitations.create` refuse `role: "owner"`
  pour tout acteur, et un admin ne peut ni inviter, ni promouvoir, ni rétrograder
  un autre admin. Un déploiement dont le premier compte est un `admin` n'a jamais
  d'owner et reste plafonné à un seul administrateur, **sans issue par
  l'interface**.

- [ ] **5.8 — Le site répond vraiment.**

  ```bash
  curl -sk https://$WEB_DOMAIN | head -20
  curl -sk -o /dev/null -w '%{http_code}\n' https://$WEB_DOMAIN/contact
  $SSH "$DC ps"
  ```

  **Attendu :** du HTML, un `200`, et `web`, `admin`, `traefik`, `routeur`
  (+ `umami*`) en `running` / `healthy`.
  **Si `/` répond 404 :** `seed:demoContent` n'a pas tourné, ou la ligne `pages`
  du slug est en `draft`. Reprenez 5.7.
  **`healthy` n'atteste que d'une chose :** que le processus écoute et route.
  `/api/health` n'a **aucune dépendance**, ni Convex ni session — délibérément :
  une panne du backend ne doit pas faire redémarrer en boucle un site qui sert
  encore ses pages.

- [ ] **5.9 — Noter le sha.**

  ```bash
  $SSH 'cat ~/astrotan/DEPLOYED_SHA'
  export SHA_N=<le sha rendu>
  ```

  Il est écrit à deux endroits exprès : ici, et dans le résumé du job GitHub.
  C'est la cible du rollback de la phase 10.

---

## Phase 6 — Bascule vers le CA de production

Ne faites cette phase que quand la phase 5 est **entièrement verte**, les deux
domaines compris. C'est le point de non-retour vis-à-vis du quota.

- [ ] **6.1 — Recommenter `ACME_CA_SERVER`.**

  ```bash
  $SSH "sed -i 's|^ACME_CA_SERVER=|# ACME_CA_SERVER=|' ~/astrotan/.env"
  $SSH "grep ACME_CA_SERVER ~/astrotan/.env"     # attendu : la ligne, COMMENTÉE
  ```

  La variable a un défaut (le CA de production) : son absence ne bloque rien.

- [ ] **6.2 — Supprimer le volume ACME. C'est l'étape qu'on oublie.**

  ```bash
  $SSH "$DC down && docker volume rm astrotan_acme"
  ```

  **Pourquoi :** les certificats de staging y sont stockés et **Traefik ne les
  remplacera pas tout seul** — il les considère valides. Sans cette suppression,
  vous resteriez indéfiniment sur des certificats que personne ne reconnaît.

  `astrotan_acme` est bien le nom réel : le projet compose est nommé `astrotan`
  (clé `name:`) et le volume `acme`. Vérifiable par
  `$SSH 'docker volume ls | grep acme'`.

  **Ne supprimez PAS `astrotan_dynamique` à cette occasion** : il porte votre
  routage, et le repli le réécrirait depuis le `.env` — donc en défaisant un
  changement de domaine réussi.

- [ ] **6.3 — Redémarrer et vérifier l'émetteur.**

  ```bash
  $SSH "cd ~/astrotan && IMAGE_TAG=$SHA_N GHCR_OWNER=$GHCR_OWNER docker compose up -d --wait --wait-timeout 180"
  sleep 60
  echo | openssl s_client -connect $WEB_DOMAIN:443 -servername $WEB_DOMAIN 2>/dev/null \
    | openssl x509 -noout -issuer -dates
  echo | openssl s_client -connect $ADMIN_DOMAIN:443 -servername $ADMIN_DOMAIN 2>/dev/null \
    | openssl x509 -noout -issuer -dates
  ```

  **Attendu :** un `issuer` qui **ne contient plus `(STAGING)`** — typiquement
  `O=Let's Encrypt`. Et, sans `-k` cette fois :

  ```bash
  curl -sI https://$WEB_DOMAIN   | head -1      # 200, sans avertissement TLS
  curl -sI https://$ADMIN_DOMAIN | head -1
  ```

  **Si l'émetteur contient encore `(STAGING)` :** le volume n'a pas été supprimé,
  ou `ACME_CA_SERVER` est toujours décommentée. Reprenez 6.1 et 6.2 — **c'est le
  contrôle qui dit si vous avez réellement basculé.** Un « ça marche dans mon
  navigateur » ne le dit pas : il peut afficher un cadenas pour d'autres raisons.
  **Si aucun certificat n'est émis :** vous venez de consommer une tentative sur
  le quota de production. Regardez `$SSH "$DC logs traefik | grep -i acme"`
  **avant** de retenter, et comptez vos essais : il en reste quatre cette semaine.

- [ ] **6.4 — Ne supprimez plus jamais `astrotan_acme` « pour repartir propre ».**

  C'est sa persistance qui protège le quota : sans elle, un conteneur qui
  redémarre en boucle redemande un certificat à chaque tour et brûle les
  5 certificats / 7 jours en quelques minutes.

---

## Phase 7 — La preuve qui manque : le rechargement à chaud de Traefik

**C'est la propriété qui justifie toute l'architecture du changement de domaine.**
Le registre d'exécution la consigne explicitement : *« NON PROUVÉ, et ça ne peut
pas l'être ici : il faut une vraie pile Traefik — donc le VPS. »* Sans elle,
changer de domaine depuis le dashboard n'aurait aucun effet jusqu'au prochain
déploiement.

**Le principe.** Traefik est configuré par variables d'environnement — jamais par
un fichier statique ni par un `command:`, parce que ses trois loaders (File →
Flag → Env) **ne fusionnent pas** et que le premier qui aboutit fait ignorer en
silence toutes les variables `TRAEFIK_*`. Deux d'entre elles portent cette
phase :

```
TRAEFIK_PROVIDERS_FILE_DIRECTORY: /dynamique
TRAEFIK_PROVIDERS_FILE_WATCH:     "true"
```

Le service `routeur` monte ce volume **en écriture** ; Traefik le monte en
**lecture seule**.

- [ ] **7.1 — Regarder ce que Traefik sert aujourd'hui.**

  ```bash
  $SSH "$DC exec routeur cat /dynamique/routes.yml"
  ```

  **Attendu :** un YAML engendré, en-tête `# Configuration dynamique de Traefik —
  ENGENDRÉE par le service \`routeur\`.`, avec un bloc par service :

  ```yaml
  http:
    routers:
      web:
        rule: "Host(`exemple.fr`)"
        entryPoints:
          - websecure
        service: web@docker
        tls:
          certResolver: letsencrypt
  ```

  **Si le fichier n'existe pas :** le service n'a jamais écrit. Reprenez 5.4.
  **Note :** seuls les **routeurs** sont dans ce fichier. Les **services** restent
  déclarés par les labels Docker
  (`traefik.http.services.web.loadbalancer.server.port`) — c'est pour ça que
  `traefik.enable: "true"` a été **conservé** sur les conteneurs.

- [ ] **7.2 — Passer les journaux de Traefik en DEBUG, le temps de la preuve.**

  En `INFO`, Traefik ne dit rien quand il recharge sa configuration dynamique :
  vous ne pourriez pas distinguer « il a rechargé » de « il n'a rien vu ».

  ```bash
  $SSH "printf 'TRAEFIK_LOG_LEVEL=DEBUG\n' >> ~/astrotan/.env"
  ```

  ⚠️ **Le compose fixe `TRAEFIK_LOG_LEVEL: INFO` en dur dans son
  `environment:`.** Vérifiez laquelle gagne :

  ```bash
  $SSH "cd ~/astrotan && IMAGE_TAG=$SHA_N GHCR_OWNER=$GHCR_OWNER docker compose up -d traefik"
  $SSH "$DC logs --tail=5 traefik | head -3"
  ```

  **Si les journaux restent en `INFO` :** la valeur du compose l'emporte, et la
  ligne ajoutée au `.env` ne sert à rien — **retirez-la** et utilisez la variante
  sans DEBUG décrite en 7.4. Ne modifiez pas `docker-compose.yml` sur le VPS : le
  `rsync --delete` du prochain déploiement écraserait votre modification, et vous
  auriez une divergence silencieuse entre la machine et le dépôt.

- [ ] **7.3 — Provoquer une écriture, et observer les deux côtés.**

  L'idée : forcer le service `routeur` à réécrire le fichier **sans changer de
  domaine** — donc sans toucher au quota Let's Encrypt. On corrompt le fichier
  existant ; la passe suivante le réécrit à l'identique.

  Ouvrez **deux terminaux**.

  Terminal A — suivre Traefik en direct :
  ```bash
  $SSH "$DC logs -f traefik"
  ```

  Terminal B — provoquer :
  ```bash
  # horodatage de référence
  date -u +%H:%M:%S
  # on tronque le fichier : la passe suivante verra un contenu différent de
  # celui qu'elle compose, et réécrira
  $SSH "$DC exec routeur sh -c 'echo \"http:\" > /dynamique/routes.yml'"
  $SSH "$DC logs -f --tail=0 routeur"     # attendre la ligne « routage écrit : … »
  ```

  **Attendu, dans cet ordre et en moins de 60 secondes :**
  1. Terminal B : `routage écrit : exemple.fr, admin.exemple.fr…` puis
     `Traefik relira le fichier de lui-même`.
  2. Terminal A, **dans la seconde qui suit** : une entrée de rechargement de la
     configuration — en DEBUG, une ligne du provider `file` mentionnant
     `Configuration received` / `provider=file` / le rechargement des routeurs.
  3. Aucun redémarrage du conteneur Traefik :
     ```bash
     $SSH "docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' astrotan-traefik-1"
     ```
     **La date de démarrage doit être ANTÉRIEURE à l'horodatage noté**, et
     `RestartCount` inchangé. C'est ce point-là qui fait la preuve : la
     configuration a changé **sans que le processus ne redémarre**.

  **Pendant la fenêtre où le fichier est tronqué** (jusqu'à 30 s), le site répond
  **404** : Traefik a bien relu, et un `http:` vide ne contient aucun routeur.
  **C'est en soi une demi-preuve** — il a vu le changement dans le mauvais sens.
  Vérifiez-la :
  ```bash
  curl -sI https://$WEB_DOMAIN | head -1     # 404 pendant la fenêtre, 200 après
  ```

- [ ] **7.4 — La variante sans DEBUG, si 7.2 a échoué.**

  Si vous ne pouvez pas passer les journaux en DEBUG, la preuve tient quand même
  — elle est comportementale plutôt que journalisée, et elle est en réalité plus
  forte :

  | Observation | Ce qu'elle établit |
  |---|---|
  | `curl` rend **404** dans les secondes qui suivent la troncature du fichier | Traefik a relu le fichier **modifié** — il ne peut pas perdre ses routeurs autrement |
  | `curl` rend **200** dans les secondes qui suivent la ligne `routage écrit` | Traefik a relu le fichier **réécrit** |
  | `RestartCount` et `StartedAt` du conteneur Traefik sont **inchangés** entre les deux | Le rechargement n'est pas un redémarrage |

  Les trois ensemble **prouvent le rechargement à chaud**.

- [ ] **7.5 — Le symptôme d'un échec, à reconnaître.**

  | Ce que vous voyez | Ce que ça veut dire |
  |---|---|
  | `routage écrit` dans le journal `routeur`, mais `curl` continue de servir **l'ancienne** configuration indéfiniment | **Le provider fichier ne surveille pas.** `TRAEFIK_PROVIDERS_FILE_WATCH` n'est pas prise, ou un `command:` / un `traefik.yml` monté a fait ignorer toutes les variables `TRAEFIK_*`. Vérifiez : `$SSH "docker inspect astrotan-traefik-1 \| grep -c TRAEFIK_PROVIDERS_FILE_WATCH"` doit rendre au moins 1, et le conteneur ne doit avoir **aucun** `command`. |
  | `curl` ne change qu'après un `docker compose restart traefik` | Même diagnostic. **C'est l'échec qui invalide toute l'architecture du changement de domaine** — signalez-le avant d'aller plus loin : la phase 8.2 ne peut pas fonctionner. |
  | Le fichier tronqué n'est jamais réécrit | Le service `routeur` est mort ou ne lit plus. `$SSH "$DC ps routeur"` et ses journaux. |

- [ ] **7.6 — Remettre les journaux en `INFO`.**

  ```bash
  $SSH "sed -i '/^TRAEFIK_LOG_LEVEL=/d' ~/astrotan/.env"
  $SSH "cd ~/astrotan && IMAGE_TAG=$SHA_N GHCR_OWNER=$GHCR_OWNER docker compose up -d traefik"
  ```

  Un Traefik en DEBUG écrit beaucoup, y compris des en-têtes de requêtes.

---

## Phase 8 — Les quatre parcours, de bout en bout, sur le vrai serveur

### 8.1 — Créer le premier compte administrateur et se connecter

- [ ] **8.1.1 — Ouvrir le lien d'invitation** affiché en 5.7 :
  `https://$ADMIN_DOMAIN/accept-invite?token=<jeton>`

  **Attendu :** la page d'acceptation, un champ de mot de passe, et un indicateur
  de robustesse. Choisissez un mot de passe **fort** et **conservez-le** : la
  phase 8.3 va le remplacer, et vous en aurez besoin pour comparer.

  **Si la page dit que le jeton est invalide ou expiré :** relancez
  `pnpm bootstrap` — il sautera si un owner existe déjà, et émettra sinon.
  **Si la page ne se charge pas du tout :** `curl -sI https://$ADMIN_DOMAIN` ;
  un 404 renvoie à la phase 5, un timeout à 2.5.
  **Si le POST est refusé en `403 INVALID_ORIGIN` :** l'origine du dashboard
  n'est pas de confiance côté Better Auth. Vérifiez que `SITE_URL` sur le
  déploiement Convex vaut bien `https://$ADMIN_DOMAIN` :
  `cd packages/backend && npx convex env get SITE_URL`.

- [ ] **8.1.2 — Se connecter** sur `https://$ADMIN_DOMAIN/login`.

  **Attendu :** le tableau de bord. Vérifiez `/compte` : votre rôle doit être
  **`owner`**.
  **Si le rôle est `admin` :** l'invitation n'a pas été émise par
  `bootstrap:createInvitation`. Un déploiement sans owner reste plafonné à un
  seul administrateur, **sans issue par l'interface** — le seul remède est
  `npx convex run bootstrap:createInvitation '{"email":"…","role":"admin"}'`
  depuis le CLI, qui exige déjà la clé de déploiement.

- [ ] **8.1.3 — Vérifier que la session survit à un rechargement** et que
  `/users` liste bien votre compte.

  **Si le dashboard s'affiche mais que l'authentification tombe :**
  `VITE_CONVEX_URL` et `VITE_CONVEX_SITE_URL` ont **deux sources de vérité** —
  les secrets GitHub (figés dans le bundle au build) et le `.env` du VPS (lus au
  runtime par `src/lib/auth-server.ts`) — et **rien ne détecte leur divergence**.
  Aucun healthcheck ne le voit, `/api/health` étant sans dépendance par
  construction. Comparez les deux, corrigez, **redéployez** (un simple
  redémarrage ne change pas le bundle).

- [ ] **8.1.4 — Supprimer le compte jetable.** Le registre d'exécution signale
  un compte `faille-jeton@exemple.test` (rôle `editor`) créé pendant la
  correction d'une faille. Il subsiste sur le déploiement **local** ; vérifiez
  dans `/users` qu'il n'est pas sur celui-ci, et supprimez-le si oui. Le dépôt
  n'a **aucun** chemin interne de suppression de compte : l'écran Utilisateurs
  est la seule voie.

### 8.2 — Changer le domaine depuis le dashboard, et vérifier que tout suit

**C'est le parcours qui exerce toute l'architecture de la phase 7.** Faites-le
avec un **troisième** domaine ou sous-domaine (`$NOUVEAU_DOMAIN`), dont vous
posez les enregistrements DNS **avant**.

> **Avant de commencer, sachez ce qui est ouvert et assumé** — les trois limites
> en fin de document. En particulier : **le lien de réinitialisation de mot de
> passe pointe vers le domaine courant**, donc il est mort pendant une bascule.
> Ne combinez pas 8.2 et 8.3.

- [ ] **8.2.1 — Poser le DNS du nouveau domaine**, TTL 300, `A` vers `$VPS_IP4`,
  pour le site **et** pour son `admin.`.

  ```bash
  export NOUVEAU_DOMAIN=nouveau.fr
  dig +short A $NOUVEAU_DOMAIN         # attendu : $VPS_IP4
  dig +short A admin.$NOUVEAU_DOMAIN   # attendu : $VPS_IP4
  ```

  **DEUX lignes A doivent être vertes, pas une.** Traefik demande un certificat
  pour le site **et** pour `admin.`, et les deux comptent au quota. L'écran verrouille
  son bouton sur les deux — c'est délibéré : n'en valider qu'une ne fermait que
  la moitié de la panne.

- [ ] **8.2.2 — Ouvrir `https://$ADMIN_DOMAIN/settings/domaine`** et saisir le
  nouveau domaine.

  **Attendu :** un tableau des enregistrements DNS attendus, avec un verdict par
  ligne, et le bouton d'enregistrement **inerte tant que les deux lignes A ne
  sont pas vertes**.

  Les cinq états d'un verdict, et ce qu'ils veulent dire :

  | État | Signification |
  |---|---|
  | `ok` | Le `A` correspond à l'adresse du serveur de référence (l'hôte courant) |
  | `forme` | Le `A` est une IPv4 publique plausible, **mais il n'y a aucun serveur de référence à quoi le comparer** — déploiement neuf, ou hôte courant non résolu |
  | `manquant` | Aucun `A` |
  | `different` | Un `A`, mais pas celui du serveur |
  | `indisponible` | Le résolveur n'a pas répondu |

  **Le cas `forme` mérite d'être connu :** le bouton reste armé, sinon tout
  déploiement neuf serait enfermé. C'est aussi la faiblesse de la limite 2 —
  derrière un proxy, l'IP publique du proxy passe le contrôle de forme.

  **Réserve connue, à ne pas confondre avec un bug :** cliquer « Vérifier »
  **déclare aussi le domaine chez Resend**, alors que le libellé n'annonce
  qu'une lecture DNS. C'est idempotent et sur votre propre compte Resend.
  **Autre réserve :** les lignes Resend (le `MX` et le `TXT` de
  `send.<domaine>`) restent **grises** — elles n'ont jamais de verdict. Ce n'est
  pas une panne.

- [ ] **8.2.3 — Enregistrer, puis observer les trois choses qui doivent suivre.**

  **(a) Le routage — dans les 60 secondes :**
  ```bash
  $SSH "$DC logs --tail=20 routeur"
  ```
  **Attendu :** `routage écrit : nouveau.fr, admin.nouveau.fr, exemple.fr,
  admin.exemple.fr` — **l'ancien hôte est CONSERVÉ**. C'est structurel : on
  ajoute, on vérifie, puis seulement on retire. Retirer l'ancien au moment
  d'ajouter le nouveau, avec un certificat qui n'existe pas encore, rendrait
  l'administration injoignable **sur les deux domaines**.

  **(b) Le certificat du nouveau domaine :**
  ```bash
  sleep 60
  echo | openssl s_client -connect $NOUVEAU_DOMAIN:443 -servername $NOUVEAU_DOMAIN 2>/dev/null \
    | openssl x509 -noout -issuer -dates
  curl -sI https://$NOUVEAU_DOMAIN | head -1        # attendu : 200
  curl -sI https://$WEB_DOMAIN     | head -1        # attendu : 200 — L'ANCIEN SERT ENCORE
  ```

  **(c) Le retrait de l'ancien, à la passe suivante :**
  ```bash
  $SSH "$DC logs --tail=30 routeur"
  ```
  **Attendu :** `les nouveaux hôtes servent un certificat valide — retrait de
  exemple.fr, admin.exemple.fr`, puis un `routage écrit` sans les anciens.
  ```bash
  curl -sI https://$WEB_DOMAIN | head -1            # attendu : 404 — l'ancien est retiré
  ```

  **Ce que ça veut dire si ça échoue :**

  | Symptôme | Diagnostic |
  |---|---|
  | Le journal ne bouge pas du tout | La mutation n'a rien écrit, ou `routing.hotes` refuse. Vérifiez `ROUTING_SECRET` des deux côtés (5.6). |
  | `routage écrit` avec le nouveau, mais `curl https://$NOUVEAU_DOMAIN` reste en 404 | **Traefik ne relit pas.** C'est l'échec de la phase 7 : sans rechargement à chaud, le changement de domaine ne prend qu'au prochain déploiement. |
  | Le nouveau domaine n'obtient **jamais** de certificat | Le DNS ne mène pas au VPS, ou le quota est épuisé. **L'ancien reste routé indéfiniment**, donc le site tient. Mais lisez la limite 1 : le verrouillage revient à **J+72 h**. |
  | Vous êtes déconnecté du dashboard sur l'ancien domaine | Ne devrait pas arriver : l'ancienne origine reste de confiance pendant 72 h, sur une chaîne bornée à cinq domaines. Si ça arrive, connectez-vous sur `admin.$NOUVEAU_DOMAIN`. |

- [ ] **8.2.4 — Vérifier ce qui suit *aussi*, et qu'on oublie de regarder.**

  ```bash
  # la validation d'hôte du site — la condition, la seule, pour qu'il honore x-forwarded-for
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://$NOUVEAU_DOMAIN/api/consent \
    -H 'content-type: application/json' -d '{}'
  ```
  **Attendu :** `204` (l'endpoint répond 204 sans corps quelle que soit l'issue —
  c'est délibéré côté visiteur).

  Vérifiez ensuite dans le dashboard que le bouton **Prévisualiser** d'une page
  ouvre bien `https://$NOUVEAU_DOMAIN/<slug>?t=…` et non l'ancien domaine.
  **Si l'aperçu s'ouvre encore sur l'ancien :** `VITE_WEB_SITE_URL` est **figée
  dans le bundle au build**. Elle ne suit pas un changement de domaine : mettez
  à jour le secret GitHub et **redéployez**. C'est une limite connue de
  l'architecture, pas une régression.

- [ ] **8.2.5 — Revenir au domaine d'origine**, par le même écran, si le nouveau
  n'était qu'un test. La chaîne des anciens hôtes est bornée à **cinq par
  service** — le cas qui justifie cette borne est précisément la faute de frappe
  corrigée en trois minutes, où le domaine d'origine est le seul encore routé.

### 8.3 — Perdre son mot de passe et le retrouver, jusqu'à la reconnexion

> **Aucun agent n'a jamais pu faire ce parcours : personne ne saisit de mot de
> passe.** Les états « réussite » et « refus d'un mot de passe faible » sont
> testés mais jamais vus. C'est le parcours dont la recette apporte le plus.

- [ ] **8.3.1 — SORTIR RESEND DU MODE D'ESSAI. À faire AVANT, pas après.**

  `RESEND_TEST_MODE` vaut `true` par défaut, et **Resend accepte les envois sans
  les délivrer** — il ne les délivre qu'à ses propres adresses de test. Rien
  n'échoue, rien n'arrive, et vous chercheriez le problème dans le mauvais
  endroit.

  1. Dans le tableau de bord Resend : **vérifiez un domaine d'expédition**
     (enregistrements DKIM/SPF posés dans votre zone, statut *verified*).
  2. Puis :
     ```bash
     cd packages/backend
     npx convex env get RESEND_API_KEY >/dev/null && echo "clé posée"
     npx convex env set RESEND_TEST_MODE false
     npx convex env get RESEND_TEST_MODE          # attendu : false
     ```

  **`invitations.ts` lit `!== "false"` :** toute autre valeur que le littéral
  `false` garde le mode test. `False`, `0`, `no` ne marchent pas.

  **Si `RESEND_API_KEY` n'est pas posée :** `pnpm bootstrap` ne pose **pas** une
  clé vide, et il le dit. Posez-la : `npx convex env set RESEND_API_KEY`.

- [ ] **8.3.2 — Vérifier que la route existe avant de croire à une panne d'email.**

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    "$CONVEX_SITE_URL/api/auth/request-password-reset" \
    -H 'content-type: application/json' \
    -H "origin: https://$ADMIN_DOMAIN" \
    -d "{\"email\":\"inconnu@exemple.test\",\"redirectTo\":\"https://$ADMIN_DOMAIN/reset-password\"}"
  ```

  **Attendu : `200`.** Better Auth répond 200 même pour une adresse inconnue —
  c'est délibéré, ça ne révèle pas quelles adresses existent.
  **Si c'est `400 RESET_PASSWORD_DISABLED` :** `sendResetPassword` n'est pas
  monté, donc la clé Resend n'est pas chargée sur le déploiement. Reprenez 8.3.1.
  **Si c'est `403` :** le contrôle d'origine refuse — `SITE_URL` côté Convex ne
  vaut pas `https://$ADMIN_DOMAIN`.

- [ ] **8.3.3 — Le parcours réel, dans le navigateur.**

  1. `https://$ADMIN_DOMAIN/login` → « Mot de passe oublié ».
  2. Saisir **votre** adresse (`$ADMIN_EMAIL`).
  3. **Attendu :** une confirmation au conditionnel (« si un compte existe… »).
  4. **Attendu dans votre boîte, en moins de deux minutes :** un email de
     réinitialisation. **Réserve connue :** les emails ont perdu leurs ancres
     `<a href>` au profit d'un texte préformaté — la plupart des messageries
     transforment l'URL nue en lien, **pas toutes**. Si le lien n'est pas
     cliquable, **copiez l'URL** : ce n'est pas une panne.
  5. Ouvrir le lien → `https://$ADMIN_DOMAIN/reset-password?token=…`.

  **Si aucun email n'arrive :**
  ```bash
  cd packages/backend && npx convex logs --history 50 | grep -i -E 'resend|reset'
  ```
  Puis le tableau de bord Resend, onglet *Emails* — un envoi accepté mais non
  délivré y est visible, et c'est la signature du mode test.

- [ ] **8.3.4 — Éprouver les trois refus, pas seulement la réussite.**

  | Ce qu'on saisit | Attendu | Ce que ça prouve |
  |---|---|---|
  | Un mot de passe **faible** (ex. `motdepasse`) | **Refus**, avec un message sur la robustesse | Le hook `before` sur `/reset-password` s'exécute — Better Auth seul ne vérifie que la longueur |
  | Un mot de passe de **moins de 8 caractères** | Refus | La borne minimale |
  | Le **même jeton une seconde fois** | Refus (`INVALID_TOKEN`) | Le jeton est consommé |

  **Puis, quatre demandes d'affilée depuis la même adresse IP :**

  **Attendu :** `200, 200, 200, 429 PASSWORD_RESET_RATE_LIMITED`. Ce code ne
  pouvait pas exister avant le durcissement : il exige le chargement du module,
  la construction du limiteur, et une écriture persistante d'une requête à
  l'autre.
  **Si le 4ᵉ rend 200 :** le limiteur ne compte pas. Cause probable : le
  conteneur `web` ne reconnaît pas ses hôtes, donc n'honore pas
  `x-forwarded-for`, et tous les visiteurs tombent dans un seul seau — ou
  l'inverse, chacun dans le sien. Vérifiez `ROUTING_SECRET` côté `web` (5.6).

- [ ] **8.3.5 — LE POINT FINAL : se reconnecter avec le nouveau mot de passe.**

  Déconnectez-vous, puis reconnectez-vous sur `https://$ADMIN_DOMAIN/login`.

  **Attendu :** l'accès au dashboard, et l'**ancien** mot de passe refusé.
  **C'est cette étape qui n'a jamais été franchie par personne.** Si elle passe,
  le parcours de récupération est établi de bout en bout.

- [ ] **8.3.6 — L'issue manuelle, si vous vous faites piéger par une bascule.**

  Si le lien de réinitialisation pointe vers un domaine qui n'a plus de DNS
  (limite 3), **le jeton est dans l'URL** : recopiez-le sur l'**ancien** hôte,
  `https://<ancien-admin>/reset-password?token=<jeton>`. La page est servie par
  le même dashboard, et le POST vient d'une origine sortante de confiance. **Cette
  issue vit dans la fenêtre de 72 h et se ferme avec elle.**

### 8.4 — Recevoir un email de notification de lead depuis le formulaire public

- [ ] **8.4.1 — Envoyer un vrai message** depuis `https://$WEB_DOMAIN/contact`.

  **Attendu :**
  1. Une page de confirmation.
  2. Une ligne dans `/leads` du dashboard.
  3. **Un email de notification** à l'adresse de notification configurée.

- [ ] **8.4.2 — Diagnostiquer, dans cet ordre, si l'un des trois manque.**

  | Ce qui manque | Cause la plus probable | Vérification |
  |---|---|---|
  | Redirection vers `/contact?erreur=indisponible` | **`LEAD_SUBMIT_SECRET` absent ou divergent.** Le formulaire s'affiche, accepte la saisie, et **ne transmet jamais rien** : aucune ligne dans `leads`, aucune erreur dans les journaux du conteneur | comparer l'empreinte des deux côtés, comme en 5.6 |
  | La ligne apparaît dans `/leads`, mais pas d'email | `RESEND_TEST_MODE` encore à `true`, ou l'adresse de notification n'est pas renseignée | `npx convex env get RESEND_TEST_MODE` ; puis `/settings/emails` |
  | Ni ligne ni email, et aucune erreur nulle part | Même diagnostic que la première ligne — c'est la panne la plus silencieuse du système | idem |

- [ ] **8.4.3 — Vérifier le second envoi.** Réenvoyez un message avec la même
  adresse : la notification doit alors porter la **mention de relance**, qui
  dépend du nombre de messages déjà reçus. Elle est composée **autour** du
  gabarit, pas dedans — le langage de gabarit n'a pas de condition.

- [ ] **8.4.4 — Éprouver le limiteur du formulaire.** Cinq envois rapides depuis
  la même IP. **Attendu :** un refus au-delà du seuil.
  **Si aucun refus n'arrive :** même diagnostic qu'en 8.3.4 — la reconnaissance
  d'hôte du conteneur `web`.

---

## Phase 9 — La recette du reste de l'application

Le déploiement occupe le devant de la scène ; l'application entière reste à
recetter. Les écrans ci-dessous sont ceux qui existent réellement dans
`apps/admin/src/routes/` et `apps/web/src/pages/`.

### 9.1 — Les pages du site public

- [ ] Chacune de ces URL répond **200** et affiche du contenu :

  ```bash
  for p in / /fonctionnalites /tarifs /contact /blog /mentions-legales /confidentialite /cookies; do
    printf '%-22s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://$WEB_DOMAIN$p)"
  done
  curl -s -o /dev/null -w 'sitemap=%{http_code}\n'  https://$WEB_DOMAIN/sitemap.xml
  curl -s -o /dev/null -w 'llms=%{http_code}\n'     https://$WEB_DOMAIN/llms.txt
  curl -s -o /dev/null -w 'robots=%{http_code}\n'   https://$WEB_DOMAIN/robots.txt
  curl -s -o /dev/null -w 'health=%{http_code}\n'   https://$WEB_DOMAIN/api/health
  ```

  **Attendu :** 200 partout.
  **Si une page répond 404 :** sa ligne `pages` manque ou est en `draft`. **Une
  page est une paire** — son fichier `.astro` *et* sa ligne. Vérifiez dans
  `/pages` du dashboard.

- [ ] **`/mentions-legales` publie VOTRE identité**, pas un avis « non
  renseigné » et surtout pas « AstroTan ». Sinon, reprenez 1.7.
- [ ] **L'hébergeur nommé est OVHcloud**, pas Hostinger. C'est le contrôle qui
  attrape l'oubli le plus probable de ce plan.
- [ ] Les trois pages légales ne sont **pas** en `noindex` :
  ```bash
  curl -s https://$WEB_DOMAIN/mentions-legales | grep -i 'noindex' && echo "ENCORE NOINDEX"
  ```
  **Attendu :** rien. Un `noindex` restant = `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`
  est toujours à `true`.

### 9.2 — L'invariant qui protège les brouillons

- [ ] Créez une page en **brouillon** dans `/pages`, puis :
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://$WEB_DOMAIN/<slug-du-brouillon>
  ```
  **Attendu : `404`.** Une query publique qui rendrait un brouillon est une fuite
  — c'est l'invariant 1, et chaque query publique filtre
  `status === "published"` côté serveur.

### 9.3 — L'aperçu

- [ ] Depuis `/pages/<id>`, cliquer **Prévisualiser** sur le brouillon.
  **Attendu :** la page s'ouvre à **sa vraie URL** — `https://$WEB_DOMAIN/<slug>?t=…`
  — et non sur une route parallèle. Le jeton signe le **slug**.
- [ ] Le même lien **sans** le paramètre `?t=` répond 404.
- [ ] Un jeton bricolé (un caractère modifié) est refusé.
  **Si tout aperçu échoue :** `PREVIEW_SECRET` diverge entre Convex et le `.env`
  du VPS. Le jeton est frappé par Convex puis vérifié **deux fois** — dans Astro
  avant tout appel réseau, puis à nouveau dans Convex.

### 9.4 — Publication et invalidation de cache

- [ ] Publiez le brouillon, puis rechargez son URL publique sans `?t=`.
  **Attendu :** 200, dans les secondes.
  **Si la page reste 404 ou périmée longtemps :** `REVALIDATE_SECRET` diverge.
  L'action `drain` de Convex POSTe `${WEB_SITE_URL}/api/revalidate` avec l'en-tête
  `x-revalidate-secret` ; l'endpoint le compare en temps constant et refuse.
  `drain` réessaie avec un backoff, puis marque la ligne `failed` **après
  6 tentatives**. **Rien ne tombe** : les pages restent simplement périmées
  jusqu'à l'expiration du cache — **la panne la plus discrète du système**.

  ```bash
  cd packages/backend && npx convex logs --history 50 | grep -i revalidat
  ```

### 9.5 — Le blog

- [ ] `/blog` liste les articles publiés ; un article en brouillon n'y est pas.
- [ ] `/blog/<slug>` répond 200 pour un publié, 404 pour un brouillon.
- [ ] Créer, modifier, publier et dépublier un article depuis `/posts`.
- [ ] Les tags filtrent correctement.

### 9.6 — La médiathèque

- [ ] `/media` : téléverser une image, la voir listée, obtenir son URL, la
  supprimer. **Attendu :** l'URL rendue est joignable depuis le site public.

### 9.7 — Les redirections

- [ ] `/redirects` : créer une redirection `/ancien` → `/nouveau`.
  ```bash
  curl -sI https://$WEB_DOMAIN/ancien | head -2
  ```
  **Attendu :** un `301` (ou `302` selon le type choisi) avec le bon `location`.
- [ ] Éprouver les refus que l'écran sait rendre : une boucle
  (`/a` → `/a`), une source déjà utilisée, une destination malformée.
  **Attendu :** chacun **expliqué**, pas un échec muet.

### 9.8 — Le consentement et les traceurs

- [ ] **Sans** `PUBLIC_META_PIXEL_ID` ni `PUBLIC_GOOGLE_TAG_ID` :
  **Attendu :** **aucun bandeau de consentement**, et `/cookies` affiche
  « Aucun ». C'est le comportement **légitime** d'un site sans traceur, pas une
  panne. `shouldAskConsent()` rend `false`.
- [ ] Si vous **avez** posé un pixel : le bandeau s'affiche, et **aucune balise
  tierce n'est dans le HTML avant une réponse** :
  ```bash
  curl -s https://$WEB_DOMAIN/ | grep -c -E 'facebook|googletagmanager|gtag'
  ```
  **Attendu : `0`.** C'est l'invariant 9 — aucun tag tiers n'est jamais écrit
  dans le HTML ; il est injecté seulement après une réponse.
- [ ] Le choix est **journalisé** : après avoir répondu au bandeau, une ligne
  doit apparaître dans `consentRecords`.
  **Si rien n'est journalisé :** `CONSENT_LOG_SECRET` diverge. `/api/consent`
  répond **204 sans corps quelle que soit l'issue**, y compris en cas de refus —
  la panne est donc **invisible côté exploitation**, et la preuve qu'on croit
  conserver n'existe nulle part.

### 9.9 — Les statistiques Umami

Ne faites cette section que si vous avez déployé Umami.

- [ ] **9.9.1 — Changer le mot de passe `admin` / `umami` IMMÉDIATEMENT.**
  Ouvrez `https://$UMAMI_DOMAIN`. Ce compte est le même sur toutes les
  installations du monde, et le sous-domaine est public.
- [ ] **9.9.2 — Ajouter le site** (*Settings → Websites → Add website*), domaine
  = `$WEB_DOMAIN`. Notez le **Website ID**.
- [ ] **9.9.3 — Créer un compte de lecture** (*Settings → Users*, rôle
  `view-only`). S'il fuite, il ne donne que la lecture.
- [ ] **9.9.4 — Poser les quatre variables de lecture** — les quatre ou aucune,
  une configuration à moitié posée est traitée comme absente :
  ```bash
  cd packages/backend
  npx convex env set UMAMI_API_URL        https://$UMAMI_DOMAIN
  npx convex env set UMAMI_API_WEBSITE_ID <le Website ID>
  npx convex env set UMAMI_API_USERNAME   <le compte view-only>
  npx convex env set UMAMI_API_PASSWORD   <son mot de passe>
  ```
- [ ] **9.9.5 — Poser les deux secrets GitHub de mesure** (`PUBLIC_UMAMI_URL`,
  `PUBLIC_UMAMI_WEBSITE_ID`) **et redéployer** : Astro les fige **dans le bundle
  au build**. Les ajouter après coup ne change rien tant que le site n'est pas
  reconstruit.
  ```bash
  curl -s https://$WEB_DOMAIN/ | grep -o 'data-website-id="[^"]*"'
  ```
  **Attendu :** une ligne. **Rien = les variables manquaient au build.**
- [ ] **9.9.6 — Vérifier que les chiffres remontent** dans `/statistiques` du
  dashboard, et que le bouton ouvre Umami **déjà connecté** (SSO par Redis).
  **Si le bouton retombe sur le formulaire de connexion d'Umami :**
  `POST /api/auth/sso` a répondu « Redis is disabled » — vérifiez que le service
  `umami-redis` tourne.
  **Le compromis, en clair :** ce lien **prête un compte partagé**. Si
  `UMAMI_API_USERNAME` est un administrateur, le bouton donne l'administration
  d'Umami. Le bouton n'est proposé qu'aux rôles `owner` et `admin`.
- [ ] **9.9.7 — Si un rapport reste vide après une injection de test**, cherchez
  `{"beep":"boop"}` : Umami **jette** les événements dont l'en-tête `User-Agent`
  ressemble à un outil (`curl/…`, `python-requests/…`, `Googlebot/…`) — **et le
  rejet arrive en HTTP 200**, donc invisible d'un script qui ne regarde que le
  code de statut.

### 9.10 — Le journal d'audit

- [ ] Après les manipulations ci-dessus, vérifier que les gestes d'écriture ont
  laissé une trace (publication d'une page, modification d'un réglage, changement
  de domaine, suppression d'un lead).
  **À savoir :** l'écran `/settings/domaine` ne journalise pas la déclaration
  chez Resend — `settings.update` journalise le geste global. Ce n'est pas une
  omission accidentelle.

### 9.11 — Les rôles

- [ ] Inviter un `editor` depuis `/users`, se connecter avec, et vérifier que les
  écrans d'administration lui sont **refusés côté serveur**, pas seulement
  masqués. **L'UI masque, elle ne décide pas** : chaque mutation revérifie le
  rôle (invariant 3).
- [ ] Vérifier qu'un `admin` ne peut ni inviter, ni promouvoir, ni rétrograder,
  ni supprimer un autre `admin`.

### 9.12 — Les écrans de réglages restants

- [ ] `/settings/identite` — l'identité du site.
- [ ] `/settings/referencement` — titre et description par défaut ; vérifier
      qu'ils apparaissent dans le HTML servi.
- [ ] `/settings/reseaux` — les liens sociaux.
- [ ] `/settings/webhook` — si utilisé.
- [ ] `/settings/mesure` et `/settings/ia` — les jetons saisis depuis
      l'administration.
      **Si un bouton est désactivé avec `SECRETS_KEY_MISSING` :** la clé maîtresse
      n'est pas posée sur le déploiement Convex. **Toute la famille `secrets` est
      alors inerte** — le refus est propre, mais ces deux écrans sont décoratifs.
      L'écran affiche la commande exacte. Et **elle ne se régénère pas à la
      légère** : tous les jetons déjà saisis deviendraient indéchiffrables.
- [ ] `/settings/emails` — les gabarits des trois emails, et l'interrupteur de
      chacun. **Piège connu :** l'éditeur de gabarit **n'est pas couvert par le
      garde-fou de sortie** — quitter la page perd un texte long en cours
      d'écriture.

---

## Phase 10 — Le rollback, déclenché volontairement

> **Un rollback qu'on n'a jamais exécuté n'est pas une procédure, c'est un
> espoir.** Cette phase le déclenche pour de vrai, à un moment où l'échec ne
> coûte rien.

**Ce que le rollback fait, et pourquoi il ne peut pas être plus simple.** Il
rejoue **le pipeline entier** sur l'arbre du sha visé : `convex deploy` depuis
cet arbre, vérification que les images de ce sha existent encore sur GHCR,
`rsync` du `docker/` de ce sha, puis `compose up -d` avec `IMAGE_TAG=<sha>`.

**Ne jamais modifier `IMAGE_TAG` à la main sur le VPS.** C'est le raccourci qui a
l'air équivalent et ne l'est pas : il repointe les conteneurs sur d'anciennes
images tout en laissant en place les functions et le schéma Convex actuels, que
le déploiement fautif a déjà remplacés. On obtient **un frontend d'hier face à un
backend d'aujourd'hui** — la configuration que personne n'a jamais testée.

- [ ] **10.1 — Prendre un snapshot du VPS**, si votre gamme en offre un. C'est le
  second moment du plan où il vaut la peine.

- [ ] **10.2 — Produire un second déploiement**, visiblement différent du premier.
  Un changement de texte sur la page d'accueil suffit — quelque chose que vous
  pourrez **voir** disparaître.

  ```bash
  git commit -am "chore: visible marker for the rollback drill" && git push origin HEAD:main
  # attendre la fin du workflow Deploy
  $SSH 'cat ~/astrotan/DEPLOYED_SHA'
  export SHA_N1=<le nouveau sha>
  curl -s https://$WEB_DOMAIN/ | grep -c "<le texte ajouté>"     # attendu : ≥ 1
  ```

- [ ] **10.3 — Vérifier AVANT de lancer que les trois images du sha cible
      existent.**

  ⚠️ **Le workflow `Rollback` ne vérifie que DEUX images** (`astrotan-web` et
  `astrotan-admin`) : **il ne vérifie pas `astrotan-routeur`**. Une image
  `routeur` absente ne fait donc pas échouer le workflow en pré-vol — elle le
  fait échouer **sur le VPS, à mi-chemin d'un `compose pull`**, avec le routage
  déjà en jeu. Vérifiez à la main :

  ```bash
  for i in web admin routeur; do
    docker manifest inspect ghcr.io/$GHCR_OWNER/astrotan-$i:$SHA_N >/dev/null \
      && echo "$i OK" || echo "$i MANQUANTE"
  done
  ```

  **Attendu :** trois `OK`.
  **Si `routeur` manque :** ne lancez pas le rollback vers ce sha. Un sha
  antérieur à l'introduction du service `routeur` n'a pas cette image — mais son
  `docker-compose.yml` ne la demande pas non plus, puisque le compose vient du
  même arbre. **Le cas dangereux est celui d'un sha où le service existe mais où
  l'image a été purgée par `docker image prune`** ou par une politique de
  rétention GHCR.

- [ ] **10.4 — Lancer le rollback.**

  GitHub → *Actions* → **Rollback** → *Run workflow* → coller `$SHA_N`, **les 40
  caractères**.

  **Attendu :** le workflow refuse tout sha qui n'est pas exactement 40
  caractères hexadécimaux, puis enchaîne : checkout de l'arbre du sha,
  `convex deploy` depuis cet arbre, vérification des images, `rsync`,
  `compose up --wait`.

- [ ] **10.5 — Vérifier que l'état antérieur est réellement revenu.**

  ```bash
  $SSH 'cat ~/astrotan/DEPLOYED_SHA'                            # attendu : $SHA_N
  curl -s https://$WEB_DOMAIN/ | grep -c "<le texte ajouté>"    # attendu : 0
  $SSH "$DC ps"                                                 # tout healthy
  $SSH "$DC logs --tail=20 routeur"                             # routage écrit, pas de SECOURS
  curl -sI https://$WEB_DOMAIN   | head -1                      # 200
  curl -sI https://$ADMIN_DOMAIN | head -1                      # 200
  ```

  **Attendu :** le marqueur a disparu, le sha est revenu, tout est `healthy`.
  **Ce que ça veut dire si ça échoue :**

  | Symptôme | Diagnostic |
  |---|---|
  | Le workflow échoue à `docker manifest inspect` | Les images de ce sha ont été purgées. `docker image prune -f` tourne à chaque déploiement **sur le VPS** ; sur GHCR c'est une politique de rétention. **Un rollback n'est possible que tant que ses images existent.** |
  | `container … is unhealthy` | Le `--wait` a fait son travail : `DEPLOYED_SHA` n'est pas réécrit et le job échoue. Un rollback qu'on croit réussi est un incident qu'on croit clos. |
  | Le site sert l'ancien code mais l'admin ne connecte plus | Le sha visé est **antérieur à une phase *contract***. Le rollback n'est sûr **que d'un cran**, et seulement si la discipline expand / migrate / contract a été tenue. |
  | 404 après le rollback | Le compose du sha visé est revenu par `rsync`. S'il est antérieur au retrait des labels, les règles reviennent dans les labels — et `/dynamique/routes.yml` devient sans effet. Ce n'est pas une panne, mais changer de domaine depuis le dashboard ne marche plus à ce sha. |

- [ ] **10.6 — Revenir à l'avant.** Relancez `Rollback` avec `$SHA_N1`, ou
  poussez à nouveau sur `main`. Vérifiez que le marqueur est de retour.

- [ ] **10.7 — Écrire ce qu'on a appris.** Le temps réel du rollback de bout en
  bout est votre RTO. Notez-le : c'est le chiffre que vous n'aurez pas le temps
  de mesurer le jour où vous en aurez besoin.

---

## Phase 11 — Ce qu'on démarre à la main, et qu'on oubliera

Le pipeline `Deploy` **ne démarre jamais** ces services. C'est délibéré, et c'est
exactement pourquoi ils s'oublient.

- [ ] **11.1 — La purge de rétention d'Umami.** Sans elle,
  `/confidentialite` annonce une conservation de **13 mois** qui n'existe que si
  quelqu'un pense à lancer la commande. Le service porte `profiles: [purge]` :
  aucun `docker compose up` ordinaire ne le démarre.

  ```bash
  $SSH "$DC --profile purge up -d umami-purge"
  ```

  **Vérifier qu'il tourne — la commande sans le profil ne liste même pas ce
  service, donc « pas démarré » et « n'existe pas » sont indistinguables :**

  ```bash
  $SSH "$DC --profile purge ps umami-purge"
  $SSH "$DC --profile purge logs --tail 20 umami-purge"
  ```

  **Attendu :** une ligne `Up`, et une ligne de journal
  `[umami-purge] … purge des lignes de plus de 13 mois`. Il tourne ensuite en
  boucle : une purge immédiate, puis une par mois, et `restart: unless-stopped`
  le fait survivre aux redémarrages de l'hôte.

  **Sur une instance jeune, il ne supprimera rien — et c'est le comportement
  correct.** Pour le vérifier sans risque, comptez :
  ```bash
  $SSH "$DC exec umami-db psql -U umami -d umami -c \
    \"SELECT count(*) FROM website_event WHERE created_at < now() - interval '13 months';\""
  ```
  **Attendu : `0`.** Zéro n'est pas un signe de panne.

  **Sauvegardez AVANT la première purge** si la base contient déjà de la donnée
  ancienne : cette purge est irréversible, et la §12.1 est la seule chose qui la
  couvre.

- [ ] **11.2 — La purge Convex, elle, est automatique.** `retention.ts` purge
  `leads` (3 ans) et `consentRecords` (365 jours) sur un cron mensuel
  (`convex/crons.ts`). Vérifiez que le cron est bien enregistré :
  ```bash
  cd packages/backend && npx convex logs --history 100 | grep -i retention
  ```
  **Rien après un mois de fonctionnement mériterait un coup d'œil ; rien le
  premier jour est normal.**

- [ ] **11.3 — L'inventaire de ce qui n'est pas automatique.** Après relecture du
  compose et des workflows, **`umami-purge` est le seul service à profil**, donc
  le seul démarrage manuel de la pile. Les autres gestes manuels du déploiement
  sont des **actes uniques**, pas des services : `RESEND_TEST_MODE=false` (8.3.1),
  le mot de passe Umami (9.9.1), les cinq secrets GitHub `PUBLIC_*` que
  `bootstrap` ne pose pas (`PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID`,
  `PUBLIC_UMAMI_RECORDER`, `PUBLIC_META_PIXEL_ID`, `PUBLIC_GOOGLE_TAG_ID`), et
  les quatre `UMAMI_API_*` côté Convex.

  ```bash
  # ce que les workflows référencent — la liste qui fait autorité
  grep -oh 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u
  ```

---

## Phase 12 — Les sauvegardes

**Ce qui est irremplaçable sur ce VPS tient en trois volumes**, et ils n'ont ni
la même valeur ni le même remède.

| Volume | Ce qu'il porte | Si on le perd |
|---|---|---|
| `astrotan_acme` | **Les certificats Let's Encrypt** | Ils sont **redemandés** — donc le quota de 5 / 7 jours est consommé. Récupérable, mais potentiellement après une semaine d'attente |
| `astrotan_dynamique` | **Le routage** (`routes.yml`) | Le service le réécrit. **Mais si Convex est injoignable au même moment, le repli le recompose depuis le `.env` — donc en DÉFAISANT un changement de domaine réussi.** C'est un résidu connu et assumé |
| `astrotan_umami-db` | **Toutes les données d'audience** | **Irrécupérable.** C'est le seul volume applicatif du projet : le contenu vit dans Convex, qui a ses propres sauvegardes |

- [ ] **12.1 — Sauvegarder la base Umami.**

  ```bash
  $SSH "$DC exec -T umami-db pg_dump -U umami umami | gzip" > umami-$(date +%F).sql.gz
  ls -lh umami-$(date +%F).sql.gz
  ```

  **Attendu :** un fichier non vide (quelques dizaines de Ko même sur une base
  jeune).
  **Si le fichier fait 0 octet :** `docker compose exec` a échoué en silence dans
  le tube. Refaites sans le `| gzip` pour voir le message.

- [ ] **12.2 — Vérifier qu'une sauvegarde se RESTAURE.** Une sauvegarde jamais
  restaurée n'est pas une sauvegarde.

  ```bash
  # sur le VPS, une base jetable à côté de la vraie — RIEN n'est écrasé
  $SSH "$DC exec -T umami-db psql -U umami -d postgres -c 'CREATE DATABASE restore_test;'"
  gunzip -c umami-$(date +%F).sql.gz | $SSH "$DC exec -T umami-db psql -U umami -d restore_test"
  $SSH "$DC exec -T umami-db psql -U umami -d restore_test -c '\dt'"
  $SSH "$DC exec -T umami-db psql -U umami -d restore_test -c 'SELECT count(*) FROM website_event;'"
  # nettoyage
  $SSH "$DC exec -T umami-db psql -U umami -d postgres -c 'DROP DATABASE restore_test;'"
  ```

  **Attendu :** la liste des tables d'Umami, et un compte cohérent avec la vraie
  base.
  **La restauration en production, le jour venu, vise `umami` et non
  `restore_test` :**
  ```bash
  gunzip -c umami-<date>.sql.gz | $SSH "$DC exec -T umami-db psql -U umami umami"
  ```

- [ ] **12.3 — Automatiser, et vérifier que l'automatisation tourne.** Une tâche
  `cron` sur votre poste ou sur une machine tierce, pas sur le VPS lui-même — une
  sauvegarde qui vit sur la machine qu'elle protège n'en est pas une.

- [ ] **12.4 — `docker compose down -v` est INTERDIT sur ce VPS.** Le `-v`
  détruit les volumes, `umami-db` compris. `down` seul suffit à arrêter la pile.
  La seule exception documentée est la suppression **délibérée** de
  `astrotan_acme` lors de la bascule staging → production (phase 6), et celle de
  `astrotan_dynamique` en cas d'`EACCES`.

- [ ] **12.5 — Avant toute montée de version d'Umami.** Le tag est épinglé
  exactement (`3.3.1`), jamais `latest`. Une montée applique des **migrations
  Prisma** au premier démarrage : faites le dump **avant**. Un retour arrière se
  fait par restauration du dump, **pas** par un retour au tag précédent — une
  base déjà migrée n'est plus lisible par l'ancienne version.

---

## Phase 13 — Ce qu'on regarde quand quelque chose ne va pas

**L'ordre compte.** Chaque niveau élimine une famille de causes ; les regarder
dans le désordre fait chercher une panne applicative devant un pare-feu fermé.

- [ ] **13.1 — Est-ce que le paquet arrive ?** (depuis une machine tierce)
  ```bash
  nc -vz -w 5 $VPS_IP4 443
  ```
  `timeout` → **pare-feu réseau OVH** ou anti-DDoS (2.5, 2.6). Ne cherchez pas
  plus loin. `connection refused` → le paquet arrive, Traefik n'écoute pas.

- [ ] **13.2 — Est-ce que le DNS mène bien ici ?**
  ```bash
  dig +short A $WEB_DOMAIN; dig +short AAAA $WEB_DOMAIN
  ```
  Une IP tierce → proxy (3.4). Un `AAAA` inattendu → 2.7.

- [ ] **13.3 — Est-ce que la pile tourne ?**
  ```bash
  $SSH "$DC ps"
  $SSH "$DC --profile purge ps umami-purge"
  ```

- [ ] **13.4 — Est-ce qu'un routage existe ?** C'est la question neuve de cette
  version, et celle qu'on ne pense pas à poser.
  ```bash
  $SSH "$DC exec routeur cat /dynamique/routes.yml"
  $SSH "$DC logs --tail=50 routeur"
  ```

  | Ligne du journal | Ce que ça veut dire |
  |---|---|
  | `routage écrit : …` | Régime normal. |
  | `routage de SECOURS écrit …` | **La moitié Convex du routage manque.** Les hôtes servis sont ceux du `.env`, `/settings/domaine` est sans effet. |
  | `lecture des hôtes impossible` répété, **sans** écriture | Même cause, sur un déploiement qui avait déjà un routage : il est **FIGÉ**. |
  | `routage de secours impossible à écrire — EACCES` | Le volume a été créé à `root`. `down` + `docker volume rm astrotan_dynamique` + `up -d`. |
  | `hôtes écartés du fichier existant, non conformes` | Un hôte du fichier n'a pas une forme valide et a été ignoré — jamais une règle de routage bricolée. |
  | rien du tout, fichier absent | Deux lectures concordantes sont exigées avant la première écriture : attendez 60 s. |

- [ ] **13.5 — Est-ce que Traefik route et certifie ?**
  ```bash
  $SSH "$DC logs traefik | grep -i acme | tail -40"
  $SSH "$DC logs --tail=100 traefik"
  ```
  `unable to obtain ACME certificate` + 404 sur `/.well-known/acme-challenge/`
  → un tiers répond à votre place (proxy). Même message + timeout → port 80
  filtré. `too many certificates already issued` → **quota épuisé**, attendez.

- [ ] **13.6 — Est-ce que l'application répond ?**
  ```bash
  $SSH "$DC logs --tail=100 web"
  $SSH "$DC logs --tail=100 admin"
  $SSH "$DC exec web wget -qO- http://127.0.0.1:4321/api/health"
  ```
  Rappel : `healthy` n'atteste **pas** que Convex répond. `/api/health` est sans
  dépendance par construction.

- [ ] **13.7 — Est-ce que le backend répond ?**
  ```bash
  cd packages/backend && npx convex logs --history 100
  npx convex env list
  ```

- [ ] **Tableau des pannes connues, et de leur signature.**

  | Symptôme observé | Cause | Où c'est écrit |
  |---|---|---|
  | 404 partout, journal `routeur` muet, volume vide | Première passe pas encore faite (anti-battement, ~60 s) | 5.4 |
  | 404 partout, `routage de SECOURS` | `ROUTING_SECRET` ou `WEB_DOMAIN` manquants **côté Convex** | 5.6 |
  | Changer de domaine n'a aucun effet, site debout | Routage **figé** : la query refuse, un fichier existe déjà | 13.4 |
  | Le fichier change, Traefik ne suit pas | **Provider fichier qui ne surveille pas** — invalide l'architecture | 7.5 |
  | Certificat jamais émis | Proxy, port 80 filtré, `AAAA` mort, ou quota | 3.4 / 2.5 / 2.7 |
  | Cadenas valide mais lien proxy→VPS en clair | Cloudflare SSL « Flexible » | 3.4 |
  | Formulaire de contact silencieux, aucune ligne, aucune erreur | `LEAD_SUBMIT_SECRET` divergent | 8.4.2 |
  | Pages publiées qui restent périmées | `REVALIDATE_SECRET` divergent | 9.4 |
  | Consentement jamais journalisé, 204 partout | `CONSENT_LOG_SECRET` divergent | 9.8 |
  | Aperçu toujours refusé | `PREVIEW_SECRET` divergent | 9.3 |
  | Un seul seau de limitation pour tout Internet | Le conteneur `web` ne reconnaît pas ses hôtes | 8.3.4 |
  | Dashboard affiché, authentification qui tombe | `VITE_CONVEX_*` divergentes entre build et runtime | 8.1.3 |
  | Emails acceptés, jamais délivrés | `RESEND_TEST_MODE` encore à `true` | 8.3.1 |
  | `/settings/mesure` et `/settings/ia` décoratifs | `SECRETS_KEY` absente | 9.12 |
  | Conteneur mort au démarrage, `Cannot find module` | Version de pnpm cassée (11.19.0–11.23.x) | 1.1 |
  | Rapport Umami vide malgré des envois en 200 | `{"beep":"boop"}` — `User-Agent` d'outil | 9.9.7 |
  | Umami en boucle, `password authentication failed` | Postgres n'applique `POSTGRES_PASSWORD` qu'à l'**initialisation** du volume | `docker/README.md` §13.5 |
  | 502 pendant quelques secondes à chaque déploiement | **Assumé** : `compose up -d` recrée les conteneurs | `docker/README.md` §8 |

---

## Les trois limites connues, ouvertes et assumées

Elles ne sont pas cachées : le plan dit **comment les reconnaître si elles se
produisent**.

### Limite 1 — Le verrouillage revient à J+72 h si un domaine n'obtient jamais son certificat

**Le mécanisme.** Quand vous changez de domaine, le service `routeur` garde
l'ancien hôte routé **tant que le nouveau ne sert pas un certificat valide** —
et il le garde **indéfiniment**. L'authentification, elle, l'oublie à
l'expiration de la fenêtre de **72 heures**, qui est bornée volontairement : une
valeur qui n'expire jamais est une valeur que personne ne revient regarder, et
l'ancien domaine resterait reconnu **après** que vous l'ayez laissé expirer,
donc après un rachat par un tiers.

**La conséquence.** Passé 72 h avec un nouveau domaine qui n'a jamais obtenu de
certificat : l'ancien domaine **route encore** — le site s'affiche — mais toute
requête d'authentification venant de cette origine est refusée en
`403 INVALID_ORIGIN`. **Vous êtes enfermé dehors du dashboard.**

**Comment la reconnaître.** Le site répond sur l'ancien domaine, le nouveau est
en erreur de certificat, et toute tentative de connexion sur l'ancien admin
échoue en 403 — pas en « identifiants invalides ».

**La sortie.** Redéclarer l'ancien domaine depuis Convex :
```bash
cd packages/backend && npx convex env set WEB_DOMAIN <l'ancien> && npx convex env set ADMIN_DOMAIN <l'ancien admin>
```
et remettre `settings.declaredDomain` à l'ancienne valeur — ce qui exige un accès
au déploiement Convex, donc la clé de déploiement. **Vous ne repassez pas par
l'interface.**

**La parade.** Ne changez de domaine qu'avec les deux lignes `A` déjà vertes,
et **vérifiez le certificat du nouveau domaine dans l'heure** (8.2.3).

### Limite 2 — L'impasse derrière un proxy avec le challenge DNS-01

**Le mécanisme.** L'écran `/settings/domaine` verrouille son bouton sur la
comparaison du `A` déclaré avec l'adresse de l'hôte courant. Derrière un proxy,
l'hôte courant résout vers les adresses du proxy, le nouveau domaine aussi — la
comparaison est *correcte*, mais elle ne dit rien de l'accessibilité réelle du
VPS. Et si vous passez au challenge **DNS-01** pour contourner le proxy (c'est
aussi la seule voie pour un wildcard), le contrôle de forme et le contrôle de
comparaison ne peuvent plus trancher.

**Comment la reconnaître.** Le bouton d'enregistrement reste bloqué — ou, pire,
s'arme — **sur une configuration pourtant correcte**. Le cas `forme` (« A
plausible · aucun serveur de référence ») arme le bouton, et un adoptant derrière
Cloudflare y passe.

**Ce qui manque pour la fermer, et c'est nommé dans le registre :** savoir
demander à un hôte **s'il est bien ce déploiement**. Aucun signal actuel ne le
dit — celui que produit `drain` a la polarité inversée (il ne témoigne que dans
le sens positif).

**La parade.** Restez en HTTP-01, proxy en « DNS only ». C'est ce que le
template suppose partout.

### Limite 3 — Le lien de réinitialisation pointe vers le domaine courant

**Le mécanisme.** `baseURL` de Better Auth reste figée sur `SITE_URL`, une
variable d'environnement Convex. `trustedOrigins`, lui, est réévalué **par
requête** et ajoute les origines sortantes : **la connexion est donc rouverte sur
l'ancien domaine, mais le lien envoyé par email pointe vers le domaine courant**
— celui qui n'a pas encore de DNS pendant une bascule. La récupération n'est
rouverte qu'à moitié.

**Comment la reconnaître.** L'email arrive, et son lien mène à un nom qui ne
résout pas.

**L'issue manuelle, testée :** le jeton est dans l'URL morte. **Recopiez-le sur
l'ancien hôte** — `https://<ancien-admin>/reset-password?token=<jeton>`. La page
est servie par le même dashboard, et le POST vient d'une origine sortante de
confiance. **Cette issue vit dans la fenêtre de 72 h et se ferme avec elle.**

**La parade.** Ne combinez jamais un changement de domaine et une
réinitialisation de mot de passe. Faites 8.3 avant 8.2, ou attendez que 8.2 soit
entièrement stabilisée.

---

## Questions OVH ouvertes — à vérifier dans le panel, pas à supposer

Ce plan ne les tranche pas. Un plan qui affirme faux est pire qu'un plan qui
demande.

- **Q1 — Le pare-feu réseau.** Est-il **activé par défaut** sur cette gamme de
  VPS ? Est-il bien **sans état**, exigeant une règle « TCP established » pour le
  trafic retour des connexions sortantes ? Le test qui tranche est en 2.5 : un
  **timeout** depuis l'extérieur (et non un `connection refused`) est sa
  signature.

- **Q2 — Le mode rescue.** Le mot de passe root temporaire arrive-t-il bien par
  email à l'adresse du compte ? Sous quel nom de périphérique le disque du
  système normal apparaît-il dans le rescue ? Le `lsblk` de 2.9 le donne, mais le
  savoir **avant** l'incident change le temps de réparation.

- **Q3 — Les snapshots.** La gamme de ce VPS inclut-elle un emplacement de
  snapshot ? Exige-t-il l'arrêt de la machine ? Combien de temps prend-il ? Deux
  étapes de ce plan (2.10 et 10.1) en dépendent.

- **Q4 — L'IPv6.** L'image OVH installée configure-t-elle l'IPv6 automatiquement
  (cloud-init), ou faut-il la route explicite vers une passerelle hors préfixe ?
  Le test de 2.7 tranche pour **cette** machine ; la réponse générale dépend de
  la génération de VPS et de l'image.

- **Q5 — Le port 25 sortant.** Est-il bloqué sur cette gamme ? Sans conséquence
  ici (Resend s'appelle en HTTPS depuis Convex), mais bloquant si un envoi SMTP
  direct est ajouté un jour.

- **Q6 — Où vit la zone DNS ?** Le domaine est-il chez OVH **et** servi par les
  DNS OVH ? Le `dig +short NS` de 3.1 est la seule réponse qui compte —
  « acheté chez OVH » ne l'implique pas.

- **Q7 — Le TTL minimal.** Quelle est la plus petite valeur acceptée par
  l'éditeur de zone (OVH ou votre registrar) ? 300 s est demandé en 3.2 ; si le
  minimum est 3600, chaque correction de la phase 3 et de la phase 8.2 coûte une
  heure.

- **Q8 — La propagation réelle.** Combien de temps s'écoule entre une
  modification de zone et sa visibilité par les résolveurs publics
  (`dig @1.1.1.1`, `dig @8.8.8.8`) ? Cette valeur conditionne le rythme de la
  phase 8.2.

- **Q9 — L'identité légale d'OVHcloud à publier.** Raison sociale exacte, forme
  juridique, adresse du siège, telles qu'elles figurent sur les mentions légales
  d'OVHcloud **le jour de l'installation**. Ce plan ne les recopie pas de
  mémoire : c'est une mention légale, elle doit être exacte. Elle remplace la
  mention Hostinger codée en dur dans `apps/web/src/config/legal.ts` (étape 1.7).

- **Q10 — L'anti-DDoS.** Existe-t-il un indicateur d'état de mitigation dans le
  panel, et où ? Le savoir évite de chercher une panne applicative pendant une
  aspiration de trafic (2.6).

---

## Ce que ce plan a trouvé, et qui n'est pas une question OVH

Deux constats relevés en écrivant ce plan, à traiter séparément :

1. **`.github/workflows/rollback.yml` ne vérifie que deux images sur trois.**
   `astrotan-routeur` n'est pas dans son pré-vol `docker manifest inspect`. Un
   rollback vers un sha dont l'image `routeur` a été purgée échoue donc **sur le
   VPS, à mi-chemin d'un `compose pull`**, au lieu d'échouer proprement dans le
   workflow. Contourné en 10.3 par une vérification manuelle.

2. **`apps/web/src/config/legal.ts` code Hostinger en dur** comme hébergeur.
   Pour un déploiement OVH, `/mentions-legales` publierait une information
   fausse. Traité en 1.7, mais c'est une valeur d'exemple que le garde-fou
   `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` **tolère** tant qu'il vaut `true` — donc
   un adoptant qui personnalise tout **sauf** ce marqueur ne verra rien rougir.
