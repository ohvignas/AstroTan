---
name: umami-goals
description: Use when defining or reading an Umami goal — a conversion rate on one page view or one named event. Also use when the Goals page shows "0 / 0" and 0% on a site that clearly has traffic, when POST /api/reports/goal answers 200 with num:0 and the value looks right, when a goal counts fewer conversions than /metrics?type=event reports for the same event name, or when someone asks where to set a target number on a goal.
---

# Les objectifs d'Umami 3 (`Behavior → Goals`)

Vérifié contre une **3.3.1 auto-hébergée**, sur un site sonde fabriqué pour
ça. La mécanique HTTP commune aux rapports — dates ISO dans `parameters`,
`type` répété dans le corps, `filters` obligatoire — est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md) et n'est pas
répétée ici.

## Ce que c'est

Un objectif répond à **une** question : sur la période choisie, quelle part
des visiteurs a fait *une* chose — vu un chemin, ou déclenché un événement
nommé. C'est un ratio `conversions / visiteurs`, rien de plus : pas de
séquence (c'est [`../umami-funnels/SKILL.md`](../umami-funnels/SKILL.md)),
pas de valeur cible, pas d'alerte.

## Quelles données doivent exister

| Objectif | Ce qu'il faut avoir reçu |
|---|---|
| `type: "path"` | au moins une **vue de page** sur ce chemin exact |
| `type: "event"` | au moins un `/api/send` portant `payload.name` |

Et surtout : **dans la fenêtre de dates affichée**. L'interface ouvre sur
*Last 24 hours* ; un site dont tout l'historique a plus d'un jour affiche
`0 / 0` et `0%` — une carte d'objectif parfaitement formée qui ne dit rien.
C'est le premier réflexe : changer la période avant de soupçonner la
définition.

Pour fabriquer de quoi essayer, [`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)
décrit `/api/send`. Le minimum qui produit un objectif d'événement :

```bash
curl -s -X POST http://127.0.0.1:3002/api/send \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  -d '{"type":"event","payload":{"website":"<uuid>","hostname":"localhost",
       "url":"/tarifs","name":"telecharger-brochure"}}'
```

**Un `User-Agent` d'outil fait échouer ça en silence.** `curl/8.7.1`,
`python-requests/…`, `Go-http-client/…`, `node-fetch/…` et même `probe/1.0`
reçoivent `200 {"beep":"boop"}` et **rien n'est écrit**. Un UA de navigateur
passe ; un en-tête `User-Agent` *absent* passe aussi. Ce n'est donc pas
« le UA est obligatoire », c'est « le UA ne doit pas ressembler à un robot ».

## Définir un objectif

Un objectif **est un rapport enregistré** de type `goal`. La page
`Behavior → Goals` liste ces rapports et rien d'autre : sans rapport
enregistré, elle est vide même sur un site plein.

Interface : bouton **Goal** → *Name*, *Action* (`Viewed page` |
`Triggered event`), et la valeur. Deux actions, pas trois.

Par l'API, c'est la création de rapport enregistré — **pas** de dates, elles
sont fournies à l'affichage :

```http
POST /api/reports
{"websiteId":"<uuid>","type":"goal","name":"Objectif brochure",
 "description":"",                              // facultatif
 "parameters":{"type":"event","value":"telecharger-brochure"}}
```

Réponse réelle :

```json
{"id":"2951dad9-3347-49bb-821c-9ccf60489acc","userId":"…","websiteId":"…",
 "type":"goal","name":"Objectif brochure","description":"sonde",
 "parameters":{"type":"event","value":"telecharger-brochure"},
 "createdAt":"2026-08-28T20:53:14.998Z","updatedAt":"2026-08-28T20:53:14.998Z"}
```

`GET /api/websites/{id}/reports` les liste, `GET`/`DELETE /api/reports/{id}`
en lit ou en supprime un.

## Lire le chiffre

```http
POST /api/reports/goal
{"websiteId":"<uuid>","type":"goal","filters":{},
 "parameters":{"startDate":"2026-08-08T00:00:00Z",
               "endDate":"2026-08-29T00:00:00Z",
               "timezone":"UTC",
               "type":"event","value":"telecharger-brochure"}}
