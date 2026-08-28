---
name: umami-funnels
description: Use when building or debugging an Umami funnel — an ordered sequence of pages or events with drop-off. Also use when POST /api/reports/funnel returns the right count on step 1 and zero everywhere after, when every step returns 0 visitors with dropoff:null, when the funnel refuses with "Too small: expected array to have >=2 items" or "window: expected number, received NaN", or when a funnel completes for visitors who took days between two steps.
---

# Les entonnoirs d'Umami 3 (`Behavior → Funnels`)

Vérifié contre une **3.3.1 auto-hébergée**, sur un site sonde fabriqué pour
ça. La mécanique HTTP commune aux rapports — dates ISO dans `parameters`,
`type` répété dans le corps, `filters` obligatoire — est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Ce que c'est

Un entonnoir prend une suite **ordonnée** de 2 à N étapes (un chemin ou un
événement nommé) et compte, pour chacune, les visiteurs qui l'ont atteinte
*après* la précédente et *moins de `window` minutes* après elle. Il répond à
« où perd-on les gens », pas à « par où passent-ils » — cette question-là est
celle de [`../umami-journeys/SKILL.md`](../umami-journeys/SKILL.md).

## Quelles données doivent exister

Plusieurs visiteurs **distincts** ayant parcouru les mêmes étapes **dans
l'ordre**, avec un abandon quelque part, et **des étapes assez rapprochées
dans le temps** pour tenir dans `window`.

Deux visiteurs qui ont vu les mêmes pages dans le désordre ne produisent
rien : l'entonnoir est strictement séquentiel (mesuré plus bas).

Pour fabriquer ça, l'identité d'un visiteur se déduit de la session, et la
session est un **hachage déterministe de `websiteId` + `hostname` + IP +
`User-Agent`** — vérifié : deux envois avec le même couple IP/UA rendent le
même `sessionId`, changer l'un ou l'autre en rend un autre. Donc :
**une IP par visiteur** (en-tête `X-Forwarded-For`, honoré), et un
`User-Agent` de navigateur commun.

`payload.timestamp` est en **secondes** et il est honoré : il fixe la date
de l'événement, et `firstAt`/`lastAt` de la session en sont le minimum et le
maximum — l'ordre d'envoi n'a donc aucune importance (vérifié en envoyant
J-5 avant J-9 : `firstAt` est bien J-9).

```python
import json, urllib.request, datetime
W  = "<uuid>"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
def send(ip, url, ts):
    b = json.dumps({"type": "event", "payload": {
        "website": W, "hostname": "localhost", "url": url, "timestamp": ts}}).encode()
    urllib.request.urlopen(urllib.request.Request(
        "http://127.0.0.1:3002/api/send", data=b,
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "X-Forwarded-For": ip}))

base  = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 3*86400
etapes = ["/", "/tarifs", "/inscription", "/merci"]
profondeur = [4,4,3,3,2,2,2,1,1,1]           # 10 visiteurs, abandon progressif
for i, p in enumerate(profondeur):
    for s in range(p):
        send("198.51.100.%d" % (i+1), etapes[s], base + s*180)   # 3 min entre étapes
```

**Un `User-Agent` d'outil (`curl/…`, `python-requests/…`, `Go-http-client/…`,
et même `probe/1.0`) reçoit `200 {"beep":"boop"}` et n'écrit rien.** C'est la
raison n°1 d'un entonnoir vide quand on vient de fabriquer les données.

## Définir un entonnoir

Un entonnoir **est un rapport enregistré** de type `funnel` : la page
`Behavior → Funnels` est vide tant qu'on n'en a pas créé un, même sur un site
plein. Bouton **Funnel** → *Name*, *Window* (60 par défaut), *Steps* (type +
valeur, bouton *Add* pour la suivante).

Par l'API : `POST /api/reports` avec
`{"websiteId":…,"type":"funnel","name":…,"parameters":{"window":60,"steps":[…]}}`
— sans dates, elles sont fournies à l'affichage.

## Lire l'entonnoir

```http
POST /api/reports/funnel
{"websiteId":"<uuid>","type":"funnel","filters":{},
 "parameters":{"startDate":"2026-08-08T00:00:00Z",
               "endDate":"2026-08-29T00:00:00Z",
               "timezone":"UTC",
               "window":60,
               "steps":[{"type":"path","value":"/"},
                        {"type":"path","value":"/tarifs"},
                        {"type":"path","value":"/inscription"},
                        {"type":"path","value":"/merci"}]}}
```

`window` et `steps` sont **obligatoires** ; les omettre donne
`"window": ["Invalid input: expected number, received NaN"]` et
`"steps": ["Too small: expected array to have >=2 items"]`.

