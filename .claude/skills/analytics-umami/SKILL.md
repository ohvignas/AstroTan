---
name: analytics-umami
description: Use when touching anything about audience measurement in AstroTan — packages/backend/convex/analytics.ts, the Umami services in docker/, apps/web/src/components/Analytics.astro, the admin dashboard or its Statistiques button. Also use when the dashboard shows zeros, when statistics look plausible but wrong, when POST /api/auth/sso answers "Redis is disabled", when a link that should open Umami does nothing, or when wiring Umami into a fresh deployment.
---

# Umami dans AstroTan

Chaque point de cette page a été payé une fois dans ce dépôt. Trois des
erreurs listées ne levaient **aucune exception** : elles produisaient des
chiffres faux, et les tests passaient.

## La règle qui aurait évité la moitié de cette page

**Un stub que vous écrivez encode vos hypothèses, donc il sera toujours
d'accord avec votre code.** Ce module a été livré vert — tests, `tsc`,
push Convex — avec quatre erreurs d'API, découvertes en dix minutes le jour
où un vrai Umami a tourné. Lancer l'instance réelle avant d'écrire le
parseur, pas après :

```bash
cd docker && docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml up -d umami
```

La procédure complète est dans [`docker/README.md`](../../../docker/README.md) §13.5.

## Les deux moitiés, qui ne vivent pas au même endroit

| | Ce que c'est | Où ça vit | Quand c'est lu |
|---|---|---|---|
| `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID` | le script qui **écrit** les visites | secrets GitHub → build-args (`docker/web.Dockerfile`), et `apps/web/.env.local` en local | **au build** |
| `UMAMI_API_URL`, `UMAMI_API_WEBSITE_ID`, `UMAMI_API_USERNAME`, `UMAMI_API_PASSWORD` | les identifiants qui **lisent** les chiffres | déploiement Convex (`npx convex env set`) | à l'exécution |
| `UMAMI_API_SHARE_ID` *(facultative)* | le partage en lecture seule | déploiement Convex | à l'exécution |
| `UMAMI_DOMAIN`, `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET`, `UMAMI_TWO_FACTOR_ENCRYPTION_KEY` | le service lui-même | `.env` du VPS | au démarrage des conteneurs |

**Le préfixe `UMAMI_API_` n'est pas décoratif.** Le `.env` du VPS porte déjà
`UMAMI_DB_PASSWORD` et `UMAMI_APP_SECRET` : sans l'infixe, quelqu'un colle un
secret dans le champ d'un autre, et le message d'erreur ne le dira pas.

**La moitié écriture a été oubliée une fois, entièrement.** Le
`web.Dockerfile` ne déclarait aucun `ARG PUBLIC_UMAMI_*` et `deploy.yml` n'en
passait aucun : toute image de production aurait été construite sans le
script, et le tableau de bord aurait affiché zéro pour toujours sans rien
dire. Après tout changement, le contrôle qui tranche :

```bash
curl -s http://<le site>/ | grep -o 'data-website-id="[^"]*"'
```

Une ligne : branché. Rien : les variables manquaient **au build** — Astro les
fige dans le bundle, les ajouter ensuite ne change rien tant que le site
n'est pas reconstruit.

## L'API d'Umami 3 — quatre pièges, trois silencieux

Vérifiés contre la 3.3.1 épinglée dans le compose. Les tests de
`convex/analytics.test.ts` portent les charges utiles réelles et épinglent
chacun de ces points : les rouvrir casse un test plutôt que le produit.

