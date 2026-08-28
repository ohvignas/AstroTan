---
name: umami-revenue
description: Use when tracking or reading money in Umami — the Growth → Revenue page, POST /api/reports/revenue, the revenue and currency event properties, ARPU. Also use when the revenue report answers 200 with sum:null and count:0 on a site that clearly records purchases, when a currency returns nothing while another returns everything, when summing the chart gives an absurd total, when ARPU looks far too low, or when refunds fail to lower the total.
---

# Le suivi des revenus dans Umami 3 (Growth → Revenue)

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable où dix achats ont été fabriqués exprès. **La fonctionnalité existe en
auto-hébergé** — rien ici n'est réservé à Umami Cloud. Un rapport antérieur
concluait que la forme peuplée de la réponse restait inconnue faute de
données ; elle est ci-dessous, copiée d'un appel réel.

Umami n'a pas d'objet « commande » : il agrège deux **propriétés
d'événement** posées sur des événements ordinaires. Tout le sujet tient dans
ces deux noms et dans la façon dont le rapport les rapproche.

Le contrat général des rapports est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md), l'envoi des
événements dans
[`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md).

## Le format exact — tranché par essais

**Aucun nom d'événement n'est réservé.** N'importe quel événement nommé
compte, à condition de porter **les deux** propriétés `revenue` et
`currency` :

```json
POST /api/send
{"type":"event","payload":{"website":"<uuid>","hostname":"…","url":"/commande",
  "name":"purchase",
  "data":{"revenue":49.90,"currency":"EUR","plan":"pro"},
  "timestamp":1786615200}}
```

Depuis le navigateur : `umami.track('purchase', {revenue: 49.9, currency: 'EUR'})`.

Ce qui a été essayé et **ne compte pas** — chaque envoi répondant `200` et
apparaissant normalement dans `/metrics?type=event` :

| Propriétés envoyées | Compté ? |
|---|---|
| `{revenue, currency}` | **oui** |
| `{revenue}` seul, sans `currency` | non — invisible sous **toute** devise interrogée |
| `{value, currency}` | non |
| `{amount, currency}` | non |
| `{price, currency}` | non |

Il n'y a donc **qu'un seul nom de propriété possible pour le montant** :
`revenue`. Un événement à `{amount: 30, currency:"EUR"}` s'enregistre, se
voit dans les événements, et n'entre dans aucun total — c'est la panne la
plus discrète du lot.

Deux tolérances mesurées :

- Le montant peut être envoyé en **chaîne** : `{"revenue":"12.50"}` est bien
  sommé comme `12.5` (il est alors stocké avec `dataType: 1` au lieu de `2`,
  ce qui change son classement dans `/event-data/fields` mais pas le total).
- La casse de `currency` à l'envoi est indifférente — voir juste après.

## `currency` est obligatoire à la lecture, et se compare en majuscules

`parameters.currency` n'a pas de défaut : l'omettre rend
`400 "Invalid input: expected string, received undefined"`.

Le rapprochement se fait entre la **valeur stockée mise en majuscules** et la
**valeur du paramètre telle quelle**. Mesuré :

```
stocké "EUR"  ×  paramètre "EUR"  → trouvé
stocké "EUR"  ×  paramètre "eur"  → sum:null, count:0
stocké "usd"  ×  paramètre "USD"  → trouvé
stocké "usd"  ×  paramètre "usd"  → sum:null, count:0
```

**Toujours interroger en majuscules.** Une devise en minuscules rend un
rapport parfaitement vide, en `200`, sur des données parfaitement présentes.

Il n'existe **aucune devise par défaut au niveau du site** : ni le corps de
`GET /api/websites/{id}`, ni les paramètres du site n'en portent. Pour
savoir quelles devises existent réellement dans les données :

```
GET /api/websites/{id}/event-data/values?startAt=…&endAt=…&eventName=purchase&propertyName=currency
→ [{"value":"EUR","total":10}]
```

**Un rapport ne couvre qu'une devise à la fois** : il n'y a ni conversion, ni
total multi-devises. Un site qui encaisse en EUR et en USD exige deux appels
et deux totaux qu'il ne faut pas additionner.

## La réponse, copiée d'un appel réel

```json
POST /api/reports/revenue
{"websiteId":"…","type":"revenue","filters":{},
 "parameters":{"startDate":"2026-08-01T00:00:00.000Z",
               "endDate":"2026-08-31T00:00:00.000Z",
               "timezone":"UTC","unit":"day","currency":"EUR"}}
```
```json
{"chart":[{"x":"purchase","t":"2026-08-08T00:00:00Z","y":"19","count":1},
          {"x":"purchase","t":"2026-08-09T00:00:00Z","y":"250","count":1},
          {"x":"purchase","t":"2026-08-26T00:00:00Z","y":"75","count":1}],
 "total":{"sum":"1006.8","count":10,"unique_count":10,"total_sessions":24,
          "average":100.67999999999999,"arpu":41.949999999999996,
          "comparison":{"sum":null,"count":0,"unique_count":0,
                        "total_sessions":0,"average":0,"arpu":0}},
 "country":[{"name":"FR","value":"519.8"},{"name":"US","value":"339"},
            {"name":"DE","value":"94"},{"name":"GB","value":"54"}],
 "region":[{"country":"FR","name":"FR-HDF","value":"519.8"},
           {"country":"US","name":null,"value":"339"}],
 "referrer":[{"name":null,"value":"613.8"},{"name":"google.com","value":"378"},
             {"name":"t.co","value":"15"}],
 "channel":[{"name":"paidAds","value":"378"},{"name":"Unknown","value":"375"},
            {"name":"email","value":"238.8"},{"name":"organicSocial","value":"15"}]}
```

Ce qu'il faut lire dans cette forme, et qui ne se devine pas :

- **`chart[].x` est le nom de l'événement, pas une date.** La date est `t`.
  Un graphe construit en prenant `x` en abscisse rend une seule colonne
  intitulée `purchase`. C'est l'inverse de la convention `{x, y}` de
  `/metrics` et de `/pageviews`.
- **Les montants sortent en chaînes** : `sum`, `chart[].y`, et les `value` de
  `country`, `region`, `referrer`, `channel`. `count`, `unique_count`,
  `total_sessions`, `average` et `arpu` sont des nombres. Sommer les `y` sans
  conversion concatène — `"19" + "250"` vaut `"19250"` — sans lever d'erreur.
- **`sum: null` et non `0`** quand il n'y a rien : c'est le seul endroit où
  « aucune vente » se distingue de « des ventes à zéro ».
- **`count` compte les événements de revenu, `unique_count` les sessions
  distinctes.** Mesuré : deux achats dans une même session font `count +2` et
  `unique_count +1`.
- **`average` = `sum / count`** (panier moyen), mais **`arpu` = `sum /
  total_sessions`**, et `total_sessions` est le nombre de sessions **du site
  entier** sur la fenêtre, pas des sessions acheteuses. Ici 1006,8 / 24 =
  41,95. Un site à fort trafic et peu de ventes affiche donc un ARPU
  minuscule, qui est correct et qu'on lit spontanément comme un panier
  moyen.
- **`channel` dit `Unknown` là où `/metrics?type=channel` dit `direct`** pour
  le même trafic. Deux écrans, deux libellés, aucune note.
- `comparison` suit les règles générales de la période précédente
  ([`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md) §3).

