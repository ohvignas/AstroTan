---
name: umami-performance
description: Use when reading, feeding or debugging the Umami Performance screen — Web Vitals (LCP, INP, CLS, FCP, TTFB) and POST /api/reports/performance. Also use when the Performance page shows zeros on a site with plenty of traffic, when data-performance seems to change nothing, when the report's count is larger than the number of measurements, when the chart needs a metric other than LCP, when a per-page hit count grows without any new page view, or when Web Vitals must be produced without a browser.
---

# La vue Performance d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**. Contrairement à
ce que suppose [`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md)
(« aucune donnée de web vitals n'existait »), **on peut fabriquer des Web
Vitals sans navigateur** : la charge utile est décrite plus bas et la forme
peuplée de la réponse a été mesurée.

Mécanique HTTP commune : [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md).
Contrat des rapports : [`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Ce que fait l'écran

Performance rend les cinq Core Web Vitals en percentiles (p50/p75/p95) sur la
période, plus la même métrique ventilée par page, titre, appareil et
navigateur. C'est un rapport, pas une lecture directe : l'écran ne passe
**qu'un seul appel**, `POST /api/reports/performance`.

## Comment on l'alimente — et pourquoi l'écran est vide par défaut

**Ce n'est pas le défaut.** Le script de comptage ne mesure rien tant que la
balise ne porte pas `data-performance="true"` :

```html
<script defer src="https://umami.example/script.js"
        data-website-id="…" data-performance="true"></script>
```

Dans ce dépôt, la variable est `PUBLIC_UMAMI_PERFORMANCE`, figée **au build**
comme les autres `PUBLIC_UMAMI_*`
([`../analytics-umami/SKILL.md`](../analytics-umami/SKILL.md)).

Quand le drapeau est posé, `script.js` observe `layout-shift`,
`first-contentful-paint`, `largest-contentful-paint`, `navigation` et les
`event` de plus de 40 ms, puis poste **un seul hit par page** à
`visibilitychange`/`pagehide` ou au bout de 10 secondes.

### La charge utile, reproductible en `curl`

Le type `performance` est un troisième type de `/api/send`, à côté de `event`
et `identify` (l'énumération de l'API le dit :
`"event"|"identify"|"performance"`) :

```bash
curl -X POST "$UMAMI/api/send" -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 … Chrome/140 …' \
  -d '{"type":"performance","payload":{
       "website":"'"$ID"'","hostname":"localhost","url":"/blog","title":"Blog",
       "lcp":1500,"fcp":750,"cls":0.03,"inp":150,"ttfb":300,
       "duration":9500,"timestamp":1787946540}}'
```

Tous les champs de métrique sont **facultatifs** — un `performance` sans
aucune mesure répond `200` et crée quand même une ligne. `timestamp` est
honoré, en secondes : on peut antidater pour peupler un historique.

## L'appel de lecture

```http
POST /api/reports/performance
Authorization: Bearer <token>
Content-Type: application/json

{"websiteId":"<uuid>","type":"performance","filters":{},
 "parameters":{"startDate":"2026-08-21T20:49:00Z","endDate":"2026-08-28T20:50:00Z",
               "timezone":"UTC","unit":"day","metric":"lcp"}}
```

`filters` est **obligatoire** (`{}` accepté) et les dates vivent **dans
`parameters`, en ISO** — voir le contrat des rapports.

### La réponse, peuplée

```json
{"chart":[{"t":"2026-08-28T00:00:00Z","p50":1367.25,"p75":2250,"p95":3625}],
 "summary":{"lcp":{"p50":1367.25,"p75":2250,"p95":3625},
            "inp":{"p50":135,"p75":225,"p95":362.5},
            "cls":{"p50":0.035,"p75":0.0475,"p95":0.05},
            "fcp":{"p50":775.1,"p75":1137.55,"p95":1812.5},
            "ttfb":{"p50":255.35,"p75":450,"p95":725},
            "count":7},
 "pages":[{"name":"/blog","p50":1500,"p75":2500,"p95":3700,"count":5},
          {"name":"/","p50":1234.5,"p75":1234.5,"p95":1234.5,"count":2}],
 "pageTitles":[{"name":null,"p50":null,"p75":null,"p95":null,"count":1}, …],
 "devices":[{"name":"laptop", …}],
 "browsers":[{"name":"chrome", …}]}
```

Et vide, sur un site sans mesure :

```json
{"chart":[],"summary":{"lcp":{"p50":0,"p75":0,"p95":0}, … ,"count":0},
 "pages":[],"pageTitles":[],"devices":[],"browsers":[]}
```

**Un `count: 0` avec des percentiles à `0` est la réponse normale d'un site
non instrumenté**, pas une panne. Rien dans le corps ne distingue « personne
n'a mesuré » de « tout est instantané ».

## `metric` : le paramètre non documenté qui commande quatre sections sur cinq

`summary` contient **toujours les cinq métriques**. `chart`, `pages`,
`pageTitles`, `devices` et `browsers` n'en portent **qu'une**, choisie par
`parameters.metric`, dont le **défaut est `lcp`**.

```
sans metric      → pages: [{"name":"/blog","p50":1500,…}]   (LCP)
metric: "fcp"    → pages: [{"name":"/blog","p50":750, …}]   (FCP)
metric: "zzz"    → 400 'expected one of "lcp"|"inp"|"cls"|"fcp"|"ttfb"'
```

Les colonnes s'appellent `p50`/`p75`/`p95` dans les deux cas : **rien dans la
réponse ne dit de quelle métrique il s'agit.** Un tableau étiqueté « LCP par
page » qui a reçu `metric:"cls"` affiche des dixièmes sous une unité de
millisecondes, sans une erreur.

## `count` n'est pas le nombre de mesures

Mesuré : 7 lignes `performance` dont **une sans aucune métrique** →
`summary.count = 7`, mais les percentiles sont calculés sur 6 valeurs. Et
`pageTitles` porte une ligne `{"name":null,"p50":null,…,"count":1}` : la
mesure sans titre existe, se compte, et ne contribue à rien.

Diviser, pondérer ou afficher « n mesures » à partir de `count` sur-estime
d'autant de hits vides que le script en a produit — et le script en produit
dès qu'une page est quittée avant que les observateurs aient relevé quoi que
ce soit.

Les percentiles sont **interpolés** : p50 de six valeurs rend la moyenne des
deux médianes (`1367.25` pour `[…1234.5, 1500…]`), pas une valeur observée.

## Ce qu'une mesure de performance change ailleurs, sans le dire

Un hit `performance` n'est ni une vue ni un événement, mais il n'est pas
invisible pour autant. Mesuré, un site neuf, trois hits sur `/demo` — une
vue, un événement nommé, une mesure :

```
/stats?path=/demo   → {"pageviews":1,…}                     inchangé
/metrics?type=path  → [{"x":"/demo","y":1}]                 inchangé
/values?type=path   → [{"value":"/demo","count":3}]         ⚠️ +1
/events (liste)     → 2 lignes                              la mesure n'y est pas
/api/websites/{id}/active → +1 visiteur en ligne            ⚠️
```

Deux conséquences à retenir :

1. **`/values` compte les mesures de performance** comme des hits ordinaires.
   `umami-read-api` §1 présente `count` comme un nombre de vues : c'est vrai
   sur un site non instrumenté, faux dès que `data-performance` est posé.
2. **Un ping `performance` crée une session**, donc il fait monter le
   compteur « Online » et `/active`, alors qu'il n'apparaît ni dans le fil
   temps réel ni dans aucune liste
   ([`../umami-realtime/SKILL.md`](../umami-realtime/SKILL.md)).

## Les filtres marchent

`filters` accepte le vocabulaire **camelCase** des rapports (`path`,
`browser`, `utmSource`…). Mesuré : `{"path":"/blog"}` réduit bien `count` de
7 à 5 et recalcule les percentiles. Voir la liste complète et les pièges de
vocabulaire dans
[`../umami-breakdown/SKILL.md`](../umami-breakdown/SKILL.md).

## Ce qui n'a pas été vérifié

- **Aucune mesure produite par un vrai navigateur.** Toutes les valeurs de ce
  skill ont été postées en `curl`. La forme de la charge utile a été lue dans
  `script.js` de la 3.3.1 (`q({...C(), ...e}, "performance")`), pas capturée
  dans un onglet réseau : l'accord entre les deux est très probable, il n'est
  pas mesuré.
- **Le champ `duration`** est accepté et n'apparaît dans aucune réponse
  observée ; ce qu'Umami en fait est inconnu.
- **`unit`** a été essayé en `day` seulement ; le comportement de `chart`
  aux autres granularités n'est pas attesté.
- Rien n'a été essayé contre **Umami Cloud**.