| Ce qu'on croit (Umami 2) | Ce que fait Umami 3 |
|---|---|
| `/stats` rend `{value, prev}` par métrique | **Nombres plats** + un objet `comparison` frère. Lu à l'ancienne, chaque chiffre sort `undefined` puis 0 : une page éternellement sans visite. |
| `?url=/contact` filtre sur une page | **Accepté et ignoré**, sans erreur. La réponse est celle du site entier. Le paramètre s'appelle `path`. Mesuré : `url=/contact` → 11 vues, `path=/contact` → 2. |
| `/metrics` rend des vues | Il rend des **visites** — une par session. Mesuré : `/` sortait à 2 par `/metrics` et à 5 vues par `/stats?path=/`. Afficher ce chiffre sous « pages les plus vues » sous-estimait de plus de la moitié, sous une étiquette fausse. |
| `/metrics?type=url` | **400.** Le type s'appelle `path`. Celui-là, au moins, échoue franchement. |

## Le SSO — ce qui le fait marcher, et ce qui l'a cassé

Arriver sur Umami déjà connecté depuis l'administration :

1. Convex s'authentifie (`/api/auth/login`) — **côté serveur, jamais dans le
   navigateur**.
2. `POST /api/auth/sso` frappe un jeton d'échange à usage unique.
3. Le navigateur le présente à `/sso?url=…&token=…`, Umami ouvre la session.

**Redis est obligatoire.** Sans lui, l'étape 2 répond `500 {"message":"Redis
is disabled"}` — un message qui ne parle pas d'authentification et qu'on lit
d'abord comme une panne. C'est la raison d'être du service `umami-redis` du
compose ; il ne persiste rien sur disque, ces jetons expirant en minutes.

**`url` est obligatoire.** Sans ce paramètre, la page `/sso` consomme le
jeton et s'arrête sur un **écran blanc**, sans erreur. Le jeton est brûlé :
il faut en frapper un autre pour réessayer.

**Ne pas ouvrir l'onglet en JavaScript.** `window.open(u, "_blank",
"noopener")` rend `null` **par spécification** dès que `noopener` est
présent : la référence à remplir n'existe pas, et le bouton ne fait *rien*.
Retirer le drapeau ne suffit pas — des navigateurs et des contextes
embarqués bloquent `window.open` même dans un vrai geste utilisateur. La
barre latérale pointe donc une **ancre ordinaire** vers `/statistiques`, une
route de l'admin qui frappe le jeton puis redirige. Un lien, aucun bloqueur
ne l'arrête, et le clic-milieu fonctionne.

**Le lien prête un compte partagé.** Umami ouvre la session de
`UMAMI_API_USERNAME` : il ne délègue pas l'identité de qui clique.
Conséquences assumées — l'historique d'Umami ne distingue pas les personnes,
et qui clique peut tout ce que ce compte peut. D'où `requireRole(["owner",
"admin"])` sur `ssoLink`, quand les fonctions qui ne rendent que des chiffres
restent ouvertes aux trois rôles.

## Règles de code

- **Une `action`, jamais une `query`.** Une query ne peut pas sortir sur le
  réseau, et surtout elle est réactive : elle rappellerait Umami à chaque
  tick d'abonnement.
- **Aucun identifiant de lecture ne doit atteindre le navigateur.** C'est
  toute la raison pour laquelle ces appels partent de Convex et non de
  l'admin. Un appel depuis le dashboard les exposerait aux outils de
  développement.
- **Aucune panne ne doit casser un écran.** Toute défaillance devient un
  état lisible (`not-configured`, `unreachable`, `unauthorized`), jamais une
  exception. Des statistiques sont une information, jamais une dépendance de
  l'édition d'une page.
- **Ne jamais afficher zéro pour une panne.** Un zéro se lit « personne
  n'est venu » — une information fausse dont l'auteur peut tirer une
  conclusion. Une liste absente dit qu'elle est absente.
- **« Non configuré » est une réponse ordinaire.** Un template livré sans
  Umami ne doit pas avoir l'air cassé, et l'absence de configuration est
  l'interrupteur : `Analytics.astro` n'émet aucune balise, le menu masque son
  bouton.

## Une page créée dans l'admin n'a RIEN à déclarer dans Umami

C'est la question qui revient, et la réponse évite d'écrire du code inutile.

**Umami ne connaît pas de pages. Il connaît des chemins, et il les découvre
en les recevant.** Un site = un `websiteId`, un seul. Il n'existe aucune
notion de page enregistrée, donc rien à créer, rien à synchroniser, rien à
supprimer quand une page disparaît.

Prouvé plutôt qu'affirmé — un chemin jamais vu, envoyé une fois, est
immédiatement interrogeable :

```bash
curl -X POST "$UMAMI/api/send" -H 'content-type: application/json' \
  -H 'User-Agent: Mozilla/5.0 … Chrome/140 …' \
  -d '{"type":"event","payload":{"website":"'"$ID"'","hostname":"localhost",
       "url":"/une-page-qui-vient-d-etre-creee"}}'
