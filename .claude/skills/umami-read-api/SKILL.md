---
name: umami-read-api
description: Use when reading numbers out of an Umami instance over HTTP — /api/websites/{id}/stats, /pageviews, /metrics, /values, /sessions, /events, /active. Also use when a per-page total looks too small, when a chart has holes or its dates shift by a day, when a filter seems to do nothing, when an evolution reads as a progression from nothing, when /metrics answers 400, when a query returns HTML instead of JSON, or when statistics are plausible but wrong.
---

# Lire des chiffres dans Umami 3 (API HTTP)

Vérifié à la main contre une instance **3.3.1 auto-hébergée**. La
documentation en ligne décrit par endroits Umami Cloud ou la 2.x ; tout ce
qui suit a été mesuré par `curl`, plusieurs points avec un jeu de données
fabriqué pour trancher.

Pour l'intégration Umami *de ce dépôt* (variables, SSO, Convex), voir
[`../analytics-umami/SKILL.md`](../analytics-umami/SKILL.md). Ce skill-ci
porte sur l'outil.

## Ce qui rend des chiffres faux sans lever d'erreur

C'est la seule section qui compte vraiment. Chacun de ces points répond
`200`.

### 1. `/metrics` compte des **visites**, pas des vues

Le piège le plus coûteux, parce que le résultat a l'air d'un classement de
pages vu.

Mesuré sur un jeu fabriqué : deux sessions, l'une visitant `/a` trois fois
puis `/b`, l'autre `/a` une fois. Donc `/a` = **4 vues** sur **2 visites**.

```
/stats                 → {"pageviews":5,...}
/metrics?type=path     → [{"x":"/a","y":2},{"x":"/b","y":1}]     ← visites
/values?type=path      → [{"value":"/a","count":4},{"value":"/b","count":1}]  ← vues
```

`y` est le nombre de **sessions ayant touché le chemin**. Rien dans la
réponse ne le dit, et le total d'un classement `/metrics` ne se raccorde
jamais au `pageviews` de `/stats` — ce qu'on met alors sur le compte de la
troncature par `limit`.

