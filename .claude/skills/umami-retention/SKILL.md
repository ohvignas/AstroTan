---
name: umami-retention
description: Use when reading or debugging Umami retention — cohorts of visitors by first-seen day and the share that came back. Also use when the Retention page says "No data available" on a site with history, when it opens on the wrong month, when POST /api/reports/retention returns rows whose day values skip numbers, when cohort sizes change as soon as the date range moves, or when a retention date string fails to parse.
---

# La rétention d'Umami 3 (`Behavior → Retention`)

Vérifié contre une **3.3.1 auto-hébergée**, sur un site sonde fabriqué pour
ça. La mécanique HTTP commune aux rapports est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Ce que c'est

La rétention regroupe les visiteurs en **cohortes par jour de première
visite**, puis mesure pour chaque jour N suivant la part de la cohorte
revenue ce jour-là. C'est la seule vue d'Umami qui suive une même personne
dans le temps ; toutes les autres découpent une période.

## Quelles données doivent exister

**Le même visiteur doit revenir un autre jour.** C'est tout, et c'est la
raison pour laquelle cette page est vide sur presque tous les sites de
démonstration : un jeu d'essai fabriqué en une fois produit une seule
journée, donc une seule cohorte, donc une seule colonne à 100 %.

« Le même visiteur » a un sens précis : la session est un **hachage
déterministe de `websiteId` + `hostname` + IP + `User-Agent`**. Vérifié —
deux envois avec le même couple IP/UA rendent le même `sessionId`, changer
l'un ou l'autre en rend un autre. Pour fabriquer un revenant, on garde donc
l'IP et le UA **constants** et on ne fait varier que `payload.timestamp`,
qui est en **secondes** et qui est honoré : `firstAt`/`lastAt` de la session
sont le minimum et le maximum des événements reçus, quel que soit l'ordre
d'envoi (vérifié en envoyant J-5 avant J-9 : `firstAt` vaut bien J-9).

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

j0 = int(datetime.datetime.now(datetime.timezone.utc)
         .replace(hour=9, minute=0, second=0, microsecond=0).timestamp())
retours = {1: [-12,-11,-10,-7], 2: [-12,-10], 3: [-11,-6], 4: [-12], 5: []}
for v, jours in retours.items():             # cohorte du jour -13
    send("198.51.100.%d" % v, "/", j0 - 13*86400)
    for j in jours:
        send("198.51.100.%d" % v, "/blog", j0 + j*86400)
```

**Un `User-Agent` d'outil (`curl/…`, `python-requests/…`, `Go-http-client/…`,
`probe/1.0`) reçoit `200 {"beep":"boop"}` et n'écrit rien** — cause n°1 d'une
rétention vide après avoir « injecté » des données.

## Le lire

Il n'y a **rien à définir** : ni rapport enregistré, ni réglage. La page
interroge directement.

```http
POST /api/reports/retention
{"websiteId":"<uuid>","type":"retention","filters":{},
 "parameters":{"startDate":"2026-08-08T00:00:00Z",
               "endDate":"2026-08-29T00:00:00Z",
               "timezone":"UTC"}}
```

Aucun paramètre propre n'est requis. `unit` est **accepté et ignoré** :
`"day"`, `"month"` et son absence rendent trois réponses identiques,
toujours au jour.

Réponse réelle, deux cohortes de 5 visiteurs :

```json
[{"date":"2026-08-15T00:00:00Z","day":0,"visitors":5,"returnVisitors":5,"percentage":100},
 {"date":"2026-08-15T00:00:00Z","day":1,"visitors":5,"returnVisitors":3,"percentage":60},
 {"date":"2026-08-15T00:00:00Z","day":2,"visitors":5,"returnVisitors":2,"percentage":40},
 {"date":"2026-08-15T00:00:00Z","day":3,"visitors":5,"returnVisitors":2,"percentage":40},
 {"date":"2026-08-15T00:00:00Z","day":6,"visitors":5,"returnVisitors":1,"percentage":20},
 {"date":"2026-08-15T00:00:00Z","day":7,"visitors":5,"returnVisitors":1,"percentage":20},
 {"date":"2026-08-22T00:00:00Z","day":0,"visitors":5,"returnVisitors":5,"percentage":100},
 {"date":"2026-08-22T00:00:00Z","day":1,"visitors":5,"returnVisitors":2,"percentage":40},
 {"date":"2026-08-22T00:00:00Z","day":2,"visitors":5,"returnVisitors":3,"percentage":60},
 {"date":"2026-08-22T00:00:00Z","day":3,"visitors":5,"returnVisitors":2,"percentage":40}]