# puis
curl -H "authorization: Bearer $TOK" \
  "$UMAMI/api/websites/$ID/stats?startAt=…&endAt=…&path=%2Fune-page-qui-vient-d-etre-creee"
# → {"pageviews":1,"visitors":1,…}
```

**Le `User-Agent` décide si l'événement est gardé, et l'échec porte un code
de succès.** Mesuré : `curl/8.7.1`, `python-requests/…` ou `Googlebot/2.1`
font répondre **`200 {"beep":"boop"}`** et l'événement est **jeté** ;
absent, vide ou ressemblant à un navigateur, il est écrit. Le piège est à
l'envers de ce qu'on croit — ce n'est pas l'absence qui bloque, c'est de
ressembler à un outil. Un script qui ne regarde que le code de statut ne
verra jamais rien. Si un rapport reste vide après une injection, chercher
`beep` avant toute autre hypothèse.

**Ne pas écrire de synchronisation page ↔ Umami.** Ce serait un
second modèle de données à tenir à jour, pour une API qui n'en veut pas.
`analytics.forPath` interroge le chemin, et c'est tout — même mécanisme
pour une page, un article, ou une route qui n'existe dans aucune table.

Ce qui, en revanche, se configure **une fois par site** dans Umami et ne
concerne pas les pages : les objectifs (Goals), les entonnoirs (Funnels),
les segments, la rétention, l'UTM et les revenus. Ce sont des analyses, pas
des déclarations de contenu.

## Replays et Heatmaps : deux interrupteurs, pas un

Ils ne marchent pas avec le seul script de comptage.

1. **Dans Umami** — *Settings → le site → Replays & Heatmaps*. Le bloc
   « Tracking code » affiche alors une **seconde balise**, `recorder.js`.
2. **Sur le site** — `PUBLIC_UMAMI_RECORDER=true`, puis **reconstruire**
   (la variable est figée au build comme les deux autres).

L'un sans l'autre ne produit rien, et sans erreur. Le contrôle qui tranche,
dans l'onglet réseau : `GET /recorder.js` → 200, puis
`GET /api/websites/<id>/recorder` → 200 — c'est l'enregistreur qui demande
sa configuration au serveur, donc l'interrupteur d'Umami commande bien.

**Ce n'est pas la même promesse que le comptage**, et c'est pourquoi la
variable est séparée et éteinte par défaut. Compter note qu'une page a été
vue ; un replay rejoue ce qu'une personne y a fait, saisies comprises selon
la configuration. La charge utile de §13.3 ne décrit plus ce qui part, et
l'argument « sans donnée personnelle, donc sans bandeau de consentement »
ne tient plus tel quel. `recorder.js` pèse ~190 ko, et chaque session
s'écrit dans la base à sauvegarder.

## Une erreur commise ici, et comment elle a survécu à la vérification

**Ce document a affirmé que `compare=prev` était obligatoire. C'est faux :
`comparison` est rempli avec ou sans le drapeau.**

L'observation d'origine était réelle — sans drapeau, `comparison` valait
zéro — mais elle reposait sur un facteur de confusion : dans chaque essai
« sans drapeau », la période précédente était vide. La mesure décisive
demande **la même fenêtre** dans les deux cas, avec du trafic dans la
période précédente :

```
fenêtre 20:00→21:00 (4 vues), période précédente 19:00→20:00 (15 vues)
sans drapeau   → comparison = 15
&compare=prev  → comparison = 15
```

La leçon vaut au-delà d'Umami : **une variable qu'on croit tester n'est
testée que si tout le reste est tenu constant.** Comparer deux appels qui
diffèrent par le drapeau *et* par la fenêtre ne prouve rien sur le drapeau.

Le drapeau reste dans le code : il coûte zéro et dit ce qu'on attend. Mais
il y est comme un choix explicite, pas comme une obligation.

## Deux pièges d'appariement, dont un a mordu

**`/metrics` compte des visites, `/stats?path=` compte des vues.** Le même
jour, `/` sortait à 2 par le premier et 5 par le second. Le tableau de bord
affichait donc un chiffre juste sous « Pages les plus vues » — étiquette
fausse, et sous-estimation de plus de la moitié.

**`pageviews` et `sessions` sont deux tableaux construits séparément.**
Rien ne garantit qu'ils portent les mêmes seaux : un jour avec des vues
mais aucune session ouverte apparaît dans l'un et pas dans l'autre. Les
apparier **par indice** décale alors tout ce qui suit, en silence et de
façon plausible — 9 visiteurs posés sur le mauvais jour. Joindre sur la
clé `x`, jamais sur la position.

## Idées reçues corrigées

- **« Umami ne compte pas `localhost`. »** Faux, et ce document l'a affirmé
  avant de le vérifier. Mesuré : `POST /api/send` répond `200` depuis
  `http://127.0.0.1:4331/`. Si l'écran reste à zéro en local, chercher les
  variables manquantes **au build**, pas un comportement d'Umami.