**Il n'existe aucun paramètre pour basculer `/metrics` en vues.**
`metric=`, `measure=`, `value=` sont acceptés et ignorés. Pour des vues par
page, c'est `/values`, ou un rapport `breakdown`
([`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md)).

`GET /api/websites/{id}/values?startAt=&endAt=&type=path` **n'est documenté
nulle part** — la doc ne connaît que `event-data/values` et
`session-data/values`. Il existe, il répond `[{value, count}]`, et `count`
est bien le nombre de vues.

### 2. Des filtres acceptés et ignorés — dont quatre qui sont pourtant des `type` valides

Méthode qui tranche : donner au filtre une valeur impossible. Un filtre
appliqué rend zéro ; un filtre ignoré rend le total du site.

| Appliqués | Acceptés puis **ignorés** |
|---|---|
| `path` `title` `query` `referrer` `hostname` `browser` `os` `device` `language` `country` `region` `city` `event` `tag` | `url` `screen` `channel` `entry` `exit` `utm_source` (et les autres `utm_*`) |

`channel`, `entry`, `exit` et `screen` sont des `type` de ventilation
valides pour `/metrics` : on peut ventiler par canal, **pas** filtrer par
canal. Rien ne le signale.

`url=` est le nom d'Umami 2 ; en 3.x le filtre s'appelle `path`. Mesuré sur
le site du dépôt : `url=/contact` → 17 vues (le site entier),
`path=/contact` → 2.

`segment` et `cohort` sont des paramètres réels, non documentés, qui exigent
un UUID (`400 Invalid UUID` sinon).

### 3. `comparison` est rempli **sans** `compare=prev`

`.claude/skills/analytics-umami/SKILL.md` affirme que `comparison` vaut zéro
sauf si la requête porte `compare=prev`. **C'était faux en 3.3.1**, et
`packages/backend/convex/analytics.ts` porte un commentaire qui répète
l'erreur.

Mesuré avec des événements antidatés dans deux fenêtres adjacentes (5 vues
dans la fenêtre courante, 2 dans la précédente) :

```
sans compare      → comparison:{"pageviews":2,…}
compare=prev      → comparison:{"pageviews":2,…}   identique
compare=yoy       → comparison:{"pageviews":0,…}   année précédente
```

`prev` est le **défaut** ; le drapeau est un no-op. Ce que `compare` change
réellement, c'est le passage à `yoy`. Seules valeurs admises : `prev`,
`yoy` — toute autre rend `400`.

D'où venait l'erreur : une fenêtre dont la période précédente est vide rend
`comparison` à zéro, ce qui *ressemble* à un drapeau manquant. Ne jamais
conclure sur un paramètre à partir d'une fenêtre sans données antérieures —
c'est le confondant qui a produit cette affirmation, et il se retend à
chaque test.

### 4. Les séries sont **creuses**, et les deux tableaux ne sont pas appariables par indice

`/pageviews` rend `{pageviews:[{x,y}], sessions:[{x,y}]}`. **Les intervalles
vides sont absents**, pas à zéro : un mois avec trois jours de trafic rend
trois points. Tracer ça sans re-remplir donne un graphique qui ment sur les
dates.

Et les deux tableaux sont construits séparément : rien ne garantit qu'ils
portent les mêmes intervalles ni la même longueur. Les apparier par indice
(`sessions[i]` avec `pageviews[i]`) est un bug latent — il faut joindre
**sur `x`**. `packages/backend/convex/analytics.ts` apparie par indice.

### 5. `unit=hour` est rétrogradé en silence au-delà de ~30 jours

```
fenêtre 30 j, unit=hour → intervalles horaires
fenêtre 31 j, unit=hour → un seul intervalle journalier
```

Même code, même paramètre, granularité changée sans un mot. Un tableau de
bord qui laisse l'utilisateur élargir la fenêtre change de résolution en
route.

`unit` admet `minute` `hour` `day` `month` `year`. **`week` et `quarter`
rendent 400** — la doc ne les liste pas non plus, mais l'absence de `week`
surprend tout le monde une fois.

Contrairement à ce que dit la doc, `unit` et `timezone` sont **facultatifs**
sur `/pageviews` (elle les note « required »). Sans `unit`, le défaut est
horaire.

### 6. Le format de `x` change selon `timezone`

```
absent ou timezone=UTC  → "2026-08-28T00:00:00Z"
timezone=Europe/Paris   → "2026-08-28 00:00:00"     ← espace, aucun fuseau
```

La seconde forme, passée à `new Date(...)`, est interprétée en **heure
locale du navigateur** : le graphique se décale d'un cran pour une partie
des lecteurs, et jamais pour celui qui l'a développé s'il est à Paris.
Normaliser à la lecture plutôt que de faire confiance à la forme.

Un fuseau inconnu rend `400 Invalid timezone` — celui-là est franc.

### 7. Une fenêtre qui se termine avant les données rend zéro partout

Évident écrit ainsi, et pourtant : un `endAt` calculé au démarrage du
processus, ou pris sur une horloge en retard, rend un site vivant
parfaitement vide, avec `200`. C'est arrivé pendant l'écriture de ce skill.
Devant des zéros, vérifier la fenêtre **avant** de soupçonner l'ingestion.

## Ce qui échoue franchement

- `/metrics` **exige** `type` ; sans lui, `400` avec le détail zod. `type=url`
  → `400` (c'est `path`), `type=host` → `400` (c'est `hostname`),
  `type=referrerDomain` → `400` (c'est `domain`).
- `type` valides, vérifiés un à un : `path` `entry` `exit` `title` `query`
  `referrer` `domain` `channel` `hostname` `browser` `os` `device` `screen`
  `language` `country` `region` `city` `event` `tag` `distinctId`.
- `/stats` sans fenêtre → `400 "Either startAt+endAt or startDate+endDate
  must be provided"`. **Le second n'existe pas** : `startDate=2026-08-01`
  rend `500` avec un corps vide, dans les deux formats essayés. Le message
  d'erreur oriente vers une voie qui casse.
- **Un chemin d'API inexistant rend `404` en `text/html`**, la page Next.js,
  pas du JSON. Un client qui fait `JSON.parse` sur toute réponse échoue sur
  une erreur de parsing sans rapport avec le vrai problème (une faute de
  frappe dans l'URL). Tester le `content-type`, ou au moins le statut.
- `401` pour un jeton absent, invalide ou révoqué — sans distinction.

## Fenêtres, pagination, formes de réponse

- `startAt` / `endAt` sont des **millisecondes** Unix. Les rapports, eux,
  prennent des dates ISO ailleurs — voir
  [`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).
- `/metrics` accepte `limit`, `offset` et `search` (sous-chaîne sur `x`).
  Aucun plafond constaté sur `limit`.
- Les listes paginées rendent `{data, count, page, pageSize, orderBy}` et
  acceptent `page`, `pageSize`, `orderBy`. `pageSize=9999` est accepté sans
  plafond. **`query=` est accepté et ignoré** sur `/api/websites` comme sur
  `/api/admin/websites` — une valeur qui ne peut rien matcher rend tout.
- Trois formes de totaux qui se ressemblent et ne s'échangent pas :

```
/stats           → {"pageviews":17,"visitors":3,…,"comparison":{…}}   plat
/sessions/stats  → {"pageviews":{"value":17},"visitors":{"value":3},…} enveloppé
/event-data/stats→ {"events":0,"properties":0,"records":null}
```

`/stats` rend des **nombres plats** ; la forme `{value, prev}` par métrique
est celle d'Umami 2. Lue à l'ancienne, chaque métrique sort `undefined` puis
0 : une page éternellement sans visite, sans erreur.

- `/sessions` rend une ligne par session avec `visits`, `views`, `events` —
  c'est la voie sûre pour recouper un total : la somme des `views` égale le
  `pageviews` de `/stats`.
- `/api/websites/{id}/events` rend les hits bruts : `eventType` **1 =
  pageview, 2 = événement nommé**.
- Le temps réel est `GET /api/realtime/{websiteId}`, **pas**
  `/api/websites/{id}/realtime` (404 HTML).

## La méthode, plus utile que la liste

Deux réflexes, parce que l'API répond `200` à des paramètres qu'elle jette :

1. **Prouver qu'un filtre agit** en lui donnant une valeur impossible. S'il
   rend le total du site, il est ignoré. C'est ainsi qu'ont été trouvés
   `channel`, `entry`, `exit`, `screen`, `utm_*` et `query`.
2. **Ne jamais valider une sémantique sur un jeu de données ambigu.** Un
   filtre que tout satisfait, une fenêtre précédente vide, un site à une
   seule page : chacun rend deux hypothèses indiscernables. Fabriquer les
   données qui les séparent — deux sessions aux comptes différents ont suffi
   à établir §1, deux fenêtres antidatées à réfuter §3.
