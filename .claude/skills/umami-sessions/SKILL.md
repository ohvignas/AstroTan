---
name: umami-sessions
description: Use when reading or debugging the Umami Sessions screen — the session list, session properties set by identify(), or one session's detail and activity. Also use when a session's view count differs between the list and its detail page, when views and events arrive as strings in one response and numbers in another, when count says 1 while data holds twenty rows, when /sessions/{id}/activity answers "expected number, received NaN", when session-data/values totals look far too large, or when a session detail ignores the selected period.
---

# La vue Sessions d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable dont chaque hit a été fabriqué par `POST /api/send`.

Mécanique HTTP commune : [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md).

## Ce que fait l'écran

Sessions montre une ligne par visiteur reconnu sur la période, avec son
matériel, ses compteurs, et ce qu'il a fait minute par minute. L'onglet
Properties agrège les propriétés attachées aux sessions plutôt qu'aux
événements.

## Ce qu'est une session, concrètement

Umami ne pose pas de cookie. L'identifiant de session est un **hachage
déterministe** de (`websiteId`, `hostname`, IP, User-Agent) : la réponse de
`/api/send` le rend, et il est **stable dans le temps**.

```json
{"cache":"eyJ…","sessionId":"2bf0215a-…","visitId":"9b88277f-…"}
```

Conséquences mesurées, et elles surprennent :

- **Deux hits séparés de 30 heures, même User-Agent, tombent dans la même
  session** — mais dans deux `visitId` différents. D'où `visits: 2` sur une
  session unique. « Session » = personne, « visit » = passage.
- Pour fabriquer des sessions distinctes en test, **changer le User-Agent**
  suffit ; changer l'URL ou le titre ne change rien.
- `identify` attache des propriétés à la session :

```bash
curl -X POST "$UMAMI/api/send" -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 … Chrome/140 …' \
  -d '{"type":"identify","payload":{"website":"'"$ID"'","hostname":"localhost",
       "url":"/","data":{"plan":"pro","userId":"u-42","vip":true}}}'
```

  `data` est facultatif : un `identify` sans `data` répond `200` et n'écrit
  aucune propriété.

## Les quatre appels de l'écran

```
GET /api/websites/{id}/sessions?startAt=&endAt=&maxResults=10000     ← onglet Activity
GET /api/websites/{id}/session-data/properties?startAt=&endAt=        ← onglet Properties
GET /api/websites/{id}/sessions/{sessionId}                           ← détail (aucune fenêtre)
GET /api/websites/{id}/sessions/{sessionId}/activity?startAt=&endAt=  ← chronologie
```

## Le piège central : la liste et le détail ne comptent pas la même chose

C'est le point le plus coûteux de cet écran, et il ne lève rien.

**La liste est bornée par la période. Le détail ne l'est pas.**

```
GET /sessions?startAt=…&endAt=…   (fenêtre de 2 h)
→ {"id":"2bf0215a-…","visits":1,"views":4,"events":1,…}

GET /sessions/2bf0215a-…          (aucune fenêtre à passer)
→ {"id":"2bf0215a-…","visits":2,"views":"5","events":"1","totaltime":"1260",
   "distinctId":null,"canDelete":true,"stitchedSessionCount":1}
```

Même session, même instant : `views` vaut **4** dans la liste et **5** dans le
détail, parce que le détail agrège toute la vie de la session — ici un hit
vieux de 30 heures, hors fenêtre. Cliquer une ligne fait donc changer les
chiffres sous les yeux, et l'écart passe pour un bug de rafraîchissement.

**Et les types ne sont pas les mêmes non plus** : dans la liste, `views` et
`events` sont des **nombres** ; dans le détail, ce sont des **chaînes**
(`"5"`, `"1"`, `"1260"`), tandis que `visits` reste un nombre dans les deux.
`"5" + "6"` vaut `"56"` : un total de vues absurde, aucune erreur.

Le détail ne prend **aucun** paramètre de fenêtre — il n'y a pas de moyen de
le restreindre à la période affichée.

## `maxResults` plafonne `count`, pas les lignes

```
GET /sessions?startAt=&endAt=&maxResults=1
→ {"count":1,"page":1,"pageSize":20,"isCapped":true}   … et data contient 3 lignes
```

