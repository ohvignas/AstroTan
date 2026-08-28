---
name: umami-overview
description: Use when reading or rebuilding the Umami Overview screen — the five head figures (Visitors, Visits, Views, Bounce rate, Visit duration), the traffic chart, the Pages/Sources/Environment/Location tables and the weekly heat grid. Also use when a bounce rate or a visit duration must be computed from the API, when the "Last 24 hours" window returns 25 buckets, when the chart shows a percentage change nobody asked for, when the URL tab of the Pages panel needs its metric type, or when a period selector must be bounded by the site's real history.
---

# La vue Overview d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable dont chaque hit a été fabriqué par `POST /api/send`.

La mécanique HTTP (jeton, fenêtres en millisecondes, formes de réponse
communes, filtres ignorés en silence) est dans
[`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md). Ce skill-ci ne
traite que ce que l'écran Overview fait de ces appels.

## Ce que fait l'écran

Overview agrège une période en cinq nombres, une courbe et quatre panneaux de
classements. C'est la seule vue qui ne demande rien à `/api/reports` : elle
n'est qu'une composition de `/stats`, `/pageviews` et de plusieurs
`/metrics`.

## Comment on l'alimente

Rien à déclarer : un `POST /api/send` de type `event` suffit, et les chemins
apparaissent dès le premier hit. Ni les mesures `performance` ni les
`identify` ne pèsent sur les cinq nombres de tête — voir
[`../umami-performance/SKILL.md`](../umami-performance/SKILL.md).

## Les huit appels que l'écran passe réellement

Relevés dans l'onglet réseau du tableau de bord (période « Last 24 hours ») :

```
GET /api/websites/{id}/daterange
GET /api/websites/{id}/active
GET /api/websites/{id}/stats?startAt=&endAt=
GET /api/websites/{id}/pageviews?startAt=&endAt=&unit=hour&timezone=Europe/Paris
GET /api/websites/{id}/sessions/weekly?startAt=&endAt=&timezone=Europe/Paris
GET /api/websites/{id}/metrics?startAt=&endAt=&type=path&limit=10
GET /api/websites/{id}/metrics?…&type=referrer&limit=10
GET /api/websites/{id}/metrics?…&type=browser&limit=10
GET /api/websites/{id}/metrics?…&type=country&limit=10
```

Les onglets des panneaux ne changent que `type` : `path` `fullPath` `entry`
`exit` / `referrer` `channel` / `browser` `os` `device` / `country` `region`
`city`.

## Les cinq nombres de tête ne sont pas cinq champs

`/stats` en rend **cinq bruts**, dont deux ne sont pas ce qui est affiché :

```json
{"pageviews":18,"visitors":13,"visits":14,"bounces":11,"totaltime":1500,
 "comparison":{"pageviews":2,"visitors":2,"visits":2,"bounces":2,"totaltime":0}}
```

| Affiché | Calculé côté client |
|---|---|
| Views | `pageviews` |
| Visitors | `visitors` |
| Visits | `visits` |
| **Bounce rate** | `bounces / visits` → 11/14 = 79 % |
| **Visit duration** | `totaltime / visits` → 1500/14 = 107 s = « 1m 47s » |

`bounces` est un **nombre de visites à une seule vue**, pas un taux ;
`totaltime` est une **somme de secondes**, pas une moyenne. Les afficher tels
quels donne deux chiffres crédibles et faux. Vérifié en recoupant l'écran et
l'API sur la même fenêtre.

Le petit pourcentage sous chaque nombre est l'écart relatif à `comparison` :
`(courant − comparison) / comparison`. Mesuré : 14 visiteurs contre 2 →
« 600% ». `comparison` est **rempli sans le drapeau `compare`**
([`../umami-compare/SKILL.md`](../umami-compare/SKILL.md)).

## « Last 24 hours » dure 25 heures

La période par défaut envoie `startAt=1787860800000&endAt=1787950799999`,
soit `22:00:00.000` la veille → `22:59:59.999` aujourd'hui : **25 seaux
horaires**, pas 24. Umami arrondit au début de l'heure d'il y a 24 h et va
jusqu'à la fin de l'heure courante.

Conséquence pour qui reproduit l'écran : une fenêtre calculée en
`now - 24h → now` ne donne **pas** les mêmes chiffres que l'écran, et l'écart
n'est ni une erreur d'arrondi ni un bug — c'est une heure entière de trafic.

## `/daterange` borne le sélecteur de période

```
GET /api/websites/{id}/daterange
→ {"startDate":"2026-08-23T20:49:00.000Z","endDate":"2026-08-28T21:00:12.108Z"}
```

Premier et dernier hit du site, en **ISO**, sans fenêtre à passer. C'est ce
qui empêche le sélecteur de proposer des mois vides. Noter l'incohérence de
convention : cet endpoint rend de l'ISO, alors que tous les autres de la vue
prennent des millisecondes.

## `/sessions/weekly` : une matrice 7 × 24, `timezone` obligatoire

```
GET /api/websites/{id}/sessions/weekly?startAt=&endAt=&timezone=UTC
→ [[…24 nombres…], … 7 lignes …]
```

- **Ligne = jour de la semaine, `0` = dimanche.** Mesuré : une session le
  dimanche tombe en ligne 0, jeudi en ligne 4, vendredi en ligne 5.
- Colonne = heure locale `0..23` **dans le fuseau demandé**. Mesuré : la même
  session sort en colonne 20 en UTC et en colonne 22 en `Europe/Paris`.
- Une session est comptée à son **premier hit** (`firstAt`), une seule fois.
- **`timezone` est obligatoire** : sans lui, `400 "expected string, received
  undefined"`. C'est le seul paramètre de la vue à l'exiger — `unit` et
  `timezone` sont facultatifs sur `/pageviews`.

## Les pièges de la vue, tous silencieux

1. **Les tableaux « Pages » comptent des visites, pas des vues.** `/metrics`
   rend une ligne par session ayant touché le chemin. C'est le piège central
   de [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md), et il est
   directement visible ici : le total de la colonne ne se raccorde jamais au
   « Views » de tête. Pour des vues, passer par le rapport `breakdown`
   ([`../umami-breakdown/SKILL.md`](../umami-breakdown/SKILL.md)).

2. **L'onglet « URL » est `type=fullPath`**, un type **absent de la
   documentation** et de l'inventaire de `umami-read-api`. Il rend le chemin
   *avec* la chaîne de requête :

   ```
   type=path     → [{"x":"/blog","y":2}]
   type=fullPath → [{"x":"/blog?utm_source=newsletter&…","y":1},{"x":"/blog","y":1}]
   ```

   `fullPath` marche sur `/metrics` **et nulle part ailleurs** : `/values?type=fullPath`
   rend `400`, et `fullPath=` employé comme **filtre est accepté puis ignoré**
   (mesuré : rend le total du site).

3. **La courbe est creuse.** `/pageviews` omet les intervalles vides au lieu
   de les mettre à zéro, et `pageviews[]` / `sessions[]` sont deux tableaux
   construits séparément : joindre sur `x`, jamais par indice.

4. **`comparison` peut être à zéro sans que rien ne soit cassé** — c'est
   simplement une période précédente vide. Ne jamais en déduire qu'un
   paramètre manque.

5. **Une fenêtre qui se termine avant les données rend un site vivant
   entièrement à zéro, en `200`.** Devant des zéros, vérifier la fenêtre avant
   l'ingestion.

## Ce qui n'a pas été vérifié

- **Aucune donnée géographique** n'existait sur l'instance (`country`,
  `region`, `city` tous `null`, le panneau Location affiche « No data
  available »). La forme peuplée de `/metrics?type=country|region|city` n'est
  donc **pas** attestée ; seule la forme vide l'est. Umami dérive ces champs
  d'une base GeoIP à partir de l'adresse IP : depuis `127.0.0.1`, il n'y a
  rien à déduire.
- `type=channel` et `type=tag` répondent, mais aucun trafic ne portait de
  canal identifiable ni de `tag` : leurs valeurs réelles ne sont pas
  attestées.
- Rien n'a été essayé contre **Umami Cloud**.
