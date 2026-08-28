---
name: umami-journeys
description: Use when reading or debugging Umami journeys — the observed sequences of pages and events inside a visit. Also use when POST /api/reports/journey answers "steps: Invalid input: expected number, received NaN", when its items arrays have different lengths and indexing them breaks, when the same items array appears twice in one response, when journey counts do not match the visitor count, or when startStep returns an empty array for a path that clearly has traffic.
---

# Les parcours d'Umami 3 (`Behavior → Journeys`)

Vérifié contre une **3.3.1 auto-hébergée**, sur un site sonde fabriqué pour
ça. La mécanique HTTP commune aux rapports est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Ce que c'est

Le parcours agrège les suites d'étapes **réellement observées** pendant les
visites et les compte : une ligne = une suite distincte, avec son nombre
d'occurrences. C'est l'inverse de l'entonnoir — l'entonnoir vérifie une
hypothèse qu'on écrit, le parcours restitue ce qui s'est produit sans
qu'on l'ait nommé ([`../umami-funnels/SKILL.md`](../umami-funnels/SKILL.md)).

## Quelles données doivent exister

Des **visites à plusieurs étapes**. Une visite d'une seule page rend une
ligne `["/", null, null]` — techniquement un parcours, visuellement rien.
Il faut donc des visiteurs qui enchaînent des pages *dans la même visite*.

L'identité d'un visiteur se déduit de la session : **hachage déterministe de
`websiteId` + `hostname` + IP + `User-Agent`** (vérifié — même couple IP/UA,
même `sessionId`). Une IP par visiteur via `X-Forwarded-For`, honoré. Le
script complet qui fabrique un jeu utilisable est dans
[`../umami-funnels/SKILL.md`](../umami-funnels/SKILL.md) ; **un `User-Agent`
d'outil (`curl/…`, `python-requests/…`, `probe/1.0`) reçoit
`200 {"beep":"boop"}` et n'écrit rien.**

## Le lire

Il n'y a **rien à définir** : la page `Behavior → Journeys` interroge
directement, avec quatre réglages — *Steps* (3 par défaut), *Start Step*,
*End Step*, et une bascule *All / Views / Events*. Ce ne sont pas des
rapports enregistrés.

```http
POST /api/reports/journey
{"websiteId":"<uuid>","type":"journey","filters":{},
 "parameters":{"startDate":"2026-08-08T00:00:00Z",
               "endDate":"2026-08-29T00:00:00Z",
               "timezone":"UTC",
               "steps":4}}
```

`steps` est **obligatoire** et numérique — l'omettre donne
`"steps": ["Invalid input: expected number, received NaN"]`.

Réponse réelle, `steps: 4` :

```json
[{"items":["/","/blog",null,null],                                "count":16},
 {"items":["/","/tarifs","telecharger-brochure",null,null],       "count":2},
 {"items":["/",null,null],                                        "count":2},
 {"items":["/","/tarifs","/inscription","/merci",null],           "count":2},
 {"items":["/","/tarifs",null,null],                              "count":1},
 {"items":["/","/tarifs","/inscription",null,null],               "count":1},
 {"items":["/","telecharger-brochure",null,null],                 "count":1},
 {"items":["/","/tarifs","/inscription","telecharger-brochure",null],"count":1}]
```

La charge utile que l'interface envoie elle-même, capturée sur le réseau :

```json
{"websiteId":"…","type":"journey","filters":{},
 "parameters":{"startDate":"2026-07-28T22:00:00.000Z",
               "endDate":"2026-08-28T21:59:59.999Z",
               "timezone":"Europe/Paris","unit":"day",
               "steps":3,"startStep":"","endStep":"",
               "view":"views","eventType":1}}
```

`view` est décoratif ; c'est `eventType` qui filtre.

## Les pièges

### 1. `count` compte des **visites**, pas des visiteurs

`["/","/blog"]` rend `count: 16` alors que **8** visiteurs distincts ont fait
ce trajet — huit personnes revenues deux fois chacune. L'interface titre
pourtant ses colonnes « N visitors ». Les deux ne coïncident que sur un site
où personne ne revient.

### 2. Les tableaux `items` n'ont pas tous la même longueur

Dans **la même réponse** à `steps: 4`, on trouve des `items` de longueur 3, 4
et 5. Le remplissage par `null` n'est pas régulier et ne vaut pas
`steps + 1`. Donc : **jamais d'accès par indice**, jamais de
`items[steps - 1]`. Filtrer les `null` et lire le préfixe non nul :

```ts
const etapes = row.items.filter((x): x is string => x !== null)
```

### 3. Les événements personnalisés sont des étapes comme les autres

`telecharger-brochure` apparaît au milieu d'une suite de chemins, sous son
nom, **rien dans la ligne ne dit que c'en est un**. Un consommateur qui
suppose « une étape = une URL » produit des chemins inventés.

Pour les séparer — c'est la bascule *All / Views / Events* de l'interface :

| Voulu | À envoyer |
|---|---|
| pages seules | `"parameters":{…,"eventType":1}` |
| événements seuls | `"parameters":{…,"eventType":2}` |
| tout | ne rien mettre |

`filters:{"eventType":1}` marche aussi ; l'interface, elle, le met dans
`parameters`.

### 4. Des lignes en double, avec le même `items`

Avec `eventType: 2`, la réponse contient **deux fois**
`["telecharger-brochure",null,null]`, avec `count` 4 puis 1 :

```json
[{"items":["telecharger-brochure",null,null],"count":4},
 {"items":["inscription-terminee","telecharger-brochure",null,null],"count":1},
 {"items":["inscription-terminee",null,null],"count":1},
 {"items":["telecharger-brochure",null,null],"count":1}]
```

Les lignes ne sont pas dédupliquées. Regrouper soi-même par la suite d'étapes
et **sommer** — sinon on affiche deux fois la même entrée, ou on n'en garde
qu'une et on perd des visites.

### 5. `startStep` et `endStep` sont des **valeurs**, pas des indices

Vérifié en capturant la requête de l'interface : taper `/` dans *Start Step*
envoie `"startStep":"/"`. Ce sont des chaînes ; `"1"`, `"0"`, `"2"` rendent
`[]`.

- `startStep` retient les parcours **commençant** par cette valeur ;
- `endStep` ceux qui s'y **terminent**.

D'où un résultat vide qui n'est pas une panne : `startStep:"/tarifs"` rend
`[]` alors que 7 visiteurs ont vu `/tarifs` — parce qu'**aucune visite ne
commence là**. Le parcours ne sait pas répondre à « que font-ils après
`/tarifs` » ; il ne connaît que des parcours entiers, ancrés à la première
étape de la visite.

### 6. Les clés de `filters` ne sont pas validées

`filters:{"zzz":"nimporte"}` rend le résultat **non filtré**, sans erreur —
comme partout ailleurs dans `/api/reports/*`.

## Ce qui n'a pas pu être vérifié

- **La raison des longueurs inégales de `items`.** Le comportement est
  reproductible et documenté ci-dessus, son origine (bug de remplissage ou
  intention) ne l'est pas — d'où la consigne défensive plutôt qu'une règle
  de longueur.
- **Comment une visite est découpée**, et donc où un parcours s'arrête : le
  jeu d'essai n'a pas testé la limite des 30 minutes d'inactivité.
- Des valeurs de `steps` **au-delà de 4** (seuls 2, 3 et 4 ont été exécutés).
- `filters` par **segment** ou **cohorte** : aucun n'existait à interroger.
- Rien n'a été testé contre **Umami Cloud**.
