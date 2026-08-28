---
name: umami-compare
description: Use when building or debugging the Umami Compare screen — one period against another, the comparison object of /stats, or the compare=prev / compare=yoy flag. Also use when compare seems to do nothing on /stats but changes the whole shape of /pageviews, when a comparison series is plotted a day off, when /metrics refuses to return a previous period, when a change reads as an infinite or nonsensical percentage, or when the previous window has to be computed by hand.
---

# La vue Compare d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, avec deux
fenêtres adjacentes toutes deux non vides — la seule façon de trancher ce que
le drapeau `compare` fait vraiment.

Mécanique HTTP commune : [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md).

## Ce que fait l'écran

Compare met une période en regard d'une autre : les cinq nombres de tête, la
courbe, et le classement des pages, pour chacune des deux fenêtres. Il
n'existe **aucun endpoint « compare »** — l'écran compose trois endpoints
ordinaires, dont l'un seulement sait faire la comparaison lui-même.

## Les quatre appels de l'écran

Relevés dans l'onglet réseau, période « Last 24 hours » :

```
GET /stats?compare=prev&startAt=1787860800000&endAt=1787950799999
GET /pageviews?compare=prev&startAt=…&endAt=…&unit=hour&timezone=Europe/Paris
GET /metrics?startAt=1787860800000&endAt=1787950799999&type=path&limit=20   ← période courante
GET /metrics?startAt=1787770860000&endAt=1787860859999&type=path&limit=20   ← période précédente
```

**Deux appels `/metrics`, aux fenêtres calculées côté client** : `/metrics`
ignore `compare` (mesuré : la réponse est identique avec et sans le drapeau,
et ne porte aucun bloc de comparaison). Tout classement comparé doit donc
être demandé deux fois.

## `compare` n'a pas le même statut selon l'endpoint

C'est le point qui fait perdre le plus de temps, parce que la première
observation — « le drapeau ne sert à rien » — est vraie sur un endpoint et
fausse sur l'autre.

| Endpoint | Sans `compare` | Avec `compare=prev` |
|---|---|---|
| `/stats` | `comparison` **déjà rempli** | identique — le drapeau est un **no-op** |
| `/events/stats` | `comparison` **déjà rempli** | identique — no-op |
| `/pageviews` | `{pageviews,sessions}` | **forme différente** : ajoute `compare`, `startDate`, `endDate` |
| `/metrics` | — | **ignoré**, aucun bloc de comparaison |
| `/sessions/stats` | aucune comparaison | **ignoré** |

`prev` est le défaut partout où la comparaison existe. Ce que `compare`
change réellement, c'est le passage à `yoy` — et, sur `/pageviews`, le fait
même de renvoyer la série précédente.

Seules valeurs admises : `prev` et `yoy`. Toute autre, **y compris la chaîne
vide**, rend `400 'expected one of "prev"|"yoy"'`.

## `/pageviews?compare=` : la seule réponse qui change de forme

```json
{"pageviews":[{"x":"2026-08-28T00:00:00Z","y":7}],
 "sessions": [{"x":"2026-08-28T00:00:00Z","y":3}],
 "startDate":"2026-08-27T20:49:00.000Z",
 "endDate":  "2026-08-28T20:49:00.000Z",
 "compare":{
   "pageviews":[{"x":"2026-08-27T00:00:00Z","y":2}],
   "sessions": [{"x":"2026-08-27T00:00:00Z","y":2}],
   "startDate":"2026-08-26T20:49:00.000Z",
   "endDate":  "2026-08-27T20:49:00.000Z"}}
```

Trois choses à en retirer :

1. **Les `startDate`/`endDate` n'apparaissent qu'avec le drapeau.** C'est la
   seule source fiable des bornes réellement employées par le serveur — et
   elles ne sont pas rondes : `20:49`, l'heure de la requête.
2. **Les `x` de `compare` portent les dates de la période précédente.**
   Superposer les deux courbes en l'état place la seconde un jour (ou un an)
   plus tôt sur l'axe : il faut ré-indexer par **position dans la fenêtre**,
   jamais par date.
