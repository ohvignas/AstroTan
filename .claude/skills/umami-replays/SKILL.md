---
name: umami-replays
description: Use when turning on, reading, deleting or defending Umami session replays — recorder.js, replayConfig, maskLevel, GET /api/websites/{id}/replays, POST /api/record. Also use when recorder.js loads but no recording ever appears, when recorderEnabled refuses to change through POST /api/websites/{id}, when only some visits are recorded, when a recording stops after five minutes, when someone asks to delete one recording for a GDPR erasure request, or when deciding whether replays need a consent banner.
---

# Les enregistrements de session d'Umami 3

Vérifié contre une instance **3.3.1 auto-hébergée** : `recorder.js` réellement
servi et lu ligne à ligne, un site jetable créé puis supprimé, une session
enregistrée dans un vrai navigateur avec **interception des requêtes sortantes**,
et la base PostgreSQL interrogée directement.

Le branchement Umami *de ce dépôt* (variables `PUBLIC_UMAMI_*`, `Analytics.astro`)
est décrit ailleurs et n'est pas repris ici :
[`../analytics-umami/SKILL.md`](../analytics-umami/SKILL.md) §« Replays et
Heatmaps », et [`../umami-setup/SKILL.md`](../umami-setup/SKILL.md) pour l'ordre
de mise en service. Les cartes de chaleur, qui partagent le même script mais
presque rien d'autre : [`../umami-heatmaps/SKILL.md`](../umami-heatmaps/SKILL.md).

## Ce qu'un replay envoie réellement — la seule section à ne pas sauter

**Un replay n'est pas une statistique. C'est une copie du DOM de la page,
rejouable, plus la trace horodatée de tout ce que la personne y a fait.**
Ce n'est pas une formule prudente : c'est ce qui a été mesuré sur le réseau.

`recorder.js` est **rrweb** empaqueté. Il poste sur `POST /api/record` :

```json
{"type":"record",
 "payload":{"website":"<uuid>",
            "timestamp":1787950306,
            "events":[ /* événements rrweb bruts */ ]}}
```

en-têtes : `Content-Type: application/json` et `x-umami-cache: <JWT>`.

### Le texte de la page part en clair

Charge utile observée, extraite d'un instantané complet (`type: 2`) capté
sur le réseau :

```json
{"type":2,"tagName":"input",
 "attributes":{"id":"nom","type":"text","name":"nom","value":""},
 "childNodes":[],"id":29}
```

Tout le corps du document est sérialisé : balises, attributs, **et chaque
nœud de texte**. Un paragraphe visible à l'écran se retrouve tel quel dans
la charge utile — mesuré, puis relu dans la réponse de l'API. Les feuilles
de style sont **incorporées** (`inlineStylesheet: true`), d'où le poids.

### Les champs de formulaire sont masqués — mais leur longueur part

C'est le point qui décide de ce qu'on peut écrire dans une politique de
confidentialité. Saisie contrôlée dans trois champs, puis lecture des
paquets sortants :

| Saisi | Champ | Ce qui part |
|---|---|---|
| `jean.dupont@exemple.fr` (22 car.) | `<input type="text">` | `"**********************"` (22) |
| `MotDePasseSecret42` (18 car.) | `<input type="email">` | `"******************"` (18) |
| `message confidentiel` (20 car.) | `<input type="password">` | `"********************"` (20) |

Le contenu, non. **La longueur exacte, oui** — rrweb remplace la valeur par
`"*".repeat(valeur.length)`. Et il émet **un événement par événement
`input`**, pas un à la fin :

```json
{"source":5,"id":41,"isChecked":false,"text":"*"}
{"source":5,"id":41,"isChecked":false,"text":"**"}
{"source":5,"id":41,"isChecked":false,"text":"***"}
```

