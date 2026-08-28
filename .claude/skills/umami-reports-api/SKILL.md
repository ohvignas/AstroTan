---
name: umami-reports-api
description: Use when building or debugging an Umami report over HTTP — funnel, retention, journey, goal, breakdown, attribution, UTM, revenue, performance, heatmap, or POST /api/reports/*. Also use when a report answers 400 with "Invalid input: expected date, received Date", "expected record, received undefined", "Invalid discriminator value", when a report returns empty arrays on a site that clearly has traffic, or when per-page view counts are needed and /metrics gives the wrong number.
---

# Les rapports d'Umami 3 (`POST /api/reports/*`)

Vérifié contre une instance **3.3.1 auto-hébergée**. Les dix types ont été
exécutés jusqu'à `200`. La doc en ligne ne donne pas la forme du corps qui
marche ; l'API la donne elle-même, à condition de savoir lire ses refus.

## Le contrat, qui n'est pas celui du reste de l'API

```http
POST /api/reports/<type>
Authorization: Bearer <token>
Content-Type: application/json

{
  "websiteId": "<uuid>",
  "type": "<type>",                    // doit répéter le segment d'URL
  "filters": {},                       // obligatoire, {} accepté
  "parameters": {
    "startDate": "2026-08-01T00:00:00.000Z",   // ISO, DANS parameters
    "endDate":   "2026-09-30T00:00:00.000Z",
    "timezone": "UTC",
    "unit": "day"
    // + les champs propres au type
  }
}
```

Trois pièges dans ce seul bloc :

1. **Les dates vivent dans `parameters`, en ISO.** Partout ailleurs dans
   l'API ce sont `startAt`/`endAt` en millisecondes Unix
   ([`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md)). Une même API,
   deux conventions de date.
2. **Un `dateRange` de premier niveau est ignoré**, sans erreur. C'est la
   forme qu'on écrit spontanément ; elle passe la validation du reste et
   échoue ensuite sur `parameters` manquant.
3. **`type` doit être répété dans le corps.** Le segment d'URL seul ne suffit
   pas : `Invalid discriminator value`.

### Le message d'erreur qui n'a pas de sens

```
"startDate": {"errors":["Invalid input: expected date, received Date"]}
```

« attendu date, reçu Date » se lit comme un bug de l'API. Il signifie
seulement : *`parameters.startDate` est absent*. Le validateur décrit la
valeur qu'il a fabriquée par défaut, pas celle qu'on a envoyée. Ne pas
chercher un problème de format — ajouter le champ.

## Faire cracher le schéma à l'API plutôt que le deviner

C'est la manière la plus rapide, et elle vaut pour toute l'API 3.x : les
refus sont des erreurs zod détaillées qui **énumèrent les champs et leurs
valeurs admises**. Envoyer `{"websiteId":…, "filters":{}, "type":"funnel",
"parameters":{}}` et lire la réponse donne la liste exacte des champs
manquants. Deux allers-retours suffisent pour n'importe quel type.

## Les dix types, et leurs paramètres propres

Valeurs admises pour `type`, telles que l'API les énumère — **`goal` au
singulier, et `insights` n'existe pas** :

`attribution` `breakdown` `funnel` `goal` `heatmap` `journey` `performance`
`retention` `revenue` `utm`

| Type | En plus des dates | Vérifié |
|---|---|---|
| `retention` `utm` `performance` `heatmap` | — | `200` |
| `journey` | `steps` (nombre) | `200` |
| `goal` | `type` (`path`/`event`), `value` | `200` → `{"num":1,"total":3}` |
| `funnel` | `window` (nombre, minutes), `steps: [{type,value}]` | `200` |
| `revenue` | `currency` (ISO 4217) | `200` |
| `attribution` | `model` (`first-click`\|`last-click`), `type` (`path`\|`event`), `step` | `200` |
| `breakdown` | `fields: string[]` | `200` |

`breakdown.fields` est un tableau de **chaînes nues**, pas d'objets, et le
vocabulaire est en **camelCase** — donc `utmSource`, là où les filtres de
`/metrics` s'écrivent `utm_source` :

`path` `referrer` `title` `query` `os` `browser` `device` `country` `region`
`city` `tag` `hostname` `distinctId` `language` `event` `utmSource`
`utmMedium` `utmCampaign` `utmContent` `utmTerm`

## `breakdown` est la bonne réponse à « des vues par page »

`/metrics?type=path` compte des **visites**, pas des vues — le piège central
de [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md). `breakdown`
rend les deux d'un coup, ventilés :

```json
[{"views":"5","visitors":2,"visits":2,"bounces":0,"totaltime":"16",
  "path":"/","browser":"chrome"}]
```

**`views` et `totaltime` sortent en chaînes**, `visitors`/`visits`/`bounces`
en nombres, dans le même objet. Sommer sans convertir concatène :
`"5" + "6"` vaut `"56"`. Aucune erreur, un total absurde.

## Un rapport vide n'est pas forcément une panne

Trois types rendent des structures vides sur un site pourtant actif, et la
cause est en amont, pas dans la requête :

- **`performance`** → tout à zéro tant que le traqueur ne porte pas
  `data-performance="true"`. Ce n'est pas le défaut
  ([`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)).
- **`heatmap`** → `{"mode":"click","points":[],"snapshot":null,…}` sans
  l'enregistreur (`recorderEnabled` est `false` à la création d'un site).
- **`revenue`** → `{"sum":null,"count":0,…}` sans événements portant des
  propriétés de revenu. Noter `sum: null`, pas `0` : une somme absente et une
  somme nulle ne se distinguent que là.

`utm` rend cinq tableaux vides (`utm_source`, `utm_medium`, …) si aucune
visite n'a porté de paramètres UTM — c'est une mesure, pas une erreur.

## Rapports enregistrés : la même URL, un autre schéma

`POST /api/reports/<mot qui n'est pas un type>` ne rend pas 404 : la requête
tombe sur la **création de rapport enregistré**, qui attend
`{type, name, parameters}`. D'où un `400` parlant de `name` alors qu'on
croyait exécuter un rapport — c'est ce qui arrive avec `insights` ou
`goals` (pluriel). Lire la liste des types dans le message d'erreur :
elle dit lequel des deux schémas a répondu.

`GET /api/websites/{id}/reports` liste les rapports enregistrés d'un site.
`GET /api/reports` sans `websiteId` rend `400`.

## Ce qui n'a pas pu être vérifié

- Aucune donnée de **revenu**, de **web vitals** ni d'**enregistrement de
  session** n'existait sur l'instance : les schémas de requête de `revenue`,
  `performance` et `heatmap` sont vérifiés (`200`), la **forme peuplée** de
  leurs réponses ne l'est pas.
- Les **segments** et **cohortes** (`segment=`, `cohort=`, UUID attendu) sont
  attestés comme paramètres mais aucun n'existait à créer et à interroger.
- Rien n'a été testé contre **Umami Cloud** ; la doc y décrit une autre base
  d'URL et une clé d'API que l'auto-hébergé refuse.