- **« Il suffit de créer un compte Umami avec le même mot de passe que le
  propriétaire du site. »** Ça met un mot de passe en clair dans un second
  magasin, les deux divergent au premier changement sans que personne le
  voie, et il faut **quand même** le taper sur le formulaire d'Umami. Le SSO
  ci-dessus fait mieux sur les trois points.
- **« Le stub passe, donc le parseur est bon. »** Voir en tête de page : un
  stub écrit par la même personne que le code encode les mêmes hypothèses.
  Trois des quatre pièges de ce document ont survécu à une suite verte.
- **« Il faut déclarer chaque page dans Umami. »** Non — voir plus haut.
  L'API n'a pas de notion de page, et écrire cette synchronisation
  créerait un second modèle de données pour rien.
- **« Un jeton dans l'URL, c'est toujours à proscrire. »** Le jeton du
  *compte*, oui : une URL se dépose dans l'historique, dans les en-têtes
  `Referer` et dans les journaux des proxys. Le jeton d'*échange* d'Umami est
  à usage unique et à vie courte — la forme d'un lien de connexion par
  email. Confondre les deux fait rejeter le bon mécanisme.

## Brancher un déploiement neuf — la liste

1. `docker compose up -d umami` (avec Redis, il est dans le compose).
2. Ouvrir `https://<UMAMI_DOMAIN>`, se connecter `admin` / `umami`,
   **changer ce mot de passe immédiatement** — il est identique partout.
3. *Add website* → noter le **Website ID**.
4. `npx convex env set` les quatre `UMAMI_API_*` (depuis `packages/backend`).
5. Poser `PUBLIC_UMAMI_URL` et `PUBLIC_UMAMI_WEBSITE_ID` en secrets GitHub,
   puis **redéployer** — elles n'entrent que par le build.
6. Vérifier avec le `curl` ci-dessus que la balise est dans la page.
7. Visiter le site, puis recharger l'accueil de l'administration.

En local, remplacer les étapes 5 et 6 par `apps/web/.env.local` et un
`pnpm --filter @astrotan/web run build`.
