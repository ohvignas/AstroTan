---
name: umami-events
description: Use when reading or debugging the Umami Events screen — named custom events, their properties and property values. Also use when /api/websites/{id}/events/series answers 400 about a missing timezone, when an events response arrives wrapped in a "data" key while /stats is flat, when limiting an event series drops whole event names instead of rows, when filtering /metrics or /stats by event= returns zero, when event-data/values ignores eventName, or when a per-page hit count is larger than the page's view count.
---

# La vue Events d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable dont chaque événement a été fabriqué par `POST /api/send`.

Mécanique HTTP commune (jeton, fenêtres en millisecondes, filtres ignorés) :
[`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md).

## Ce que fait l'écran

Events ne montre que les hits **nommés** — ceux envoyés avec un `name` —, leur
répartition dans le temps, et les propriétés qu'ils portent. Les vues de page
n'y figurent pas : elles sont dans Overview.

## Comment on l'alimente

Un événement nommé est un `POST /api/send` ordinaire avec un champ `name`,
et un objet `data` facultatif pour les propriétés :

```bash
curl -X POST "$UMAMI/api/send" -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 … Chrome/140 …' \
  -d '{"type":"event","payload":{"website":"'"$ID"'","hostname":"localhost",
       "url":"/contact","name":"cta-click",
       "data":{"label":"header","position":3,"paid":true}}}'
```

- **Sans `name`, c'est une vue de page** (`eventType: 1`), pas un événement.
  C'est la seule différence entre les deux dans la charge utile.
- `timestamp` est honoré et il est en **secondes** — antidater fonctionne.
- L'en-tête `User-Agent` est obligatoire, sinon le hit est rejeté.
- Depuis un navigateur, c'est `umami.track("cta-click", {…})` ou l'attribut
  `data-umami-event-*` ([`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)).

Les propriétés sont typées à l'écriture : `dataType` `1` = chaîne,
`2` = nombre, `3` = booléen. Un booléen est stocké dans `stringValue`
(`"true"`) avec `dataType: 3`.

## Les trois onglets et leurs appels

| Onglet | Appel |
|---|---|
| chiffres de tête | `GET /api/websites/{id}/events/stats?startAt=&endAt=` |
| Chart | `GET /api/websites/{id}/events/series?startAt=&endAt=&unit=hour&timezone=…&limit=50` |
| Activity | `GET /api/websites/{id}/events?startAt=&endAt=&maxResults=10000` |
| Properties | `GET /api/websites/{id}/event-data/properties?startAt=&endAt=` |

Le classement « top events » de l'écran vient de
`GET /api/websites/{id}/metrics?…&type=event&limit=50`.

## `/events/stats` : une troisième forme de totaux

```json
{"data":{"events":3,"visitors":3,"visits":3,"uniqueEvents":2,
         "comparison":{"events":1,"visitors":1,"visits":1,"uniqueEvents":1}}}
```

**Tout est enveloppé dans `data`.** C'est la troisième convention de la même
API pour la même idée :

```
/stats            → {"pageviews":18,…}                plat
/sessions/stats   → {"pageviews":{"value":18},…}      par métrique
/events/stats     → {"data":{"events":3,…}}           enveloppé
```

Un parseur qui lit `res.events` sur celui-ci rend `undefined` puis 0 : un
site sans le moindre événement, sans erreur.

`comparison` est **rempli sans drapeau** (mesuré : un événement placé dans la
période précédente le fait passer de 0 à 1), et `compare=yoy` le bascule sur
l'année précédente. Comme pour `/stats`, `compare=prev` est le défaut et donc
un no-op.

## `/events/series` : la clé du temps s'appelle `t`, pas `x`

```json
[{"x":"cta-click","t":"2026-08-28T19:00:00Z","y":1},
 {"x":"signup",   "t":"2026-08-28T19:00:00Z","y":1},
 {"x":"cta-click","t":"2026-08-28T20:00:00Z","y":1}]
```

Trois pièges dans ces trois lignes :

1. **`x` est le nom de l'événement, `t` est l'intervalle.** Partout ailleurs
   (`/pageviews`, `/metrics`) `x` porte l'abscisse. Un tracé écrit par
   habitude met les noms d'événements en axe des temps.
2. **`timezone` est obligatoire** — sans lui, `400 "expected string, received
   undefined"`. `unit` est facultatif (défaut horaire) ; `week` rend
   `400 Invalid unit`.
3. **`t` change de format avec le fuseau** : `"2026-08-28T19:00:00Z"` en UTC,
   `"2026-08-28 21:00:00"` en `Europe/Paris` — espace, aucun fuseau. Passée à
   `new Date(...)`, la seconde forme est lue en heure locale du navigateur.

**`limit` coupe des noms d'événements, pas des lignes.** Mesuré : `limit=1`
sur un jeu à deux noms rend deux lignes — les deux intervalles de
`cta-click` — et fait **disparaître `signup` entièrement**. Ce n'est pas une
troncature de liste, c'est un « top N par nom ». Un graphique qui perd une
courbe entière sans rien signaler vient de là.