Lire `count` comme « nombre de sessions » donne 1 pour 3 sessions réelles.
`isCapped` est le seul témoin, et le tableau de bord passe `maxResults=10000`
sur tous ses appels. Sans `maxResults`, `count` est juste et `isCapped` vaut
`false`.

La liste accepte aussi `page`, `pageSize` et `search`. **`search` fonctionne
vraiment** (mesuré : `search=firefox` → 1 ligne, `search=ZZZ` → 0) — ce qui
n'est pas le cas de `query=` sur `/api/websites`.

Forme d'une ligne : `id` `hostname` `browser` `os` `device` `screen`
`language` `country` `region` `city` `firstAt` `lastAt` `visits` `views`
`events` `createdAt`. Noter que `createdAt` vaut le **dernier** hit de la
fenêtre, pas le premier — c'est `firstAt` qui ouvre la session.

**La somme des `views` de la liste égale le `pageviews` de `/stats`** sur la
même fenêtre : c'est le recoupement le plus sûr pour vérifier un total.

## `/sessions/{id}/activity` exige une fenêtre, et le dit mal

```
GET /sessions/{sid}/activity            → 400 "expected number, received NaN"
GET /sessions/{sid}/activity?startAt=&endAt=  → 200
```

« expected number, received NaN » n'est pas un problème de format : le
paramètre est **absent**, et le validateur décrit le `Number(undefined)` qu'il
a fabriqué. Ajouter `startAt` et `endAt`, ne pas chercher un souci de
sérialisation.

La réponse est un tableau anti-chronologique :

```json
[{"createdAt":"2026-08-28T19:40:00.000Z","urlPath":"/contact","urlQuery":"",
  "referrerDomain":null,"eventId":"31b2c489-…","eventType":2,
  "eventName":"cta-click","visitId":"4a9704bb-…","hostname":"localhost",
  "hasData":true}]
```

`visitId` y est visible : c'est ce qui permet de découper une session en
passages. Les mesures `performance` n'apparaissent **pas** dans l'activité.

## Les propriétés de session : `total` ne veut pas dire la même chose selon l'endpoint

```
GET /session-data/properties?startAt=&endAt=
→ [{"propertyName":"plan","dataType":1,"total":2}, …]        ← 2 SESSIONS

GET /session-data/values?startAt=&endAt=&propertyName=plan
→ [{"value":"pro","total":6},{"value":"free","total":3}]     ← 9 HITS
```

Vérifié en fabriquant les deux côtés : deux sessions portent `plan`, l'une
`pro` (5 vues + 1 événement = 6 hits), l'autre `free` (2 vues + 1 événement =
3 hits). Le même champ `total`, dans deux endpoints de la même famille,
compte des sessions dans l'un et des hits dans l'autre.

Lu comme un nombre de sessions, `values` gonfle d'un facteur égal à
l'activité moyenne — silencieusement, et d'autant plus que les visiteurs sont
engagés. C'est exactement le sens qu'on prête spontanément à une répartition
« combien de personnes sont sur le plan pro ».

Le détail d'une session rend les lignes brutes, avec les colonnes typées :

```json
[{"dataKey":"vip","dataType":3,"stringValue":"true",
  "numberValue":null,"dateValue":null,"createdAt":"…"}]
```

Un booléen vit dans `stringValue`. `dataType` : `1` chaîne, `2` nombre,
`3` booléen.

## Ce qui n'a pas été vérifié

- **`distinctId` est resté `null`** : le champ existe dans le détail et
  `/values?type=distinctId` répond `[]`, mais aucun trafic ne portait
  d'identifiant persistant. Le mécanisme qui le remplit n'est pas attesté.
- **`stitchedSessionCount: 1`** n'a jamais valu autre chose ; le recollage de
  sessions n'a pas pu être déclenché.
- **`canDelete: true`** n'a pas été exercé : aucune session n'a été supprimée.
- Aucune donnée **géographique** (`country`, `region`, `city` tous `null`
  depuis `127.0.0.1`) : la forme peuplée de ces champs n'est pas attestée.
- Les **replays** de session (`recorder.js`) n'étaient pas activés ; le lien
  entre une session et son enregistrement n'a pas été observé.
- Rien n'a été essayé contre **Umami Cloud**.