3. Les filtres sont honorés des deux côtés — mesuré avec `path=/blog` : 2
   vues dans la fenêtre courante, 1 dans la précédente.

`compare=yoy` décale d'un an exactement (`2025-08-27 → 2025-08-28`) et rend
des tableaux vides si l'année précédente n'existe pas — ce qui **ressemble à
une panne** et n'en est pas une.

## Le confondant qui a déjà produit une affirmation fausse dans ce dépôt

`analytics-umami` a longtemps affirmé que `compare=prev` était obligatoire,
sur la foi d'observations réelles où `comparison` valait zéro sans le
drapeau. La cause n'était pas le drapeau : **la période précédente était
vide**.

La mesure qui tranche demande la **même fenêtre** dans les deux appels, avec
du trafic des deux côtés :

```
fenêtre 24 h : 7 vues courantes, 2 vues dans les 24 h précédentes
sans compare  → comparison:{"pageviews":2,…}
compare=prev  → comparison:{"pageviews":2,…}   identique
compare=yoy   → comparison:{"pageviews":0,…}
```

Devant un `comparison` à zéro, la première chose à vérifier est qu'il y avait
quelque chose à comparer — pas la présence du paramètre.

## Calculer la période précédente soi-même

Le serveur le fait pour `/stats` et `/pageviews`. Pour `/metrics`, il faut la
poser. La fenêtre que **le tableau de bord** calcule n'est pas exactement
adjacente :

```
courante  : 1787860800000 → 1787950799999   (27/08 22:00:00.000 → 28/08 22:59:59.999 Paris)
précédente: 1787770860000 → 1787860859999   (26/08 21:01:00.000 → 27/08 22:00:59.999 Paris)
```

Les deux durent exactement la même chose (89 999 999 ms, soit ~25 h — voir
[`../umami-overview/SKILL.md`](../umami-overview/SKILL.md) sur les 25 seaux de
« Last 24 hours »), mais la fenêtre précédente **finit 60 secondes après le
début de la courante** : les deux se recouvrent d'une minute, et elle démarre
à `21:01`, pas à `21:00`.

Une minute sur 25 heures ne change rien à une tendance ; elle change les
chiffres, donc elle empêche de reproduire l'écran au hit près. Reproduire
exactement, c'est copier ce décalage ; calculer proprement, c'est prendre
`[start − durée, start − 1]` et assumer que l'écran dira autre chose.

## Les pourcentages affichés

Le petit écart sous chaque nombre est relatif :
`(courant − comparison) / comparison`. Mesuré : 14 visiteurs contre 2 →
« 600% ».

Deux cas à traiter avant d'afficher, parce que l'API ne les traite pas :

- **`comparison` à zéro** → division par zéro. Un site qui démarre affiche
  alors « ∞ % » ou « NaN% » sur toute sa première période.
- **Bounce rate et Visit duration ne sont pas dans la réponse** : ce sont
  `bounces/visits` et `totaltime/visits`, à recalculer **des deux côtés**
  avant de comparer. Comparer directement les `bounces` bruts compare des
  effectifs, pas des taux — et ils bougent avec le trafic.

## Ce qui n'a pas été vérifié

- **`compare=yoy` sur un jeu réellement peuplé un an plus tôt** : seul le
  décalage des bornes a été observé, sur des tableaux vides. Que les chiffres
  de l'an passé soient corrects n'est pas attesté.
- Le décalage d'une minute de la fenêtre précédente a été relevé **une fois**,
  sur « Last 24 hours ». Qu'il soit identique sur les autres périodes est
  plausible (c'est un calcul client déterministe) mais n'a pas été mesuré.
- Les rapports `POST /api/reports/*` n'ont **aucun** paramètre de comparaison
  observé : comparer un `breakdown` ou un `performance` entre deux périodes
  demande deux requêtes.
- Rien n'a été essayé contre **Umami Cloud**.
