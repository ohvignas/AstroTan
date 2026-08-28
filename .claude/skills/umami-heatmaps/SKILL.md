---
name: umami-heatmaps
description: Use when turning on or reading Umami heatmaps — the click and scroll maps, POST /api/reports/heatmap, heatmapEnabled, heatmapSampleRate. Also use when the heatmap report answers 200 with points:[] and snapshot:null on a page that clearly gets clicks, when the heatmap background is blank or shows the wrong page, when clicks made from JavaScript never register, when replays record but heatmaps stay empty, or when deciding whether heatmaps need the same privacy precautions as replays.
---

# Les cartes de chaleur d'Umami 3

Vérifié contre une instance **3.3.1 auto-hébergée** : `recorder.js` lu ligne
à ligne, un site jetable créé puis supprimé, des clics et des défilements
réels produits dans un navigateur avec **interception des requêtes
sortantes**, le rapport rejoué jusqu'à ce qu'il rende des points, et la table
`heatmap_event` inspectée.

Le branchement dans ce dépôt :
[`../analytics-umami/SKILL.md`](../analytics-umami/SKILL.md) §« Replays et
Heatmaps ». Le second script est le même que celui des enregistrements, et
tout ce qui concerne son chargement, son échec silencieux et son poids est
dans [`../umami-replays/SKILL.md`](../umami-replays/SKILL.md) — cette page ne
le répète pas. La forme générale des `POST /api/reports/*` est dans
[`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md).

## Ce qu'une carte de chaleur collecte — beaucoup moins qu'un replay

C'est la bonne nouvelle, et elle vaut d'être connue avant d'appliquer aux
heatmaps les précautions des replays.

Les heatmaps **ne passent pas par rrweb**. Elles ont leur propre collecteur
dans `recorder.js`, qui poste sur le même `POST /api/record` mais avec
`type: "heatmap"`, et n'émet que **deux formes d'événement**. Charges utiles
observées sur le réseau, telles quelles :

```json
{"type":"heatmap",
 "payload":{"website":"888d9084-15d8-402d-a27b-fdeeacf45dd8",
   "timestamp":1787950375,
   "events":[{"type":"click","url":"http://127.0.0.1:4455/",
              "x":146,"y":696,"pageX":146,"pageY":696,
              "pageW":1265,"pageH":2455,
              "viewportW":1280,"viewportH":720,
              "timestamp":1787950369551}]}}
```

```json
{"type":"heatmap",
 "payload":{"website":"888d9084-…","timestamp":1787950332,
   "events":[{"type":"scroll","url":"http://127.0.0.1:4455/",
              "scrollPct":49,
              "pageW":1265,"pageH":2455,
              "viewportW":1280,"viewportH":720,
              "timestamp":1787950326345}]}}
```

**Il n'y a rien d'autre. Pas de DOM, pas de texte, pas de saisie, et — le
point le plus important — aucune identité d'élément.** Un clic est une paire
de coordonnées : ni sélecteur, ni `id`, ni libellé du bouton cliqué. Umami ne
sait pas *sur quoi* on a cliqué ; il sait *où*, et reconstitue le reste en
posant les points sur la page.

Confirmé au niveau du stockage : la table `heatmap_event` porte
`url_path`, `event_type`, `x`, `y`, `page_x`, `page_y`, `page_w`, `page_h`,
`viewport_w`, `viewport_h`, `scroll_pct` — et rien qui désigne un élément.
`event_type` vaut **1 pour un clic, 2 pour un défilement** (mesuré).

Conséquence pratique : **les heatmaps n'ont pas le problème de
confidentialité des replays.** Ce qui reste, et qui n'est pas nul : les
coordonnées sont rattachées à une `session_id` et à une `visit_id`, donc au
même visiteur que le reste des statistiques, et la taille exacte du
navigateur (`viewportW × viewportH`, `pageW × pageH`) part à chaque
événement — c'est un ingrédient d'empreinte.

## Les deux règles de collecte qui font croire à une panne

**1. Un clic JavaScript n'est jamais compté.** Le collecteur exige
`event.isTrusted` **et** `button === 0`. `element.click()`, un `dispatchEvent`
et tout clic simulé par un test sont ignorés — silencieusement. Vérifié :
seuls les clics émis par un vrai pointeur sont apparus. Un clic droit ou
milieu ne compte pas non plus.

**2. Le défilement ne produit qu'un point par nouvelle profondeur maximale.**
Le collecteur retient le `scrollPct` le plus haut atteint et n'émet que
lorsqu'il dépasse le précédent déjà envoyé — étranglé à 400 ms. Descendre
puis remonter puis redescendre ne produit pas trois événements. Ce n'est pas
une carte de « où les gens sont passés », c'est **jusqu'où ils sont
descendus**.

Les envois sont groupés : **20 événements, ou 5 secondes** après le dernier.
Dans un onglet en arrière-plan, ces minuteurs sont ralentis par le navigateur
et le lot peut partir très en retard (mesuré) — `visibilitychange` vers
`hidden` et `beforeunload` forcent le vidage.

## L'interrupteur : séparé de celui des replays

`heatmapEnabled` et `heatmapSampleRate` vivent dans le même objet
`replayConfig`, mais les deux fonctionnalités sont **indépendantes** : deux
drapeaux, deux taux d'échantillonnage, deux tirages aléatoires distincts au
chargement de la page. Le site de ce dépôt tourne d'ailleurs avec
`replayEnabled: true` et `heatmapEnabled: false`.

Comme pour les replays, `recorderEnabled` **ne s'écrit pas** : il est dérivé
de `replayEnabled || heatmapEnabled`. Le champ qui s'écrit :

```bash
curl -X POST "$UMAMI/api/websites/$ID" -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '{"replayConfig":{"heatmapEnabled":true,"heatmapSampleRate":1}}'
```

Vérification, sans authentification :

```bash
curl -s "$UMAMI/api/websites/$ID/recorder"
# {"enabled":true,"replayEnabled":false,"heatmapEnabled":true,
#  "sampleRate":1,"heatmapSampleRate":1,"maskLevel":"moderate",
#  "maxDuration":300000,"blockSelector":""}
```

**Défaut : `heatmapSampleRate = 0.15`** — 15 % des chargements de page. Pour
tester, poser `1`. `maxDuration` **ne s'applique pas** aux heatmaps : le
collecteur de clics et de défilement continue après les 5 minutes qui
arrêtent l'enregistreur de session.

Deux pièges de l'écriture, déjà notés côté replays et qui mordent ici aussi :
le `POST` **fusionne** avec la configuration existante, et une valeur
`false` **disparaît du JSON stocké** au lieu d'y être écrite — traiter
« clé absente » comme « faux ».

## Lire la carte : `urlPath` n'est pas facultatif

C'est **la** raison pour laquelle ce rapport a la réputation de ne rien
rendre. Sans `urlPath`, il répond `200` avec une carte vide, et cette réponse
ressemble exactement à une absence de données :

```json
{"mode":"click","pages":[{"urlPath":"/","count":3,"sessions":1}],
 "points":[],"snapshot":null,
 "scroll":{"buckets":[],"totalSessions":0,"pageW":null,…}}
```

`pages` est peuplé — la donnée existe. `points` est vide parce qu'**une
carte de chaleur porte sur une page, et qu'aucune n'a été demandée**. Le
premier appel sert à choisir dans `pages` ; le second à tracer.

```bash
POST /api/reports/heatmap
{"websiteId":"<uuid>","type":"heatmap","filters":{},
 "parameters":{"startDate":"2026-08-28T18:00:00.000Z",
               "endDate":"2026-08-28T23:00:00.000Z",
               "timezone":"UTC","unit":"day",
               "mode":"click","urlPath":"/"}}
```

`mode` admet exactement `click` | `scroll` — l'API le dit elle-même :
`Invalid option: expected one of "click"|"scroll"`. Omis, il vaut `click`.

`mode: "click"` :

```json
"points":[{"x":64,"y":377,"pageX":64,"pageY":377,
           "pageW":1265,"pageH":2455,
           "viewportW":1280,"viewportH":720,"count":1}]
```

`mode: "scroll"` :

```json
"scroll":{"buckets":[{"depth":70,"sessions":1,
                      "pageW":1265,"pageH":2455,
                      "viewportW":1280,"viewportH":720}],
          "totalSessions":1,"pageW":1265,"pageH":2455,
          "viewportW":1280,"viewportH":720}
```

**Les deux modes remplissent des champs différents du même objet.** En
`click`, `scroll.buckets` reste vide ; en `scroll`, `points` reste vide. Un
client qui lit toujours `points` conclut que le mode `scroll` ne marche pas.

`depth` est une profondeur par paliers de 10 points, `sessions` le nombre de
sessions qui l'ont atteinte. Les deux modes rendent `pages` — avec des
`count` différents, puisqu'ils comptent des choses différentes (3 clics
contre 2 défilements sur la même page, mesuré).

## Le fond de carte est un **iframe du site en direct**, pas une capture

C'est le point le moins évident, et celui qui explique la plupart des cartes
illisibles. Le champ `snapshot` :

```json
"snapshot":{"kind":"iframe",
            "id":"iframe:888d9084-…:/:1280x720",
            "url":"http://localhost/",
            "pageW":1265,"pageH":2455,
            "viewportW":1280,"viewportH":720}
```

Umami ne stocke aucune image ni aucun DOM de la page. Il **recharge le site**
dans un iframe et pose les points par-dessus. Et l'URL n'est pas celle qui a
été enregistrée : elle est **reconstruite à partir du champ `domain` du
site**. Mesuré, en changeant ce seul champ :

| `domain` du site | `snapshot.url` |
|---|---|
| `localhost` | `http://localhost/` |
| `exemple.test` | `https://exemple.test/` |

Le schéma est déduit (`http` pour `localhost`, `https` sinon) et **le port est
perdu** — mes clics venaient de `http://127.0.0.1:4455/`, le fond pointait
`http://localhost/`.

Quatre conséquences, toutes vérifiables en une minute :

1. **Un `domain` approximatif rend la carte inutilisable.** Le fond charge un
   autre site, ou rien. C'est la première chose à regarder devant une carte
   vide ou fausse — pas la collecte.
2. **Un site sur un port non standard ne peut pas avoir de fond correct.** En
   développement local, c'est la situation normale.
3. **Un site qui refuse d'être encadré n'affiche aucun fond.** `X-Frame-Options:
   DENY|SAMEORIGIN` ou un `frame-ancestors` qui ne cite pas l'origine d'Umami
   suffisent. Le site de ce dépôt n'émet aucun de ces en-têtes aujourd'hui —
   ajouter une CSP durcie casserait les heatmaps, sans rapport visible avec la
   cause.
4. **Le fond montre la page d'aujourd'hui.** Refaire la maquette d'une page
   déplace tous les points d'hier sans les invalider. Une carte de chaleur
   n'est lisible que tant que la page n'a pas bougé — et rien dans la réponse
   ne signale qu'elle a bougé.

Les points sont regroupés par taille de fenêtre : `1280x720` est dans l'`id`
du snapshot. Deux visiteurs aux fenêtres différentes ne se superposent pas
sur le même fond.

## Ce qui l'empêche de marcher, par ordre de fréquence

1. **`urlPath` manquant** dans la requête — voir plus haut. `200`, `points: []`.
2. **`heatmapEnabled` est faux** alors que `replayEnabled` est vrai. Les deux
   interrupteurs sont séparés ; `recorderEnabled: true` et un `recorder.js`
   chargé ne prouvent **rien** sur les heatmaps. Le contrôle qui tranche est
   `GET /api/websites/{id}/recorder`, sans authentification.
3. **Le tirage à 15 %.**
4. **Des clics simulés.** `isTrusted` obligatoire : un test end-to-end qui
   pilote la page par JavaScript ne produira jamais de point.
5. **`script.js` absent** — le collecteur de heatmaps a besoin, comme
   l'enregistreur, du jeton de session posé par le script de comptage
   ([`../umami-replays/SKILL.md`](../umami-replays/SKILL.md)).
6. **Le lot n'est pas encore parti** : 20 événements ou 5 secondes, et
   beaucoup plus dans un onglet en arrière-plan.

## Le coût : négligeable, à une exception près

La collecte elle-même ne pèse presque rien : une ligne d'entiers par clic et
par palier de défilement dans `heatmap_event`, pas de `bytea`, pas de DOM.
Sans commune mesure avec les ~81 ko compressés qu'une seule visite écrit en
replay sur la page d'accueil de ce dépôt.

**L'exception est le script.** Activer les heatmaps seules charge quand même
tout `recorder.js` — **190 816 o, 58 700 o gzip**, contre 4 733 o pour
`script.js` — puisque c'est le même fichier. On paie le poids d'un
enregistreur rrweb complet pour collecter des paires de coordonnées. Si le
budget de performance est la contrainte, c'est ce chiffre qui décide, pas le
volume en base.

Et comme pour le comptage, `POST /api/record` **n'exige aucun compte** : un
`POST /api/send` non authentifié rend le jeton `x-umami-cache` qui ouvre la
porte. Un point de chaleur fabriqué est indiscernable d'un vrai — vérifié en
posant un clic à `(11, 22)` sur un chemin inventé, qui est ressorti tel quel
dans le rapport.

## Ce qui n'a pas été vérifié

- **Le rendu dans l'interface** — le fond en iframe est déduit du champ
  `snapshot` rendu par l'API, il n'a pas été observé à l'écran. Que
  `kind: "iframe"` existe suggère d'autres valeurs de `kind` ; aucune autre
  n'a été rencontrée.
- **La règle exacte des paliers de `depth`** : un seul palier (`70`) a été
  produit. Le pas de 10 est déduit, pas mesuré sur une série.
- **`rr-block` et `blockSelector`** masquent le DOM dans les replays ; rien
  n'indique qu'ils empêchent la collecte d'un clic *sur* la zone bloquée, et
  ça n'a pas été testé. Ne pas supposer qu'ils protègent les heatmaps.
- Rien n'a été testé contre **Umami Cloud**.
