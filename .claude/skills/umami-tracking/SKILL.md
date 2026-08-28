---
name: umami-tracking
description: Use when getting data INTO Umami — the browser script.js, its data-* attributes, window.umami.track / identify, custom events, tags, distinct IDs, server-side hits, or POST /api/send. Also use when events never appear in the dashboard, when a page is counted twice or not at all in a SPA, when event properties come back with the wrong type, when an ad blocker eats the script, when a hit lands on the wrong date, or when deciding whether Umami can be trusted as a source of truth.
---

# Faire entrer des données dans Umami 3

Vérifié contre une instance **3.3.1 auto-hébergée** : `/api/send` frappé
directement, et le `script.js` réellement servi par cette version lu ligne à
ligne. La liste d'attributs ci-dessous vient du script livré, pas de la doc.

Pour le branchement Umami *de ce dépôt* (`Analytics.astro`, variables de
build), voir [`../analytics-umami/SKILL.md`](../analytics-umami/SKILL.md).

## Le point qui décide de la confiance qu'on accorde aux chiffres

**`/api/send` n'exige aucune authentification, et n'inspecte pas l'origine
de l'appel.**

Mesuré : un `POST` avec `hostname: "evil.example"` sur un site déclaré
`probe.example` est accepté (`200`) et compté. Le seul secret est
l'identifiant du site — qui est **public par construction**, écrit dans le
`data-website-id` de chaque page.

Et le pire, plus bas : `timestamp` est honoré. N'importe qui peut donc
écrire dans l'historique, à la date de son choix.

Conséquence à tenir : les chiffres d'Umami sont une **indication d'audience**,
jamais une source de vérité pour de la facturation, un quota ou une décision
qui ne se rattrape pas. Ce n'est pas un défaut de configuration : c'est le
modèle d'un traqueur sans cookie ni compte.

## `/api/send` — la forme réelle

```http
POST /api/send
Content-Type: application/json

{"type":"event",
 "payload":{"website":"<uuid>","url":"/a","hostname":"…","title":"…",
            "language":"fr","screen":"1920x1080","referrer":"…",
            "name":"signup","data":{…},"tag":"variant-b","id":"user-7",
            "timestamp":1600000000}}
```

- `type` admet exactement `event` | `identify` | `performance`. Absent →
  `400` qui énumère les trois. `performance` est peu documenté et sert aux
  Core Web Vitals.
- Réponse : `{"cache":"<JWT>"}`. Le JWT porte en clair `{websiteId,
  sessionId, visitId}` — utile pour déboguer *quelle* session a été
  attribuée. Le renvoyer en en-tête `x-umami-cache` sur les hits suivants
  épargne à Umami de recalculer la session.
- Site inconnu → `400 {"message":"Website not found."}`. UUID malformé →
  `400 Invalid UUID`. Ce sont les deux seuls refus rencontrés.
- L'absence de `User-Agent` ne bloque rien : le hit est compté, dans une
  session à part.

### `timestamp` est en **secondes**, et la doc d'API dit millisecondes

La page tracker dit « UNIX seconds », la page API dit « timestamp is in
milliseconds ». Mesuré, les deux dans la même instance :

```
timestamp: 1600000000     → événement daté 2020-09-13   ✅ secondes
timestamp: 1600000000000  → 200, puis createdAt = null  ❌ ligne inexploitable
```

La forme « documentée » côté API **répond 200 et écrit une ligne datée nulle
part** : invisible dans toute fenêtre normale, retrouvable seulement en
interrogeant jusqu'à l'an 52680. Perte de données silencieuse, du bon côté
du code de statut. Suivre la page tracker : secondes.

### Les codes `dataType` : la doc intervertit 3 et 4

Envoi contrôlé de `{"s":"hello","n":1.5,"b":false,"d":"2026-01-02T03:04:05Z"}`,
relu par `/event-data/fields` :

| Valeur | `dataType` réel | Ce que dit la doc |
|---|---|---|
| chaîne | 1 | 1 ✅ |
| nombre | 2 | 2 ✅ |
| **booléen** | **3** | 4 ❌ |
| **date ISO** | **4** | 3 ❌ |

Umami **infère** le type d'après la valeur : une chaîne qui ressemble à une
date ISO devient une date, pas une chaîne. Une propriété dont la valeur est
tantôt `"2026-01-02"` tantôt `"bientôt"` change de `dataType` selon les
lignes, et les agrégations sur cette propriété se scindent en silence.

### Où atterrissent les autres champs

- `name` → événement nommé, `eventType: 2` (une vue de page est `eventType:
  1`). Visible dans `/metrics?type=event`.
- `data: {…}` → `/event-data/events` et `/event-data/fields`.
- `tag` → `/metrics?type=tag`. C'est le mécanisme d'A/B testing.
- `type: "identify"` avec `id` et `data` → `/session-data/properties`.
  L'identité est attachée à la **session**, pas rétroactivement à l'historique.

## Le traqueur navigateur — les attributs qui existent vraiment