Chacun horodaté. Le replay restitue donc **la cadence de frappe et le nombre
exact de caractères**, y compris pour un mot de passe : hésitations,
corrections, longueur. Ce n'est pas le mot de passe, ce n'est pas rien non
plus. Le dire tel quel dans une analyse d'impact vaut mieux que de répéter
« les saisies sont masquées » et de se faire relire.

Vérifié aussi côté serveur : la réponse de
`GET /api/websites/{id}/replays/{visitId}` contient bien le texte de la page
et les chaînes d'astérisques, et ne contient aucune des valeurs saisies.

### Ce qui n'est jamais envoyé

Codé en dur dans le `recorder.js` de 3.3.1, non configurable :

- **`recordCanvas: false`** — le contenu des `<canvas>` n'est pas capté.
- **`recordCrossOriginIframes: false`** — un iframe d'une autre origine reste
  vide dans le replay.
- `slimDOMOptions` retire les `<script>`, les commentaires, et les `<meta>`
  de description, réseaux sociaux, robots, `http-equiv`, auteur, vérification.
- Ce que le navigateur ne met pas dans le DOM n'y est pas : en-têtes HTTP,
  cookies, `localStorage`.

## Les trois classes CSS qui marchent, et qu'Umami ne documente pas

Umami ne surcharge pas les sélecteurs par défaut de rrweb. Elles fonctionnent
donc, **et ce sont les seuls leviers page par page** :

| Classe | Effet | Vérifié |
|---|---|---|
| `rr-block` | l'élément et sa descendance sont remplacés par un rectangle vide | oui — `CONTENU-DANS-RR-BLOCK` absent de la charge utile |
| `rr-mask` | le texte de l'élément est remplacé par des `*` | oui — `TEXTE-AVEC-CLASSE-RR-MASK` absent |
| `rr-ignore` | les événements de saisie de l'élément ne sont pas émis | attesté par le code, non mesuré |

`blockSelector` (dans `replayConfig`) ajoute un sélecteur CSS libre à
`rr-block`. C'est le seul des quatre qui se pose côté serveur, et donc le
seul qui s'applique sans redéployer le site.

**Ce que rien ne masque, en revanche : le texte statique de la page.** En
`moderate`, un nom déjà affiché par le serveur — « Bonjour Jean Dupont »,
un numéro de commande, une adresse dans un récapitulatif — part en clair.
Le masquage d'Umami protège ce que la personne **tape**, pas ce que la page
lui **montre**.

## L'interrupteur : `recorderEnabled` est en lecture seule

C'est le piège qui fait perdre une demi-heure. `POST /api/websites/{id}` avec
`{"recorderEnabled": true}` répond **`200`, renvoie l'objet inchangé, et
n'écrit rien.** Aucune erreur, aucun champ refusé. `POST` et `PUT` sur
`/api/websites/{id}/recorder` répondent `405`.

Le champ qui s'écrit est **`replayConfig`** :

```bash
curl -X POST "$UMAMI/api/websites/$ID" -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' \
  -d '{"replayConfig":{"replayEnabled":true,"maskLevel":"strict",
                       "sampleRate":1,"maxDuration":300000,"blockSelector":""}}'
```

`recorderEnabled` est **dérivé** : mesuré, il vaut `replayEnabled ||
heatmapEnabled` et bascule tout seul dans les deux sens. Ne pas essayer de le
poser ; le lire suffit.

Deux comportements de l'écriture, mesurés :

- **Elle fusionne.** Un `POST` qui ne porte que `{"replayEnabled":false}`
  conserve `maskLevel`, `sampleRate`, `maxDuration` déjà en base.
- **Elle ne stocke pas les `false`.** `replayEnabled: false` fait *disparaître*
  la clé du JSON stocké. Un code qui lit `replayConfig.replayEnabled` doit
  traiter « absent » comme « faux ».

La validation est stricte et parlante :

```
maskLevel  → Invalid option: expected one of "strict"|"moderate"
sampleRate → Too big: expected number to be <=1
```

**`maskLevel` n'a que deux valeurs. Il n'existe pas de niveau « aucun
masquage ».** C'est le seul bon défaut de cette fonctionnalité.

