---
name: umami-breakdown
description: Use when building or debugging the Umami Breakdown screen — the cross-tab of POST /api/reports/breakdown with its fields array. Also use when a breakdown by event returns a single row with event null, when an empty fields array answers 500 with no body, when a filter on utm_source or url silently returns the whole site, when views and totaltime concatenate instead of adding up, when the page is titled "Insights", or when per-page view counts are needed and /metrics gives visits.
---

# La vue Breakdown d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, en donnant à
chaque champ et à chaque filtre une valeur impossible pour savoir lequel agit.

Le contrat général des rapports (dates dans `parameters`, `type` répété,
`filters` obligatoire, messages zod) est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md). Ce skill-ci
ne traite que `breakdown`.

## Ce que fait l'écran

Breakdown croise une ou plusieurs dimensions et rend, pour chaque
combinaison, les cinq mêmes mesures que l'Overview. C'est le **seul endroit
de l'interface qui rende des vues par page** — `/metrics` compte des visites.

Détail qui déroute : l'onglet s'appelle Breakdown, la route est
`/websites/{id}/breakdown`, et l'onglet du navigateur affiche
**« Insights | Umami »**. Chercher « insights » dans la doc ou dans la liste
des types de rapport ne mène nulle part : `insights` n'est pas un type
(`goal` non plus au pluriel) — voir le skill des rapports.

## Comment on l'alimente

Rien de particulier : des vues de page ordinaires suffisent. Breakdown lit la
table des vues — et **elle seule**, ce qui explique la moitié des surprises
plus bas.

## L'appel

```http
POST /api/reports/breakdown
Authorization: Bearer <token>
Content-Type: application/json

{"websiteId":"<uuid>","type":"breakdown","filters":{},
 "parameters":{"startDate":"2026-08-28T18:49:00Z","endDate":"2026-08-28T20:50:00Z",
               "timezone":"UTC","unit":"hour","fields":["path","browser"]}}
```

L'écran ne passe que celui-là, avec les champs choisis dans le menu
« Fields ». Colonnes affichées : Visitors, Visits, Views, Bounce rate, Visit
duration — les deux dernières étant calculées côté client
(`bounces/visits`, `totaltime/visits`).

## La réponse

```json
[{"views":"2","visitors":1,"visits":1,"bounces":0,"totaltime":"600",
  "path":"/","browser":"chrome"},
 {"views":"1","visitors":1,"visits":1,"bounces":0,"totaltime":"0",
  "path":"/","browser":"firefox"}]
```

**`views` et `totaltime` sortent en chaînes**, `visitors`, `visits` et
`bounces` en nombres, dans le même objet. `"2" + "1"` vaut `"21"` : un total
absurde, aucune erreur. C'est le piège le plus mécanique de tout le rapport.

Les champs demandés reviennent comme **clés nommées** dans chaque ligne, pas
dans un tableau : ajouter un champ change la forme des objets.

## Les trois façons d'obtenir une réponse vide ou fausse en `200`

### 1. `fields: ["event"]` rend une ligne unique, `event: null`

```json
[{"views":"7","visitors":3,"visits":3,"bounces":0,"totaltime":"1500","event":null}]
```

`event` est un champ **accepté par le validateur** — il est dans l'énumération
que l'API rend en cas de faute — et il ne produit jamais rien : le rapport ne
lit que les vues, où la colonne d'événement est vide. Le résultat est le
**total du site** posé sous une étiquette « par événement ». Croisé avec autre
chose (`["event","path"]`), c'est pire : la ventilation par chemin a l'air
juste, la colonne `event` est `null` partout, et rien ne signale que la
dimension demandée a été perdue.

Corollaire : `filters: {"event":"cta-click"}` rend `[]`, même quand
l'événement s'est bien produit sur les pages listées. « Sur quelles pages cet
événement s'est-il produit » n'a pas de réponse ici — voir
[`../umami-events/SKILL.md`](../umami-events/SKILL.md).

### 2. `fields: []` rend **`500` avec un corps vide**

Pas `400`, pas `[]` : `HTTP 500`, `Content-Length: 0`. Un client qui fait
`JSON.parse` sur la réponse échoue sur une erreur de syntaxe sans rapport, et
un client qui teste seulement `res.ok` affiche un tableau vide. C'est le cas
qui arrive quand l'utilisateur décoche le dernier champ du menu « Fields ».

### 3. Un filtre inconnu est **accepté puis ignoré**