```

`visitors` est la **taille de la cohorte** (constante sur toutes ses lignes),
`returnVisitors` ceux revenus le jour N, `percentage` le rapport des deux en
flottant brut (`33.333333333333336` sur une cohorte de 6).

## Les pièges

### 1. La cohorte est datée par la première visite **dans la fenêtre**

C'est le piège majeur, et il fabrique des chiffres faux qui ont l'air justes.
Il n'existe aucune notion de « nouveau visiteur » absolue : `day 0` est le
premier jour où la personne apparaît **dans l'intervalle demandé**.

Le même site, deux fenêtres :

```
08-08 → 08-29 :  cohorte 08-15 = 5 visiteurs   cohorte 08-22 = 5
08-18 → 08-29 :  cohorte 08-18 = 2 visiteurs   cohorte 08-22 = 6
```

Les 5 du 15 août ne disparaissent pas : deux d'entre eux réapparaissent
comme une cohorte « née » le 18 août, un troisième vient grossir celle du
22. Rétrécir la fenêtre ne coupe pas la vue, elle la **réécrit**.

Conséquence directe sur l'interface, qui est cadrée au **mois** : le 1er de
chaque mois ressemble toujours à une acquisition massive, et aucune cohorte
ne traverse une frontière de mois. Un chiffre de rétention lu sans sa fenêtre
ne veut rien dire.

### 2. Les jours sans retour sont des lignes **absentes**, pas des zéros

Dans l'exemple, la cohorte du 15 saute des jours 4 et 5. Un consommateur qui
lit `lignes[4]` comme « jour 4 » se décale silencieusement. Indexer par le
champ `day`, jamais par la position, et remplir les trous soi-même.

### 3. `day: 0` n'est pas de la rétention

Il vaut toujours `percentage: 100` : c'est la cohorte se comptant elle-même.
L'afficher comme une colonne de rétention donne un premier point à 100 % qui
n'est pas une mesure. L'interface, elle, commence ses colonnes à *Day 1* et
met la taille de la cohorte à part.

### 4. `timezone` change le **format** du champ `date`, pas seulement sa valeur

```
"timezone":"UTC"            → "date":"2026-08-15T00:00:00Z"
"timezone":"Europe/Paris"   → "date":"2026-08-15 00:00:00"
```

La seconde forme n'a **ni `T`, ni `Z`, ni décalage**. `new Date(row.date)` la
lit comme une heure *locale* du navigateur, alors que la première est lue en
UTC : selon le fuseau du lecteur, la cohorte glisse d'un jour. Choisir
`"UTC"`, ou normaliser la chaîne avant de la parser.

### 5. L'interface n'utilise pas le sélecteur de dates global

`Behavior → Retention` a ses **propres listes Mois + Année** et ignore le
`?date=30day` de l'URL. Le 2026-08-28, la page s'est ouverte sur **July
2026** — le mois précédent — et affichait *« No data available »* sur un site
dont tout l'historique était en août. Choisir le mois réécrit l'URL en
`?date=range:<ms>:<ms>`.

Donc : « la rétention ne marche pas » commence par « regardez le mois
sélectionné ».

### 6. L'interface ne montre pas toutes les colonnes que l'API rend

Les colonnes affichées sont *Day 1..7*, puis *14*, *21*, *28*. L'API, elle,
rend tous les jours où quelqu'un est revenu — un `day: 11` existe dans la
réponse et n'apparaît nulle part à l'écran.

### 7. Les clés de `filters` ne sont pas validées

`filters:{"browser":"firefox"}` rend `[]` (aucun visiteur Firefox), ce qui
est correct ; mais une **clé** inconnue est ignorée sans erreur et rend le
résultat non filtré. Une faute de frappe dans un filtre passe pour un filtre
appliqué.

## Ce qui n'a pas pu être vérifié

- **Une rétention hebdomadaire ou mensuelle est hors de portée** : `unit` est
  ignoré, la granularité est le jour et rien dans l'API n'a laissé voir un
  autre mode. Ce n'est pas prouvé absent, seulement introuvable.
- **Pourquoi le sélecteur de mois s'ouvre sur le mois précédent** — décalage
  d'indice ou intention. Le comportement est constaté, sa cause non.
- Le lien entre cette page et **`Audience → Cohorts`**, qui est une autre
  fonctionnalité : aucune cohorte n'existait à créer et à croiser.
- `filters` par **segment** ou **cohorte**, pour la même raison.
- Rien n'a été testé contre **Umami Cloud**.