## Les valeurs par défaut, et celle qui surprend

Lues dans le `recorder.js` servi (elles s'appliquent aussi quand le serveur
omet le champ) :

| Réglage | Défaut | Ce que ça veut dire |
|---|---|---|
| `sampleRate` | **`0.15`** | **15 % des chargements de page sont enregistrés** |
| `heatmapSampleRate` | `0.15` | idem, tiré séparément |
| `maskLevel` | `moderate` | saisies masquées, texte de la page en clair |
| `maxDuration` | `300000` | l'enregistrement s'arrête **au bout de 5 minutes** |
| `blockSelector` | `""` | rien de bloqué en plus |

Ce sont aussi les valeurs que l'interface écrit quand on active l'interrupteur
sans y toucher — le site de ce dépôt porte exactement ce jeu.

Les deux conséquences qui font croire à une panne :

- **« Je viens de visiter le site, il n'y a pas d'enregistrement. »** Une
  chance sur sept. Le tirage est `Math.random() <= sampleRate`, fait **une
  fois par chargement de page** et indépendamment pour les replays et les
  heatmaps. Pour tester, poser `sampleRate: 1`. `sampleRate: 0` n'enregistre
  jamais — utile pour couper sans rien démonter.
- **« L'enregistrement se coupe au milieu. »** `maxDuration` est atteint : au
  bout de 5 minutes le recorder s'arrête **définitivement pour cette page**,
  sans rien signaler. Une page longue (formulaire, lecteur vidéo, tableau de
  bord) n'est enregistrée que sur ses cinq premières minutes.

## Ce qui l'empêche de marcher, par ordre de fréquence

1. **`script.js` manque.** `recorder.js` ne sait pas ouvrir de session : il
   lit `window.umami.getSession().cache` et met ce JWT en en-tête
   `x-umami-cache`. Sans le script de comptage il réessaie **50 fois toutes
   les 100 ms, puis abandonne en silence** au bout de 5 secondes. Un bloqueur
   qui mange `script.js` mais laisse passer `recorder.js` produit exactement
   ça : le second script est chargé, et rien n'est enregistré.
2. **L'interrupteur serveur est éteint.** Le recorder appelle
   `GET /api/websites/{id}/recorder` ; si la réponse est `{"enabled":false}`,
   il s'arrête là. C'est le contrôle qui tranche, et il **ne demande aucune
   authentification** :
   ```bash
   curl -s "$UMAMI/api/websites/$ID/recorder"
   # {"enabled":true,"replayEnabled":true,"heatmapEnabled":false,
   #  "sampleRate":0.15,"heatmapSampleRate":0.15,"maskLevel":"moderate",
   #  "maxDuration":300000,"blockSelector":""}
   ```
   Corollaire à assumer : **votre `blockSelector` est public.** Il nomme les
   sélecteurs des zones que vous jugez sensibles. Ne pas y écrire un secret.
3. **Le tirage d'échantillonnage.** Voir plus haut.
4. **L'onglet est en arrière-plan.** Les envois sont pilotés par des `setTimeout`
   (vidage toutes les 2 s), que le navigateur ralentit fortement dans un onglet
   caché. Mesuré : une interaction dans un onglet jamais affiché n'est partie
   que plusieurs dizaines de secondes plus tard, d'un coup. Rien n'est perdu —
   `visibilitychange`, `pagehide` et `beforeunload` forcent un vidage, avec
   `keepalive` si le paquet fait moins de 60 ko — mais l'horloge du tableau de
   bord et celle du visiteur divergent.
5. **La page n'a pas fini de charger.** Le recorder n'accroche rien avant
   `document.readyState === "complete"`.

## Lire les enregistrements par API

```bash
GET /api/websites/{id}/replays?startAt=<ms>&endAt=<ms>
```