`filters: {"nimporte":"x"}` rend le total du site en `200`. Le rapport ne
valide pas les clés de `filters` — seulement celles de `fields`.

Méthode pour trancher, celle qui a produit le tableau ci-dessous : donner au
filtre une **valeur impossible**. Un filtre appliqué rend `[]` ; un filtre
ignoré rend le site entier.

| Filtres **appliqués** | Filtres **ignorés** |
|---|---|
| `path` `referrer` `title` `query` `os` `browser` `device` `country` `region` `city` `tag` `hostname` `distinctId` `language` `event` `entry` `exit` `utmSource` `utmMedium` `utmCampaign` `utmContent` `utmTerm` | `url` `screen` `channel` `utm_source` (et les autres `utm_*`) |

## Deux vocabulaires dans la même API

C'est l'écart le plus facile à commettre, parce que les deux formes existent
et qu'aucune ne lève d'erreur du mauvais côté :

|  | `/metrics` (query string) | `breakdown` (`fields` et `filters`) |
|---|---|---|
| UTM | `utmSource` en `type`, `utm_source` en **filtre ignoré** | `utmSource` **partout** ; `utm_source` ignoré |
| `entry` / `exit` | `type` valide, **filtre ignoré** | champ valide **et filtre appliqué** |
| chemin + requête | `type=fullPath` | **inexistant** (`400`) |
| `screen` / `channel` | `type` valides | **inexistants** dans `fields` |

`entry`/`exit` méritent d'être notés : `umami-read-api` les classe parmi les
filtres ignorés, ce qui est exact pour `/metrics` — et faux pour `breakdown`,
où ils filtrent réellement. Le même mot ne se comporte pas pareil selon
l'endpoint.

## Les champs admis, tels que l'API les énumère

Envoyer un champ inconnu est la façon la plus rapide de récupérer la liste à
jour :

```
"Invalid option: expected one of "path"|"referrer"|"title"|"query"|"os"|
 "browser"|"device"|"country"|"region"|"city"|"tag"|"hostname"|"distinctId"|
 "language"|"event"|"utmSource"|"utmMedium"|"utmCampaign"|"utmContent"|"utmTerm""
```

C'est **exactement** la même énumération que celle de
`GET /api/websites/{id}/values?type=…` — les deux endroits partagent le
vocabulaire camelCase, contre celui de `/metrics`.

## Ce que le rapport rend et que rien d'autre ne rend

`breakdown` est la bonne réponse à « des **vues** par page », là où
`/metrics?type=path` compte des visites et où `/values?type=path` compte
**tous les hits** — événements nommés et mesures de performance compris
([`../umami-performance/SKILL.md`](../umami-performance/SKILL.md)). Sur un jeu
mesuré, la page `/` sortait à :

```
/metrics?type=path  → 2   (visites)
breakdown ["path"]  → "3" (vues)
/values?type=path   → 5   (tous les hits, y compris performance)
```

Trois chiffres justes, trois questions différentes. Le seul qui réponde à
« combien de fois cette page a-t-elle été affichée » est celui du milieu.

## Représentations du vide, qui ne sont pas les mêmes

Dans une même réponse :

```json
[{"query":"", …},        ← chaîne vide pour une URL sans paramètres
 {"utmSource":null, …}]  ← null pour l'absence d'UTM
```

Grouper « pas de valeur » demande donc de traiter `""` **et** `null` selon la
dimension. `country` est `null` en l'absence de géolocalisation.

## Ce qui n'a pas été vérifié

- **Aucune pagination ni `limit`** n'a été trouvée sur `breakdown` : le
  rapport a toujours rendu toutes les combinaisons. Sur un site à forte
  cardinalité (`fullPath` n'existe pas ici, mais `path` × `city` peut
  exploser), le comportement au-delà de quelques dizaines de lignes n'est pas
  attesté.
- **Aucun tri** n'est documenté ni n'a été observé comme paramétrable ; les
  lignes sont arrivées triées par `views` décroissantes, ce qui n'est pas
  garanti.
- `distinctId`, `tag`, `region`, `city`, `channel` sont des champs valides
  mais **aucune donnée** de ce type n'existait : leur forme peuplée n'est pas
  attestée.
- Le rapport n'a **aucun mécanisme de comparaison** de périodes ; comparer
  deux fenêtres demande deux requêtes
  ([`../umami-compare/SKILL.md`](../umami-compare/SKILL.md)).
- Rien n'a été essayé contre **Umami Cloud**.
