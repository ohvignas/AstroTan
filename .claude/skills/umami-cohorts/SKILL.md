---
name: umami-cohorts
description: Use when defining or reading an Umami cohort — the saved audiences under Audience → Cohorts, or the cohort=<uuid> parameter on /api/websites/{id}/*. Also use when cohort= answers 500 with an empty body while the same UUID works in segment=, when a cohort matches every visitor of the site, when a cohort returns zero however the dates move, when a cohort's numbers do not budge when the reporting window changes, or when deciding between a cohort and the retention report.
---

# Les cohortes d'Umami 3 (Audience → Cohortes)

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable peuplé pour l'occasion (24 visiteurs, 10 achats répartis sur trois
semaines). **La fonctionnalité existe en auto-hébergé** — rien ici n'est
réservé à Umami Cloud. Un rapport antérieur concluait que `cohort=` était
« attesté mais inexerçable » : c'était faute d'objet à interroger, et parce
que l'échec est un `500` muet.

Une **cohorte** est une audience définie par une *action* — « a vu telle
page », « a déclenché tel événement » — accomplie pendant une **fenêtre
glissante**, éventuellement restreinte par des filtres. On la rejoue ensuite
sur n'importe quelle lecture avec `cohort=<uuid>`, et l'on voit alors **tout
le comportement de ces gens**, y compris avant qu'ils ne rejoignent la
cohorte.

C'est la différence de fond avec un segment
([`../umami-segments/SKILL.md`](../umami-segments/SKILL.md)) : un segment
décrit *ce qu'une visite est* (Chrome, France, mobile), une cohorte décrit
*ce que quelqu'un a fait*. Et c'est aussi autre chose que le rapport
`retention` ([`../umami-retention/SKILL.md`](../umami-retention/SKILL.md)),
qui fabrique tout seul des cohortes par jour de première visite et n'a aucun
rapport avec ces objets enregistrés.

## Ce qu'il faut avoir en base

Une cohorte ne dit rien sans **une action que seule une partie des visiteurs
a accomplie**, et **datée dans la fenêtre glissante**. Les deux conditions se
ratent séparément :

- si tout le monde a fait l'action, la cohorte rend le site entier ;
- si l'action est ancienne, la cohorte rend zéro, quelle que soit la fenêtre
  de la requête (§ « la fenêtre est relative à maintenant »).

Fabriquer ces données se fait par `POST /api/send` : un événement nommé
(`{"name":"purchase"}`) pour une partie des visiteurs seulement, antidaté
via `timestamp` — **en secondes**, voir
[`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md). Pour distinguer
les visiteurs, faire varier l'en-tête `User-Agent` : il entre dans le
hachage de session.

## CRUD — le même point d'entrée que les segments

```http
GET    /api/websites/{websiteId}/segments?type=cohort   ← type OBLIGATOIRE
POST   /api/websites/{websiteId}/segments
GET    /api/websites/{websiteId}/segments/{cohortId}
POST   /api/websites/{websiteId}/segments/{cohortId}    ← mise à jour
DELETE /api/websites/{websiteId}/segments/{cohortId}
```

**Le chemin dit `segments`, pas `cohorts`.** `/api/websites/{id}/cohorts`
rend la page 404 de Next.js en `text/html`. Seul `type` sépare les deux
familles ; sans lui, `400 Invalid option: expected one of "segment"|"cohort"`.

Corps réel, réponse réelle :

```json
POST /api/websites/{websiteId}/segments
{"type":"cohort","name":"Acheteurs 30 jours",
 "parameters":{
   "action":{"type":"event","value":"purchase"},
   "dateRange":"30day",
   "filters":[{"name":"country","operator":"eq","value":"FR"}],
   "match":"all"}}
```
```json
{"id":"4b5297f7-0c20-4a9a-81c4-58b973e3fcd9",
 "websiteId":"1a4e95f9-…","type":"cohort","name":"Acheteurs 30 jours",
 "parameters":{"match":"all",
   "action":{"type":"event","value":"purchase"},
   "filters":[{"name":"country","value":"FR","operator":"eq"}],
   "dateRange":"30day"},
 "createdAt":"2026-08-28T21:02:05.394Z","updatedAt":"2026-08-28T21:02:05.394Z"}
```

**`action` et `dateRange` sont indispensables à la lecture, et le schéma de
création ne les exige pas.** Une cohorte sans `action`, ou sans `dateRange`,
s'enregistre en `200` et fait `500` à la première interrogation. C'est le
piège n°1, et c'est ce qui fait croire que la fonctionnalité n'existe pas.
L'interface, elle, part de
`{"filters":[],"dateRange":"30day","action":{"type":"path","value":""}}`.

### `action`

`{"type": <colonne>, "value": <chaîne>}`. `type` accepte n'importe quel nom
de la table `FILTER_COLUMNS` (la liste est dans
[`../umami-segments/SKILL.md`](../umami-segments/SKILL.md)) ; en pratique
`event` et `path` sont les deux qui ont un sens, et l'interface ne propose
qu'eux. Mesuré sur le jeu d'essai (10 acheteurs sur 24 visiteurs) :

```
action {type:"event", value:"purchase"}   → 10 visiteurs
action {type:"path",  value:"/commande"}  → 10 visiteurs
action {type:"title", value:"Commande"}   → 10 visiteurs
action {type:"event", value:"zzz"}        →  0 visiteur
action {type:"zzz",   value:"purchase"}   → 25 visiteurs   ← tout le site
```

**Un `type` hors vocabulaire n'est pas refusé : il ne produit aucune
condition, et la cohorte contient tout le monde.** `value` doit être une
chaîne (un nombre rend `400`) et n'est pas validée : une valeur qui n'existe
pas rend une cohorte vide, ce qui est correct mais indiscernable d'une
fenêtre mal choisie.

### `dateRange`

Le format est `<nombre><unité>`, sans espace ni pluriel. Éprouvés un à un :

| Marche | Rend `500` (corps vide) |
|---|---|
| `1hour` `24hour` `1day` `7day` `1week` `1month` `1year` | `60minute` · `7days` · `week` · `all` · `2026-08-01:2026-08-31` |

`minute` n'est pas une unité. Le pluriel, le nom d'unité seul, `all` et une
plage ISO explicite échouent tous de la même façon : `parseDateRange` rend
`null`, et la destructuration qui suit lève. Aucun message.

`match` vaut `all` (défaut, ET) ou `any` (OU) et porte sur les `filters`.

## La fenêtre est relative à **maintenant**, pas à la requête

C'est la propriété qui décide de l'usage, et rien dans l'API ne la dit.
`dateRange` est résolu au moment de la lecture, **sans jamais regarder
`startAt`/`endAt`**. Conséquence : la cohorte choisit *qui*, la fenêtre de
la requête choisit *quelle activité de ces gens on regarde*.

Mesuré, cohorte « a déclenché `purchase` dans les 7 derniers jours » :

```
fenêtre 1→31 août   →  3 visiteurs, 13 vues
fenêtre 16→19 août  →  1 visiteur,   4 vues
   … alors que /stats?startAt=16 août&endAt=19 août&event=purchase rend 0.
```

Sur la fenêtre 16→19 août, aucun achat n'a eu lieu ; la cohorte montre
pourtant l'activité d'un de ses membres, **antérieure à son achat**. C'est
exactement ce qu'on veut d'une cohorte (« que faisaient mes acheteurs avant
d'acheter ? »), et c'est illisible si l'on croit que `dateRange` borne le
rapport.

Deux corollaires :

- Une cohorte à `1day` sur un site dont les données s'arrêtent avant-hier
  rend **zéro partout**, quelle que soit la fenêtre demandée. Devant une
  cohorte vide, vérifier d'abord `dateRange` contre l'horloge, pas les dates
  de la requête.
- Les chiffres d'une cohorte **bougent tout seuls** d'un jour sur l'autre à
  fenêtre de requête constante. Une capture d'écran de cohorte n'est pas
  reproductible ; un test automatisé qui fige un nombre attendu cassera.

## Lire à travers une cohorte

```
GET /api/websites/{id}/stats?startAt=…&endAt=…&cohort=<uuid>
```

Mêmes points d'entrée que pour un segment, mêmes exclusions : `/stats`,
`/pageviews`, `/metrics`, `/sessions`, `/sessions/stats`, `/events` honorent
`cohort` ; **`/values` et `/api/realtime/{id}` l'ignorent en silence**.
Dans un rapport, c'est `filters` qui le porte :

```json
POST /api/reports/utm
{"websiteId":"…","type":"utm","filters":{"cohort":"<uuid>"},"parameters":{…}}
```

La cohorte se combine avec les filtres de la requête — `cohort=<acheteurs>`
plus `browser=chrome` rend l'intersection.

## Les pièges, dans l'ordre où ils coûtent cher

1. **`500` à corps vide pour toute cohorte mal formée.** Aucun message,
   `Content-Length: 0`, un `JSON.parse` côté client échoue sur une erreur de
   parsing sans rapport. Les quatre causes rencontrées, indiscernables entre
   elles depuis la réponse : `parameters.action` absent, `dateRange` absent
   ou d'un format non reconnu, UUID inconnu, UUID appartenant à un autre
   site. Le journal du conteneur les sépare (`Cannot read properties of
   undefined (reading 'type')` pour l'action manquante, `Cannot destructure
   property 'startDate'` pour la fenêtre) — c'est la seule voie de
   diagnostic.
2. **Un UUID de segment passé dans `cohort=` rend `500`** ; un UUID de
   cohorte passé dans `segment=` rend **`200` et un chiffre faux**. Le second
   applique les `filters` de la cohorte en jetant `action` et `dateRange` :
   mesuré, la cohorte « acheteurs FR sur 30 jours » vaut 4 visiteurs par
   `cohort=` et **10** par `segment=` — soit `country=FR` tout court. Les
   deux paramètres ne sont pas interchangeables, et l'un des deux sens
   d'erreur est silencieux.
3. **Un `action.type` inconnu fait une cohorte universelle** (voir plus
   haut). Le contrôle qui tranche : comparer à `/stats` sans paramètre. Deux
   nombres identiques signalent une condition évaporée, jamais « toute
   l'audience a converti ».
4. **Les `filters` d'une cohorte portent sur la qualification, pas sur
   l'affichage.** `country=FR` dans une cohorte sélectionne les *membres*
   français ; il ne restreint pas ensuite leurs visites depuis l'étranger. Le
   même filtre passé en paramètre de requête, lui, restreint l'affichage.
   Deux nombres différents, aucune erreur.
5. **L'interface exclut `path` et `event` des filtres additionnels** d'une
   cohorte (c'est le rôle de l'action). L'API, elle, les accepte — un filtre
   `event` ajouté par API produira une condition qui ne se comporte pas comme
   l'action, et rend zéro comme dans un segment.

## Ce qui n'a pas été vérifié

- **La forme peuplée d'une cohorte à plusieurs actions** : le schéma n'a
  qu'un `action` singulier, aucune séquence n'a pu être exprimée.
- **`match: "any"` sur les filtres d'une cohorte** n'a été éprouvé que sur
  les segments, où il bascule bien en OU ; le chemin cohorte préfixe les
  noms (`cohort_*`) et n'a pas été mesuré séparément.
- **Les permissions d'équipe** : tous les appels ont été faits avec le compte
  propriétaire.
- **L'interface** n'a pas été pilotée au navigateur ; sa forme par défaut a
  été lue dans le bundle servi et correspond à celle décrite ici.
- **Umami Cloud** : rien n'a été testé contre l'offre hébergée.