Réponse réelle, sur le jeu ci-dessus :

```json
[{"type":"path","value":"/",            "visitors":10,"previous":0, "dropped":0,"dropoff":null,              "remaining":1},
 {"type":"path","value":"/tarifs",      "visitors":7, "previous":10,"dropped":3,"dropoff":0.30000000000000004,"remaining":0.7},
 {"type":"path","value":"/inscription", "visitors":4, "previous":7, "dropped":3,"dropoff":0.4285714285714286, "remaining":0.4},
 {"type":"path","value":"/merci",       "visitors":2, "previous":4, "dropped":2,"dropoff":0.5,                "remaining":0.2}]
```

- `dropoff` est relatif à l'étape **précédente**, `remaining` à l'étape **1**.
- L'étape 1 porte toujours `previous:0` et `dropoff:null`.
- Ce sont des flottants bruts : `0.30000000000000004`. Arrondir à l'affichage.

Mélanger chemins et événements marche — `{"type":"event","value":"inscription-terminee"}`
en dernière étape a rendu `visitors:2`, `dropoff:0.714…`.

## Les pièges

### 1. `window` est en minutes, entre étapes consécutives — et il fait taire l'entonnoir

Les étapes du jeu d'essai sont espacées de **3 minutes**. Mesuré :

| `window` | Résultat |
|---|---|
| 1 | `[10, 0, 0]` |
| 2 | `[10, 0, 0]` |
| 3 | `[10, 7, 4]` |
| 60 | `[10, 7, 4]` |

Un entonnoir qui s'effondre après la première étape n'est presque jamais une
erreur de chemin : c'est `window`. Et rien ne le signale — la réponse est
structurellement parfaite.

### 2. `window` n'est **pas** borné par la visite ni par la session

C'est l'erreur symétrique, et la plus trompeuse parce qu'elle *gonfle* le
résultat. Deux étapes vues à **un jour d'intervalle** :

```
/merci → /blog, window=60     → [2, 0]
/merci → /blog, window=20000  → [2, 2]      (20000 min ≈ 14 jours)
```

`window` est un simple budget de temps entre deux étapes, pas une contrainte
« dans la même visite ». Un `window` généreux transforme l'entonnoir en
« ces deux choses ont-elles jamais eu lieu dans cet ordre », ce qui n'est
plus un entonnoir. La valeur par défaut de l'interface (60) est un choix, pas
une garantie.

### 3. L'ordre est strict, et une étape 1 fautive met tout à zéro

```
[/merci, /]         → [2, 0]        ← l'inverse du vrai parcours
[/nexistepas, /]    → [0, 0]  avec dropoff:null et remaining:null partout
```

Une faute de frappe dans la **première** étape rend un tableau complet,
`200`, tout à zéro — la forme exacte d'un entonnoir légitime que personne ne
termine. Le signe qui distingue les deux : `remaining:null` (et non `1`) sur
l'étape 1. Contrôle rapide : passer chaque valeur d'étape en objectif
(`POST /api/reports/goal`) pour savoir laquelle est vide, avant de soupçonner
l'ordre ou la fenêtre.

### 4. Ce que l'API valide, et ce qu'elle ne valide pas

`steps[].type` **est** validé :
`Invalid option: expected one of "path"|"event"`. C'est l'inverse du rapport
`goal`, dont le `type` accepte n'importe quelle chaîne et se rabat en
silence sur « événement » (voir [`../umami-goals/SKILL.md`](../umami-goals/SKILL.md)).
Ne pas généraliser la rigueur d'un rapport à son voisin.

En revanche `filters` ne valide pas ses clés :
`filters:{"zzz":"nimporte"}` rend le résultat **non filtré**, sans erreur.

### 5. `*` est un joker dans les valeurs de chemin

`/*` en première étape a rendu les 10 visiteurs, `/tar*` en a rendu 7 comme
`/tarifs`. Utile ; dangereux si un `*` traîne par accident.

### 6. La même étape deux fois de suite ne mesure rien

`[/ , /]` rend `[10, 10]` : la deuxième étape est satisfaite par la même vue.
Ce n'est pas « ils sont revenus sur l'accueil ».

## Ce qui n'a pas pu être vérifié

- Le comportement au-delà de **4 étapes** (jusqu'où `steps` monte) n'a pas
  été poussé ; seuls 2, 3 et 4 ont été exécutés.
- **Quel événement gagne** quand un visiteur repasse plusieurs fois par une
  étape : le premier ou le dernier passage dans la fenêtre. Le jeu d'essai ne
  contenait pas de répétition contrôlée.
- `filters` par **segment** ou **cohorte** : aucun n'existait à interroger.
- Rien n'a été testé contre **Umami Cloud**.