## Les montants négatifs sont ignorés, pas soustraits

Mesuré : trois événements dans une même session, `+10`, `+20`, `-5`.
`sum` augmente de **30** exactement et `count` de **2**. La ligne négative
n'est ni comptée ni retranchée.

Conséquence : **on ne peut pas modéliser un remboursement par un revenu
négatif.** Un montant `-5` disparaît en silence, le total reste celui des
ventes brutes, et rien dans le rapport ne signale qu'une ligne a été écartée.
Un remboursement doit être traité hors d'Umami, ou par un événement distinct
que l'on soustrait soi-même.

## Croiser le revenu avec le reste

`filters` accepte les colonnes standard en camelCase, ainsi qu'un `segment`
ou un `cohort` :

```json
{"websiteId":"…","type":"revenue",
 "filters":{"utmCampaign":"summer-sale"},
 "parameters":{…,"currency":"EUR"}}
```

Voir [`../umami-segments/SKILL.md`](../umami-segments/SKILL.md) et
[`../umami-cohorts/SKILL.md`](../umami-cohorts/SKILL.md). Pour attribuer les
**conversions** (et non les montants) à une campagne, c'est le rapport
`attribution` — [`../umami-utm/SKILL.md`](../umami-utm/SKILL.md).

## Les pièges, dans l'ordre où ils coûtent cher

1. **`{revenue}` sans `currency` n'est jamais compté**, sous aucune devise.
   L'événement existe, le rapport est vide.
2. **Une devise interrogée en minuscules rend un rapport vide** en `200`.
3. **Le nom de la propriété est `revenue` et rien d'autre.** `amount`,
   `value`, `price` s'enregistrent et ne comptent pas.
4. **`arpu` se divise par toutes les sessions du site.** Ce n'est pas le
   panier moyen — c'est `average`.
5. **`chart[].x` est un nom d'événement.** La date est `t`.
6. **Les montants sont des chaînes.** Sommer sans `Number()` concatène.
7. **Un `revenue` négatif est jeté.** Pas de remboursement possible.
8. Un total juste mais sans vente ressemble à une panne et inversement :
   devant `sum: null`, vérifier dans l'ordre la devise (majuscules), la
   présence de la propriété `currency` sur les événements
   (`/event-data/fields`), puis la fenêtre.

## Ce qui n'a pas été vérifié

- **Le comportement d'un `revenue` valant exactement `0`** n'a pas été
  éprouvé ; seuls des montants strictement positifs et un négatif l'ont été.
- **La devise dans l'interface** : la page Growth → Revenue n'a pas été
  pilotée au navigateur, seul l'appel HTTP l'a été. La façon dont elle
  choisit la devise affichée n'est donc pas établie.
- **Les codes ISO 4217 ne sont pas validés** côté rapport : `ZZZ` est accepté
  et rend simplement un rapport vide. Aucune conversion de devise n'existe.
- **Les permissions d'équipe** : tous les appels ont été faits avec le compte
  propriétaire.
- **Umami Cloud** : rien n'a été testé contre l'offre hébergée.