```json
{"data":[{"id":"0d2946ce-…","sessionId":"e630d0cd-…","websiteId":"888d9084-…",
          "browser":"chrome","os":"Mac OS","device":"laptop",
          "country":null,"city":null,
          "eventCount":13,"chunkCount":5,
          "startedAt":"2026-08-28T21:00:47.369Z",
          "endedAt":"2026-08-28T21:01:21.366Z",
          "duration":151,"createdAt":"2026-08-28T21:01:22.381Z"}],
 "count":1,"page":1,"pageSize":20,"isCapped":false}
```

Trois choses que la forme ne dit pas :

- **`id` est un *visit* id, pas un `sessionId`.** Mesuré : deux lignes
  portaient le même `sessionId`. **Un enregistrement = une visite**, et une
  session en contient plusieurs. Regrouper par `sessionId` pour retrouver une
  personne, pas par `id`.
- **`createdAt` est la date de dernière écriture**, pas de création : il
  avance avec `endedAt` tant que la visite continue.
- **`duration` ne vaut pas `endedAt - startedAt`.** Mesuré : `151` pour un
  intervalle de 34 s, `2038` pour 179 s. Ne pas l'afficher comme la durée de
  la visite sans avoir vérifié ce qu'il compte — je ne l'ai pas établi.

Filtres acceptés sur la liste (mesurés) : `browser=`, `os=`, `path=`, et un
`search=` générique. Un filtre qui ne correspond à rien rend `count: 0`, pas
une erreur.

Le contenu d'un enregistrement :

```bash
GET /api/websites/{id}/replays/{visitId}
# → {"sessionId":…,"events":[…39 événements rrweb…],
#    "startedAt":…,"endedAt":…,"eventCount":39,"chunkCount":13}
```

L'API décompresse et recolle les fragments : `events` est un tableau JSON
prêt à rejouer. **Se tromper de chemin ne rend pas `404` mais du HTML** —
`/api/replays/{id}` renvoie la page Next.js de l'application. Un client qui
fait `.json()` dessus échoue sur un message qui ne parle pas d'URL.

`GET /api/websites/{id}/replays/saved` liste les enregistrements épinglés
(table `session_replay_saved`, un par visite, avec un nom). **En lecture
seule : `POST` rend `405`** — l'épinglage se fait depuis l'interface.

### Le délai : il n'y en a pas

Mesuré au poll seconde par seconde : l'enregistrement apparaît dans
`/replays` **quelques secondes après le chargement de la page**, pendant que
la visite est encore en cours, puis `eventCount` grossit sur place toutes les
~2 s. Il n'y a ni traitement différé, ni attente de fin de session. Un
enregistrement en cours est lisible.

## Supprimer : il n'existe aucune suppression unitaire

À vérifier avant de promettre quoi que ce soit à quelqu'un qui exerce un
droit à l'effacement. Mesuré :

```
DELETE /api/websites/{id}/replays/{visitId}   → 405
DELETE /api/websites/{id}/replays             → 405
DELETE /api/replays/{visitId}                 → 404 (HTML)
```

Le seul chemin qui fonctionne :

```bash
DELETE /api/websites/{id}/sessions/{sessionId}   # → 200
```

**Et il emporte tout le reste de la session.** Vérifié juste après : les
replays disparaissent, mais aussi la session, ses vues de page
(`/stats` retombe à `pageviews: 0`) et ses points de carte de chaleur. On ne
peut pas retirer l'enregistrement d'une personne en gardant sa visite dans les
compteurs. C'est un arbitrage à connaître **avant** de recevoir la demande,
pas pendant.

Les deux autres leviers restent `POST /api/websites/{id}/reset` (tout le site)
et la suppression du site.

**Aucun mécanisme de rétention automatique n'a été trouvé** : pas de variable
d'environnement, table `app_setting` vide sur cette instance. Sans purge
écrite à la main, les enregistrements s'accumulent.

## Le coût, mesuré