```

Toute la réponse, telle quelle :

```json
{"num":5,"total":10}
```

`num` = visiteurs ayant converti, `total` = visiteurs de la période.
L'interface les affiche « 5 / 10 » et « 50% ». `unit` est accepté et sans
effet ; `type` et `value` sont obligatoires (400 sinon).

Mesures obtenues sur le site sonde (10 visiteurs) :

| `type` | `value` | Réponse |
|---|---|---|
| `event` | `telecharger-brochure` | `{"num":5,"total":10}` |
| `event` | `inscription-terminee` | `{"num":2,"total":10}` |
| `path` | `/tarifs` | `{"num":7,"total":10}` |
| `path` | `/tar*` | `{"num":7,"total":10}` |
| `path` | `/` | `{"num":10,"total":10}` |

## Les pièges

### 1. `num` compte des visiteurs, pas des déclenchements

Sur le même site, le même événement, la même fenêtre :

```
POST /api/reports/goal  (event telecharger-brochure) → {"num":5,"total":10}
GET  /metrics?type=event                             → [{"x":"telecharger-brochure","y":7}]
```

Sept tirs, cinq visiteurs. Vérifié en faisant tirer deux fois de plus au
même visiteur : `num` n'a pas bougé. Les deux chiffres sont justes, ils
répondent à deux questions ; comparer un objectif à un compteur d'événements
donne un écart qu'on prend pour une perte de données.

### 2. `parameters.type` n'est pas validé — et se rabat sur « événement »

C'est le piège coûteux, parce qu'il rend `200` et un objet plausible.

| `type` envoyé | `value` | Réponse | Ce qui s'est passé |
|---|---|---|---|
| `path` | `/tarifs` | `{"num":7,"total":10}` | correct |
| `paths` | `/tarifs` | `{"num":0,"total":10}` | cherché un **événement** nommé `/tarifs` |
| `pageview` | `/` | `{"num":0,"total":10}` | idem |
| `zzz` | `telecharger-brochure` | `{"num":5,"total":10}` | traité comme `event` |

Seule la chaîne exacte `"path"` déclenche la recherche par chemin ; **tout
le reste** est interprété comme un nom d'événement. Aucune erreur, aucun
avertissement. À comparer avec le rapport `funnel`, dont le `type` de chaque
étape *est* validé (`Invalid option: expected one of "path"|"event"`) —
deux rapports voisins, deux rigueurs différentes.

### 3. `total` est *tous* les visiteurs, pas ceux qui pouvaient convertir

Un objectif sur une page profonde compare ses conversions à l'audience
entière du site. Le taux affiché n'est donc pas « qui a converti parmi ceux
qui ont vu la page » — pour cette question-là il faut un entonnoir à deux
étapes.

### 4. Un filtre inconnu est ignoré sans rien dire

```
filters:{"browser":"chrome"}  → {"num":5,"total":10}
filters:{"browser":"firefox"} → {"num":0,"total":0}     ← total tombe aussi
filters:{"zzz":"nimporte"}    → {"num":5,"total":10}    ← clé inconnue, aucun effet
```

Une faute de frappe dans le nom d'un filtre rend un résultat *non filtré*
qu'on lit comme filtré. Et quand un filtre légitime ne retient personne,
c'est `{"num":0,"total":0}` — indiscernable d'une période vide.

### 5. `*` marche dans `value` pour un chemin

`/tar*` rend le même compte que `/tarifs`. Pratique, et non documenté : un
chemin contenant `*` par accident élargit l'objectif en silence.

## Ce qui n'a pas pu être vérifié

- **Il n'existe aucune valeur cible dans la 3.3.1.** La boîte de dialogue
  n'a que *Name*, *Action*, valeur ; la carte n'affiche que le taux. Si
  quelqu'un cherche « l'objectif à 100 inscriptions », il n'est pas dans
  l'interface — reste à savoir si une version ultérieure l'ajoute.
- Les objectifs ne déclenchent **rien** (ni alerte, ni webhook) pour autant
  que l'API le montre ; aucun endpoint de notification n'a été trouvé, mais
  l'absence n'a pas été prouvée.
- `filters` par **segment** ou **cohorte** : aucun n'existait à créer et à
  interroger.
- Rien n'a été testé contre **Umami Cloud**.
