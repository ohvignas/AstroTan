---
name: umami-segments
description: Use when defining or reading an Umami segment — the saved filter sets under Audience → Segments, or the segment=<uuid> parameter on /api/websites/{id}/*. Also use when a segment returns exactly the same numbers as the whole site, when segment= answers 500 with an empty body, when a filter on utm_source seems to do nothing, when a segment built on an event name returns zero visitors, or when /values ignores the segment that /stats honours.
---

# Les segments d'Umami 3 (Audience → Segments)

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable peuplé pour l'occasion (24 visiteurs, 4 pays, 5 navigateurs).
**La fonctionnalité existe en auto-hébergé** — rien ici n'est réservé à
Umami Cloud.

La mécanique HTTP commune (jeton, fenêtres en millisecondes, formes de
réponse, pièges de `/metrics`) est dans
[`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md) ; les rapports
dans [`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md). Ce
skill-ci ne traite que du segment.

Un **segment** est un jeu de filtres nommé et enregistré, sur les colonnes
standard d'une visite (navigateur, pays, chemin, UTM…). On le rejoue ensuite
sur n'importe quelle lecture en passant `segment=<uuid>` — c'est
exactement l'équivalent d'écrire ces filtres à la main dans l'URL, en une
seule référence.

## Ce qu'il faut avoir en base

Rien de particulier : un segment ne consomme que du trafic déjà collecté.
Mais il ne **montre** quelque chose que si les valeurs varient. Sur un site
mono-navigateur, un segment `browser = chrome` rend le total du site — et
c'est indiscernable d'un segment ignoré (§ Pièges). Pour l'éprouver, il faut
des visites aux propriétés différentes ; les fabriquer se fait par
`POST /api/send` en variant l'en-tête `User-Agent` (navigateur, appareil) et
`X-Forwarded-For` (pays — **vérifié : la géolocalisation suit bien cet
en-tête**), voir [`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md).

## CRUD — un seul point d'entrée, partagé avec les cohortes

`/api/segments` et `/api/segments/{id}` **n'existent pas** : ils rendent la
page 404 de Next.js, en `text/html`. Tout passe par le site.

```http
GET    /api/websites/{websiteId}/segments?type=segment   ← type OBLIGATOIRE
POST   /api/websites/{websiteId}/segments
GET    /api/websites/{websiteId}/segments/{segmentId}
POST   /api/websites/{websiteId}/segments/{segmentId}    ← mise à jour
DELETE /api/websites/{websiteId}/segments/{segmentId}
```

Sans `type`, la liste rend `400` :
`Invalid option: expected one of "segment"|"cohort"`. Les deux objets
partagent la table, l'URL et le schéma ; seul `type` les sépare
([`../umami-cohorts/SKILL.md`](../umami-cohorts/SKILL.md)).

Création — corps réel, réponse réelle :

```json
POST /api/websites/{websiteId}/segments
{"type":"segment","name":"Mobiles France",
 "parameters":{"match":"all",
   "filters":[{"name":"device","operator":"eq","value":"mobile"},
              {"name":"country","operator":"eq","value":"FR"}]}}
```
```json
{"id":"66377d92-556e-44a6-9356-e48a5053245d",
 "websiteId":"1a4e95f9-…","type":"segment","name":"Mobiles France",
 "parameters":{"match":"all","filters":[
   {"name":"device","value":"mobile","operator":"eq"},
   {"name":"country","value":"FR","operator":"eq"}]},
 "createdAt":"2026-08-28T21:02:05.371Z","updatedAt":"2026-08-28T21:02:05.371Z"}
```

La liste rend la forme paginée habituelle :
`{"data":[…],"count":1,"page":1,"pageSize":20}`.

**`parameters` a un schéma strict et jette silencieusement ce qu'il ne
connaît pas.** `{"foo":1}` est accepté et ressort `{}` — aucun avertissement.
Les seules clés retenues pour un segment sont `filters`, `match` et
`dateRange` (cette dernière n'ayant aucun effet, voir plus bas).

## Le vocabulaire des filtres — il n'y en a que 24

`filters` est un **tableau** d'objets `{name, operator, value}` ;
`value` doit être une **chaîne** (un nombre rend `400`).

Noms admis, relevés dans la table `FILTER_COLUMNS` du build 3.3.1 et
éprouvés un à un :

`path` `entry` `exit` `referrer` `domain` `hostname` `distinctId` `title`
`query` `os` `browser` `device` `country` `region` `city` `language`
`event` `tag` `eventType` `utmSource` `utmMedium` `utmCampaign`
`utmContent` `utmTerm`

Ce sont exactement les mêmes noms que les filtres passés en paramètres
d'URL — **`channel` et `screen` n'y sont pas**, ce qui explique qu'on puisse
ventiler par canal sans pouvoir filtrer dessus.

### Les UTM s'écrivent en camelCase, et l'orthographe intuitive est un piège

```
/stats?utmSource=newsletter   →  8 visiteurs      ← filtre appliqué
/stats?utm_source=newsletter  → 25 visiteurs      ← le site entier
```

Même dissociation dans un segment. `utm_source` n'est pas refusé : il n'est
pas dans `FILTER_COLUMNS`, donc il est jeté, et la réponse ressemble à un
segment trop large plutôt qu'à une faute de frappe. C'est le nom que le
rapport `utm` **affiche** dans ses clés de réponse (`utm_source`), ce qui
rend la confusion presque obligatoire —
[`../umami-utm/SKILL.md`](../umami-utm/SKILL.md).

### Six opérateurs sur seize fonctionnent

Le schéma de création en accepte seize :
`eq` `neq` `s` `ns` `c` `dnc` `re` `nre` `t` `f` `gt` `lt` `gte` `lte`
`bf` `af`.

Éprouvés sur une colonne standard, **six seulement produisent un résultat** :

| Marche | Sens |
|---|---|
| `eq` / `neq` | égal / différent |
| `c` / `dnc` | contient / ne contient pas |
| `re` / `nre` | expression régulière / sa négation |

Les dix autres (`s`, `ns`, `t`, `f`, `gt`, `lt`, `gte`, `lte`, `bf`, `af`)
**enregistrent le segment sans broncher, puis rendent `500` avec un corps
vide** à la première lecture. Le journal du conteneur montre alors
`syntax error at or near "group"` : le SQL est construit avec un trou. Ils
sont destinés aux propriétés d'événement et de session, pas aux colonnes.

Le défaut de `match` est `all` (ET). `any` bascule en OU — mesuré :
`browser=chrome` (14 v.) ET `country=FR` (11 v.) → 6 ; en `any` → 19.
Seules valeurs admises : `all`, `any`.

## Lire à travers un segment

```
GET /api/websites/{id}/stats?startAt=…&endAt=…&segment=<uuid>
```

| Point d'entrée | Honore `segment` |
|---|---|
| `/stats`, `/pageviews`, `/metrics`, `/sessions`, `/sessions/stats`, `/events`, `/event-data/stats` | oui |
| **`/values`** | **non — ignoré en silence** |
| `/api/realtime/{id}` | non |

Le cas de `/values` est le plus coûteux, parce que c'est justement le point
d'entrée conseillé pour des **vues** par page
([`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md) §1) : mesuré,
`/values?type=path` rend `[{"/tarifs":47},{"/":47},{"/commande":10}]` avec ou
sans segment, à l'octet près. Un tableau « vues par page du segment » est
donc en réalité celui du site entier, et rien ne le signale.

Les rapports l'acceptent aussi, mais **dans `filters`**, pas en paramètre
d'URL :

```json
POST /api/reports/utm
{"websiteId":"…","type":"utm","filters":{"segment":"<uuid>"},"parameters":{…}}
```

Un segment se combine avec les filtres de la requête : `segment=<chrome>`
plus `country=FR` donne l'intersection.

## Les pièges, dans l'ordre où ils coûtent cher

1. **Un nom de filtre inconnu est jeté, pas refusé.** `{"name":"zzz",…}` →
   segment enregistré, lecture à `200`, **et le total du site**. Le contrôle
   qui tranche : comparer `/stats?segment=<uuid>` à `/stats` sans rien. Si
   les deux nombres sont identiques, soupçonner l'orthographe avant de
   croire que « tout le monde est dans le segment ».
2. **Un UUID inconnu, ou celui d'un segment d'un autre site, rend `500` avec
   un corps vide.** Vérifié : les segments sont bien cloisonnés par site,
   mais le refus n'est pas un `404` — c'est une exception non attrapée.
   `Content-Length: 0`, donc un client qui fait `JSON.parse` sur la réponse
   échoue sur une erreur de parsing sans rapport. Un UUID malformé, lui,
   rend un franc `400 Invalid UUID`.
3. **Un segment filtrant sur `event` rend zéro.** `event` compare
   `event_name`, vide sur les lignes de vue de page ; `/stats?event=purchase`
   rend `0` partout sur un site qui compte pourtant dix achats. Pour « les
   gens qui ont fait X », c'est une **cohorte** qu'il faut
   ([`../umami-cohorts/SKILL.md`](../umami-cohorts/SKILL.md)), pas un segment.
4. **`parameters.dateRange` est accepté sur un segment et n'a aucun effet.**
   Mesuré : `dateRange: "1day"` sur un segment `browser=chrome` rend les 14
   visiteurs du mois entier. La clé n'est lue que pour les cohortes. Un
   segment n'a pas de fenêtre propre : c'est celle de la requête.
5. **Passer l'UUID d'une cohorte dans `segment=` rend `200` et un chiffre
   faux.** Le code applique alors les `filters` de la cohorte en ignorant son
   `action` et son `dateRange`. Mesuré : une cohorte « acheteurs FR sur 30
   jours » (4 visiteurs par `cohort=`) rend **10** par `segment=` — c'est-à-dire
   `country=FR` tout court. Aucun avertissement, et le nombre est plausible.

## Ce qui n'a pas été vérifié

- **Les permissions d'équipe** : tous les appels ont été faits avec le compte
  propriétaire. Ce qu'un membre en lecture seule peut créer ou lire n'a pas
  été éprouvé.
- **La création par l'interface** : le formulaire n'a pas été piloté au
  navigateur. Sa forme par défaut a été lue dans le bundle servi et
  correspond à celle décrite ici ; les valeurs proposées dans les listes
  déroulantes n'ont pas été énumérées.
- **Umami Cloud** : rien n'a été testé contre l'offre hébergée.