Extraits du `script.js` servi par 3.3.1. Ce sont les **douze** que le script
lit ; tout autre `data-*` est décoratif.

| Attribut | Effet | Défaut |
|---|---|---|
| `data-website-id` | l'UUID du site — le seul obligatoire | — |
| `data-host-url` | où poster ; sinon le dossier du `src` du script + `/api/send` | dérivé du `src` |
| `data-auto-track` | désactivé par la **chaîne** `"false"` | actif |
| `data-auto-pageview` | idem ; garde le reste du traqueur vivant | actif |
| `data-do-not-track` | respecte le DNT du navigateur si `"true"` | inactif |
| `data-exclude-search` | retire la query string des URL si `"true"` | inactif |
| `data-exclude-hash` | retire le fragment si `"true"` | inactif |
| `data-domains` | liste séparée par virgules ; hors liste, rien n'est envoyé | tous |
| `data-tag` | étiquette tous les hits de la page | — |
| `data-performance` | Core Web Vitals si `"true"` | **inactif** |
| `data-fetch-credentials` | mode `credentials` du `fetch` | `"omit"` |
| `data-before-send` | nom d'une fonction globale qui filtre/modifie chaque hit | — |

Deux asymétries que le code rend explicites et qui piègent :

- Les interrupteurs **par défaut actifs** (`auto-track`, `auto-pageview`) ne
  se coupent qu'avec la chaîne exacte `"false"` ; ceux **par défaut
  inactifs** ne s'allument qu'avec `"true"`. `data-do-not-track="1"` ou
  `data-auto-track=""` ne font rien.
- `data-performance` est **inactif par défaut** : c'est pourquoi le rapport
  `performance` rend des zéros sur un site pourtant instrumenté
  ([`../umami-reports-api/SKILL.md`](../umami-reports-api/SKILL.md)).

Événements déclaratifs : `data-umami-event="nom"` sur un élément, et chaque
`data-umami-event-<clé>="valeur"` devient une propriété. C'est la seule
famille `data-*` à motif ouvert.

## Ce qui empêche les hits d'arriver, par ordre de fréquence

1. **Le script n'est pas dans la page.** Le contrôle qui tranche en une
   ligne, avant toute autre hypothèse :
   ```bash
   curl -s https://<le site>/ | grep -o 'data-website-id="[^"]*"'
   ```
   Rien : le problème est en amont du traqueur. Dans ce dépôt, c'est presque
   toujours une variable `PUBLIC_UMAMI_*` absente **au build** — Astro les
   fige dans le bundle.
2. **`data-domains` ne contient pas l'hôte courant.** Le script se tait, sans
   rien écrire en console.
3. **Un bloqueur mange `/script.js`.** Le nom de fichier et le chemin sont
   dans toutes les listes. Le contournement est un proxy sur son propre
   domaine (`TRACKER_SCRIPT_NAME`, `COLLECT_API_ENDPOINT` côté serveur) —
   servir le script depuis l'origine du site, pas depuis celle d'Umami.
4. **Auto-désactivation locale** : `localStorage["umami.disabled"] = 1`
   coupe l'envoi pour ce navigateur. Posée un jour pour tester, elle survit
   et explique un « je ne suis jamais compté ».
5. **`localhost` n'est pas exclu.** L'idée est répandue et fausse : mesuré,
   `POST /api/send` depuis `http://127.0.0.1` répond `200` et compte.
   Devant un zéro en local, chercher la variable manquante, pas un filtre
   d'Umami.

## SPA et navigation côté client

Le traqueur suit l'History API et compte une vue par changement d'URL. Les
deux ennuis usuels :

- **Double comptage** au premier rendu si le framework remplace l'URL au
  montage : la vue initiale et le `replaceState` en font deux. Couper avec
  `data-auto-pageview="false"` et appeler `umami.track()` soi-même là où la
  route est réellement stable.
- **Rien du tout** si le routeur ne touche pas l'History API.

`window.umami` expose `track` et `identify` (vérifié dans le script servi).
`umami.track()` sans argument envoie une vue ; avec une chaîne, un événement
nommé ; avec un objet ou une fonction, une charge utile complète.

## Envoyer depuis un serveur

Rien d'autre que `POST /api/send` — c'est le même point d'entrée. Deux
choses à poser explicitement, qu'un navigateur fournirait :

- un `User-Agent` : c'est un ingrédient du hachage de session. Le même pour
  tous les appels serveur écrase tout le trafic dans **une seule session**,
  et les visiteurs uniques s'effondrent à 1.
- `hostname`, `language`, `screen`, `referrer` si l'on veut que les
  ventilations correspondantes existent.

L'adresse IP vue par Umami est celle de l'appelant : depuis un serveur, tout
le trafic paraît venir du même endroit, et la géographie devient un seul
point. `/metrics?type=country` rendait `[]` sur l'instance de test, la
résolution GeoIP n'ayant rien à mordre sur des adresses locales.
