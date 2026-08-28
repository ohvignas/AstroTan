---
name: umami-utm
description: Use when tracking or reading marketing campaigns in Umami — utm_source/medium/campaign/term/content, the Growth → UTM page, POST /api/reports/utm, the attribution report, or the channel breakdown. Also use when the UTM report returns five empty arrays on a site with traffic, when a filter on utm_source changes nothing, when campaign numbers look inflated compared with visitors, when a campaign lands in the wrong channel, or when UTM parameters vanish after a tracker option was turned on.
---

# Le suivi de campagnes UTM dans Umami 3 (Growth → UTM)

Vérifié à la main contre une instance **3.3.1 auto-hébergée**, sur un site
jetable où les visites UTM ont été fabriquées exprès. **La fonctionnalité
existe en auto-hébergé** — rien ici n'est réservé à Umami Cloud.

Umami extrait les cinq paramètres `utm_*` de chaque vue de page et les stocke
sur la ligne, ce qui permet ensuite de les classer, de les filtrer et de leur
attribuer des conversions. C'est la seule notion de « campagne » du produit :
il n'y a pas d'objet campagne à créer, seulement des URL à baliser.

La mécanique HTTP commune est dans
[`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md), le contrat des
rapports dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Où Umami lit les UTM — la question tranchée

**Uniquement dans la chaîne de requête du champ `url` du hit.** Ni champ
dédié, ni referrer, ni en-tête.

Envoi de contrôle, les trois hypothèses dans le même hit :

```json
{"type":"event","payload":{"website":"…","url":"/x",
  "utm_source":"champ-direct", "utmSource":"champ-direct2",
  "referrer":"https://ref.example/?utm_source=dans-le-referrer"}}
```

→ le rapport `utm` reste vide. Seul ceci compte :

```json
{"type":"event","payload":{"website":"…",
  "url":"/?utm_source=newsletter&utm_medium=email&utm_campaign=summer-sale&utm_term=astro&utm_content=cta-top"}}
```

Trois précisions mesurées :

- **Les noms de paramètres sont sensibles à la casse, en minuscules.**
  `UTM_Source=Maj` n'est pas relevé ; `utm_campaign=CampMaj` posé dans la
  même URL l'est. Les **valeurs**, elles, gardent leur casse et sont
  décodées (`utm_term=astro%20cms` ressort `astro cms`).
- Une valeur vide (`utm_medium=`) n'écrit rien — pas d'entrée « vide » dans
  le classement.
- L'`url` peut être absolue (`https://exemple.test/page?utm_source=…`) : la
  requête est analysée quand même.

**Le corollaire qui casse une campagne entière :** l'attribut
`data-exclude-search="true"` du traqueur vide `location.search` avant
l'envoi. Lu dans le `script.js` servi par la 3.3.1 :
`j&&(e.search="")`. Toute la mesure UTM disparaît, silencieusement, sur un
site par ailleurs correctement instrumenté
([`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)). C'est la
première chose à vérifier devant cinq tableaux vides.

## Fabriquer les données pour éprouver la fonctionnalité

`POST /api/send`, sans authentification, avec un `User-Agent` de navigateur
crédible — **un `User-Agent` fantaisiste (`UA-test/1.0`) est classé robot et
le hit est jeté en `200`**, ce qui fait perdre une demi-heure. Faire varier
le suffixe d'un vrai UA suffit à obtenir des visiteurs distincts.

```bash
curl -s -X POST http://127.0.0.1:3002/api/send \
 -H 'Content-Type: application/json' \
 -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 V1' \
 -d '{"type":"event","payload":{"website":"<uuid>","hostname":"localhost",
      "url":"/?utm_source=newsletter&utm_medium=email&utm_campaign=summer-sale",
      "referrer":"","timestamp":1786276800}}'
```

`timestamp` est en **secondes** et permet d'antidater. Poser aussi un
`referrer` réaliste : le canal en dépend (§ Canaux).

## Lire — trois voies, trois unités de compte différentes

### 1. Le rapport `utm` : cinq classements, en **vues**

```json
POST /api/reports/utm
{"websiteId":"…","type":"utm","filters":{},
 "parameters":{"startDate":"2026-08-01T00:00:00.000Z",
               "endDate":"2026-08-31T00:00:00.000Z",
               "timezone":"UTC","unit":"day"}}
```
```json
{"utm_source":[{"utm":"newsletter","views":8},{"utm":"google","views":6},
               {"utm":"twitter","views":4}],
 "utm_medium":[{"utm":"email","views":8},{"utm":"cpc","views":6},
               {"utm":"social","views":4}],
 "utm_campaign":[{"utm":"summer-sale","views":8},{"utm":"brand","views":6},
                 {"utm":"launch","views":4}],
 "utm_term":[{"utm":"astro","views":8},{"utm":"astro cms","views":6}],
 "utm_content":[{"utm":"cta-top","views":8},{"utm":"ad-1","views":6}]}
```

Aucun paramètre propre : les dates suffisent. Les clés de la réponse sont en
**snake_case** (`utm_source`), classées par `views` décroissant.

**`views` compte des vues de page, pas des personnes.** Tranché par un test
dédié : un visiteur unique rechargeant trois fois la même URL balisée rend
`views: 3`. Le rapport n'expose **aucun compte de visiteurs ni de visites** —
une campagne dont le trafic vient d'un seul lecteur insomniaque est
indiscernable d'une campagne à trois destinataires.

### 2. `/metrics?type=utm*` : les mêmes classements, en **visites**

```
GET /api/websites/{id}/metrics?startAt=…&endAt=…&type=utmCampaign
→ [{"x":"summer-sale","y":8},{"x":"brand","y":6},{"x":"launch","y":4}]
```

`type` admet ici `utmSource` `utmMedium` `utmCampaign` `utmContent`
`utmTerm` — **en camelCase**, à l'inverse des clés du rapport. Et `y` est un
nombre de **sessions ayant touché la valeur**, conformément au piège central
de [`../umami-read-api/SKILL.md`](../umami-read-api/SKILL.md) §1.

Mesuré sur le même visiteur à trois rechargements :
`/metrics?type=utmCampaign` → `y: 1`, rapport `utm` → `views: 3`. Les deux
tableaux ont l'air du même classement et ne comptent pas la même chose. Ne
jamais les additionner ni les comparer entre écrans.

### 3. Filtrer le reste du tableau de bord par campagne

```
/stats?…&utmSource=newsletter    →  8 visiteurs     ← appliqué
/stats?…&utm_source=newsletter   → 25 visiteurs     ← le site entier
```

**Le nom du filtre est en camelCase.** `utm_source` — l'orthographe même que
le rapport `utm` renvoie dans ses clés — n'appartient pas à la table
`FILTER_COLUMNS` : il est jeté sans erreur, et la réponse ressemble à une
campagne qui aurait touché tout le site. Le contrôle qui tranche : donner au
filtre une valeur impossible (`utmCampaign=zzz`) ; un filtre appliqué rend
zéro, un filtre ignoré rend le total.

Les cinq noms valides : `utmSource` `utmMedium` `utmCampaign` `utmContent`
`utmTerm`. Ils valent comme paramètres d'URL, comme `filters` d'un rapport,
et comme `name` dans un segment
([`../umami-segments/SKILL.md`](../umami-segments/SKILL.md)).

## Canaux — dérivés, jamais déclarés

`/metrics?type=channel` classe le trafic sans qu'on ait rien à configurer :

```
[{"x":"direct","y":16},{"x":"email","y":8},
 {"x":"paidAds","y":6},{"x":"organicSocial","y":4}]
```

`paidAds` sort d'une liste en dur du build 3.3.1, qui reconnaît un clic payé
à l'un de ces marqueurs dans la requête : `gclid=` `dclid=` `msclkid=`
`twclid=` `ttclid=` `rdt_cid=` `li_fat_id=` `epik=` `scid=` `ob_click_id=`
`pc_id=` `aid=` `ad_id=`, **`utm_medium=cpc`**, `utm_medium=paid`,
`utm_medium=paid_social`, **`utm_source=google`**.

Deux conséquences pratiques :

- `utm_source=google` suffit à classer une visite en publicité payante, même
  sans `utm_medium`. Une campagne organique balisée `utm_source=google` sera
  comptée comme payante.
- `channel` **se ventile mais ne se filtre pas** : ce n'est pas une colonne
  de `FILTER_COLUMNS`. `/stats?channel=email` rend le site entier.

## Attribuer des conversions à une campagne

Le rapport `attribution` relie les UTM à une conversion. Il exige `model`
(`first-click` | `last-click`), `type` (`path` | `event`) et `step` :

```json
POST /api/reports/attribution
{"websiteId":"…","type":"attribution","filters":{},
 "parameters":{"startDate":"…","endDate":"…","timezone":"UTC","unit":"day",
   "model":"first-click","type":"event","step":"purchase"}}
```
```json
{"referrer":[{"name":"google.com","value":3},{"name":"t.co","value":1}],
 "paidAds":[],
 "utm_source":[{"name":"newsletter","value":4},{"name":"google","value":3},
               {"name":"twitter","value":1}],
 "utm_medium":[…], "utm_campaign":[…], "utm_content":[…], "utm_term":[…],
 "total":{"pageviews":10,"visitors":10,"visits":10}}
```

**`total` compte les conversions, pas du chiffre d'affaires** : ici 10
achats. Les `value` sont des conversions attribuées.

Le même appel en `last-click` sur le même jeu de données rend **cinq
tableaux UTM vides** — parce que la dernière visite avant l'achat était un
accès direct, la campagne n'ayant amené que la première. Ce n'est pas une
panne : c'est le modèle qui répond. Un rapport d'attribution vide en
`last-click` et peuplé en `first-click` est la signature normale d'un cycle
d'achat à plusieurs visites, et la raison pour laquelle il faut regarder les
deux avant de conclure qu'une campagne « ne convertit pas ».

## Les pièges, dans l'ordre où ils coûtent cher

1. **`data-exclude-search="true"` supprime toute la mesure UTM.** Cinq
   tableaux vides, aucune erreur, un site par ailleurs mesuré correctement.
2. **`utm_source` en filtre est ignoré ; c'est `utmSource`.** Et le nom
   fautif est précisément celui que le rapport affiche.
3. **`views` du rapport ≠ `y` de `/metrics` ≠ visiteurs.** Trois nombres pour
   la même campagne, aucun étiqueté.
4. **Les noms de paramètres UTM sont sensibles à la casse.** Un lien
   `?UTM_Campaign=…` produit une visite comptée mais hors de toute campagne.
5. **`utm_source=google` classe en `paidAds`** même sans média payant.
6. **Cinq tableaux vides sont une mesure, pas une erreur.** Avant de
   soupçonner l'API : vérifier qu'une visite au moins portait des UTM
   (`/metrics?type=utmSource`), puis la fenêtre, puis le traqueur.

## Ce qui n'a pas été vérifié

- **Le paramètre `ref`** (raccourci de campagne d'Umami 2) n'a pas été
  éprouvé sur cette version.
- **Les liens et pixels** (`/links`, `/pixels` dans l'interface 3.3.1)
  fabriquent probablement des URL balisées ; leur interaction avec ces
  rapports n'a pas été testée.
- **Le classement `paidAds`** du rapport `attribution` est resté vide sur le
  jeu d'essai : sa forme peuplée n'est pas connue.
- **Umami Cloud** : rien n'a été testé contre l'offre hébergée.