| | Valeur |
|---|---|
| `script.js` | 4 733 o (2 296 o gzip) |
| `recorder.js` | **190 816 o (58 700 o gzip)** — 40× le premier |
| Cache HTTP | `public, max-age=86400, must-revalidate` |
| Réseau, page de 1,5 ko, ~30 s d'interaction | **17 requêtes, 12,8 ko de JSON** |
| Base, page réelle de ce dépôt (15,7 ko HTML + 4,3 ko CSS) | **81 131 o gzip pour une visite de 5 événements** |

Ce dernier chiffre est le bon ordre de grandeur à retenir : **une visite
quasi immobile sur l'accueil coûte environ quatre fois le poids de la page,
compressé**, parce que l'instantané complet incorpore toute la feuille de
style. Et un instantané complet est repris **toutes les 30 secondes**
(`checkoutEveryNms`).

Structure en base : `session_replay`, **une ligne par requête réseau**
(`chunk_index`), colonne `events` en `bytea` **gzip** (`1f8b08…`), et
**huit index**. 29 lignes occupaient 304 ko de table + index — sur des
fragments de quelques kilo-octets, la structure pèse autant que la donnée.

**Conséquence sur la sauvegarde** : la table de replays devient rapidement le
plus gros objet du dump PostgreSQL, et c'est aussi le plus sensible. Une
sauvegarde qui partait chez un tiers sans que ça pose question ne part plus
dans les mêmes conditions.

## `/api/record` est aussi forgeable que `/api/send`

Deux appels suffisent, sans aucun compte :

```bash
CACHE=$(curl -s -X POST "$UMAMI/api/send" -H 'Content-Type: application/json' \
  -d '{"type":"event","payload":{"website":"'"$ID"'","hostname":"forge.example","url":"/forge"}}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["cache"])')

curl -X POST "$UMAMI/api/record" -H 'Content-Type: application/json' \
  -H "x-umami-cache: $CACHE" -d '{"type":"record","payload":{…}}'
# → {"ok":true}
```

Sans l'en-tête : `400 {"message":"Missing session token."}`. C'est la seule
barrière, et elle s'obtient gratuitement avec l'identifiant public du site.
Un enregistrement fabriqué est indiscernable d'un vrai. Même conclusion que
pour le comptage ([`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)) :
c'est une indication, jamais une preuve.

## La décision, pas la configuration

Avant d'allumer, trois phrases qui ont été vérifiées et qu'il faut pouvoir
tenir :

1. **Ce qui est collecté est du contenu de page et du comportement**, pas un
   compteur agrégé. Le texte affiché part en clair ; la frappe part en
   longueur et en cadence.
2. **Un visiteur sur sept est filmé** avec les réglages par défaut, sans
   qu'aucun élément de l'interface ne le lui dise.
3. **Un enregistrement ne se supprime pas seul** : effacer, c'est effacer la
   visite entière, chiffres compris.

Ce qui rend la position défendable, dans l'ordre de ce qui coûte le moins :
`maskLevel: "strict"` (masque aussi tout le texte de la page —
`maskTextSelector: "*"`), un `blockSelector` sur les zones de compte et de
paiement, un `sampleRate` bas assumé, et une purge écrite à la main puisqu'il
n'en existe aucune.

## Ce qui n'a pas été vérifié

- **`maskLevel: "strict"` n'a pas été mesuré sur le réseau.** Le code lu dit
  `{maskAllInputs: true, maskTextSelector: "*"}` là où `moderate` ne pose que
  `maskAllInputs: true` — donc « strict = tout le texte masqué en plus ». La
  charge utile correspondante n'a pas été capturée.
- **`rr-ignore`** est attesté dans le code (défaut rrweb non surchargé), pas
  observé.
- **Le champ `duration`** de la liste : son unité n'a pas été établie.
- **Le lecteur de l'interface** (rendu du replay dans le tableau de bord) n'a
  pas été ouvert ; tout ci-dessus vient du réseau, de l'API et de la base.
- Rien n'a été testé contre **Umami Cloud**.
