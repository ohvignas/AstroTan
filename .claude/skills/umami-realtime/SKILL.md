---
name: umami-realtime
description: Use when reading or debugging the Umami Realtime screen or the "N Online" badge — /api/realtime/{websiteId} and /api/websites/{id}/active. Also use when a realtime call answers 404 with HTML instead of JSON, when the live feed silently drops anything older than half an hour, when the Online count and the realtime totals disagree, when startAt seems to be ignored, when a backdated event never shows up live, or when performance measurements inflate the visitor count.
---

# La vue Realtime d'Umami 3

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, en datant les
hits à la seconde près pour trouver les bornes des deux fenêtres.

Mécanique HTTP commune : [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md).

## Ce que fait l'écran

Realtime rend un instantané des dernières minutes : un compteur de visiteurs
en ligne, une courbe minute par minute, et le fil des derniers hits. C'est la
seule vue qui **n'a pas de sélecteur de période** — ses fenêtres sont figées
dans le serveur.

## Les deux appels, et leurs deux fenêtres différentes

```
GET /api/websites/{id}/active   → {"visitors":5}
GET /api/realtime/{websiteId}   → l'instantané complet
```

- **`/active` regarde 5 minutes.** Mesuré : un hit daté d'il y a 4 minutes est
  compté, un hit daté d'il y a 6 minutes ne l'est pas. C'est le badge
  « N Online » de la barre latérale, présent sur **toutes** les vues.
- **`/realtime` regarde 30 minutes.** Mesuré : un hit daté d'il y a 28 minutes
  apparaît, un hit daté d'il y a 32 minutes non.

Les deux chiffres divergent donc en permanence et **c'est normal** : `/active`
peut dire 3 pendant que `/realtime` en totalise 12. Les mettre côte à côte
sans expliquer la différence produit un ticket de bug par semaine.

## L'URL, que l'on écrit spontanément de travers

**C'est `/api/realtime/{websiteId}`, pas `/api/websites/{id}/realtime`.**

Realtime est la seule vue de Traffic dont l'endpoint n'est pas sous
`/api/websites/{id}/`. La mauvaise URL rend **`404` en `text/html`** — la page
d'erreur Next.js. Un client qui fait `JSON.parse` sur toute réponse échoue
alors sur une erreur de syntaxe qui ne parle pas du vrai problème.

**`startAt` est accepté et ignoré** : mesuré, deux appels avec des `startAt`
différents rendent le même corps. Il n'existe aucun moyen de déplacer la
fenêtre de 30 minutes.

## La forme réelle de la réponse

```json
{
  "countries": {},
  "urls": {"/": 1, "/actif": 3},
  "referrers": {},
  "events": [
    {"__type":"pageview","sessionId":"2bf0215a-…","eventName":null,
     "createdAt":"2026-08-28T20:57:21.819Z","browser":"chrome","os":"Mac OS",
     "device":"laptop","country":null,"urlPath":"/","referrerDomain":null,
     "hostname":"localhost"},
    {"__type":"session","sessionId":"2bf0215a-…", … }
  ],
  "series": {
    "views":    [{"x":"2026-08-28T20:57:00Z","y":1}],
    "visitors": [{"x":"2026-08-28T20:57:00Z","y":1}]
  },
  "totals": {"views":4,"visitors":4,"events":0,"countries":0},
  "timestamp": 1787950759738
}
```

Ce qu'il faut y voir :

- **`countries`, `urls`, `referrers` sont des objets**, pas les tableaux
  `[{x,y}]` du reste de l'API. Trois classements, trois formes de données
  différentes de celles de `/metrics`.
- **`events` mélange deux natures**, distinguées par `__type` : `"pageview"`,
  `"session"` — et une même ligne apparaît **deux fois**, une par nature, avec
  le même `createdAt` à la milliseconde. Compter la longueur de `events` pour
  obtenir un nombre de hits double le résultat.
- `series` est minuté (`x` par minute), et **creux** comme partout ailleurs :
  les minutes sans trafic sont absentes, pas à zéro. Une courbe temps réel
  tracée sans re-remplir ment sur l'axe.
- `totals.events` compte les **événements nommés**, pas les lignes de
  `events`. Il vaut 0 sur un trafic de pages seules.
- `timestamp` est l'heure du serveur en **millisecondes** — la seule chose de
  la réponse qui permette de dater la fenêtre.

## Ce qui entre dans le fil, et ce qui n'y entre pas

Mesuré, un hit à la fois :

| Envoyé | Dans `/realtime` | Dans `/active` |
|---|---|---|
| `type: "event"` sans `name` (vue) | oui | oui |
| `type: "event"` avec `name` | oui | oui |
| `type: "performance"` | **non** | **oui** |

Les mesures de Web Vitals ne produisent aucune ligne dans le fil ni dans
`urls`, **mais elles créent une session**, donc elles font monter le compteur
« Online ». Mesuré : trois pings `performance` seuls ont porté `/active` à 3
avec un fil parfaitement vide. Un site instrumenté avec
`data-performance="true"` affiche donc des visiteurs en ligne que la vue ne
sait pas montrer — voir
[`../umami-performance/SKILL.md`](../umami-performance/SKILL.md).

## Un événement antidaté n'apparaît jamais

`timestamp` est honoré à l'écriture, mais les deux fenêtres sont calculées
sur l'horloge du serveur : un hit daté d'hier est bien stocké, interrogeable
par `/stats`, et **invisible** en temps réel. C'est la première chose à
vérifier quand un test d'intégration alimente Umami puis regarde Realtime :
ce n'est pas l'ingestion qui a échoué, c'est la date.

## Le rafraîchissement

Le tableau de bord repolle `/api/realtime/{id}` **environ toutes les 5
secondes**, sans aucun paramètre. Il n'y a ni WebSocket ni SSE : reproduire
l'écran, c'est faire la même boucle.

## Ce qui n'a pas été vérifié

- **`countries` est resté vide** : depuis `127.0.0.1`, Umami ne dérive aucune
  géolocalisation. La forme peuplée de `countries` — et donc
  `totals.countries` — n'est **pas** attestée.
- `referrers` est resté vide dans les mesures temps réel ; sa forme peuplée
  est supposée symétrique de `urls` mais n'a pas été observée.
- La **borne exacte** des deux fenêtres a été encadrée (4 min oui / 6 min non ;
  28 min oui / 32 min non), pas mesurée à la seconde. Les valeurs 5 et 30
  minutes sont l'interprétation la plus simple de ces bornes, pas une lecture
  du code.
- L'intervalle de 5 secondes est un relevé sur quelques cycles, pas une
  constante lue dans la configuration.
- Rien n'a été essayé contre **Umami Cloud**.