`search=` est **accepté et ignoré** sur `/events/series` (mesuré : `search=cta`
rend aussi `signup`). Il fonctionne en revanche sur `/metrics?type=event`.

## Les propriétés : quatre endpoints, deux unités de comptage

```
GET /event-data/stats      → {"events":3,"properties":6,"records":"7"}
GET /event-data/properties → [{"eventName":"cta-click","propertyName":"label","dataType":1,"total":2}, …]
GET /event-data/events     → identique à /event-data/properties
GET /event-data/values?propertyName=label[&eventName=cta-click]
                           → [{"value":"footer","total":1},{"value":"header","total":1}]
```

- **`records` sort en chaîne** (`"7"`) quand il y a des données, et à `null`
  quand il n'y en a pas — jamais `0`. `events` et `properties`, eux, sont des
  nombres. Sommer `records` sans conversion concatène.
- `/event-data/events` et `/event-data/properties` rendent **exactement la
  même chose** ; le second est celui qu'utilise l'écran.
- `/event-data/values` **exige `propertyName`** (`400` sinon) et accepte
  `eventName` en plus. Contrairement à ce qu'on craint, `eventName` **filtre
  vraiment** : `eventName=signup&propertyName=label` rend `[]` alors que
  `label` n'existe que sur `cta-click`.
- Une propriété inconnue rend `[]`, pas une erreur.

## Le filtre `event=` ne se combine pas avec les vues

Mesuré sur un jeu où `cta-click` s'est produit deux fois sur `/contact` :

```
/metrics?type=event&event=cta-click → [{"x":"cta-click","y":2}]   ✅
/metrics?type=path&event=cta-click  → []                          ⚠️ 200
/stats?event=cta-click              → {"pageviews":0,…}            ⚠️ 200
```

`event=` sélectionne les lignes nommées ; `type=path` et `pageviews` ne
comptent que les vues. L'intersection est vide **par construction**, et la
réponse est un `200` parfaitement plausible. « Sur quelles pages cet
événement s'est-il produit ? » n'a donc **pas** de réponse par `/metrics` —
et le rapport `breakdown` ne la donne pas non plus
([`../umami-breakdown/SKILL.md`](../umami-breakdown/SKILL.md)). Le seul
chemin mesuré qui marche est la liste brute :
`GET /api/websites/{id}/events?…&event=cta-click`, qui rend les hits avec
leur `urlPath`.

## `/values` sur-compte : il additionne tout, pas les vues

Reproduction minimale — un site neuf, trois hits sur `/demo` : une vue, un
événement nommé, une mesure `performance` :

```
/stats?path=/demo        → {"pageviews":1,…}
/metrics?type=path       → [{"x":"/demo","y":1}]    ← visites
/values?type=path        → [{"value":"/demo","count":3}]   ← les trois hits
/events (liste)          → 2 lignes (la vue et l'événement nommé)
```

`/values` compte **toutes les lignes** portant ce chemin : vues, événements
nommés, et jusqu'aux mesures de performance qui n'apparaissent pourtant dans
aucune liste. `umami-read-api` §1 présente `count` comme « le nombre de
vues » : c'est exact sur un site sans événement personnalisé, et faux dès
qu'il y en a. Pour des vues, c'est `/stats?path=` ou le rapport `breakdown`.

## La liste brute : `maxResults` plafonne `count`, pas les lignes

```
GET /api/websites/{id}/events?startAt=&endAt=&pageSize=&page=&search=&event=
→ {"data":[…], "count":15, "page":1, "pageSize":20, "isCapped":false}
```

Chaque ligne : `eventType` **1 = vue, 2 = événement nommé**, plus `urlPath`,
`urlQuery` (séparés), `eventName`, `hasData`, `sessionId`.

**`maxResults=2` rend `count: 2` et `isCapped: true` — avec 15 lignes dans
`data`.** Le paramètre plafonne le comptage, pas la collection. Afficher
`count` comme « nombre d'événements » ment dès que l'écran passe `maxResults`
(le tableau de bord passe `10000`). `isCapped` est le seul témoin.

Les mesures `performance` ne sont **jamais** dans cette liste, quel que soit
le filtre.

## Ce qui n'a pas été vérifié

- Aucune propriété de type **date** n'a pu être produite : `dataType` 1, 2 et
  3 sont attestés, la valeur pour les dates ne l'est pas (les colonnes
  `dateValue` existent pourtant dans les réponses de session).
- Les **revenus** (propriétés d'événement interprétées comme montants) n'ont
  pas été essayés — voir
  [`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).
- Le comportement de `/events/series` au-delà de ~30 jours n'a pas été mesuré ;
  `/pageviews` y rétrograde `unit=hour` en silence, il est prudent de
  supposer la même chose ici sans l'affirmer.
- Rien n'a été essayé contre **Umami Cloud**.
