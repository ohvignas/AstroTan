# Umami et DataForSEO — fiches et dashboard

**Date** : 31 août 2026
**Statut** : design tranché par Antoine, prêt à planifier
**Remplace** : le §8 (« Passe 2 ») de
[`2026-08-31-seo-et-pixel-design.md`](2026-08-31-seo-et-pixel-design.md)
**Invariants** : [`2026-08-27-astrotan-design.md`](2026-08-27-astrotan-design.md),
[`2026-08-29-secrets-et-chiffrement.md`](2026-08-29-secrets-et-chiffrement.md),
skill `consent-rgpd`

Cette livraison pose les **chiffres** sur deux surfaces déjà là : le
panneau `AnalyticsPanel` des fiches (`$pageId`, `$postId`) et la carte
`SiteDashboard` de l'accueil. Les identifiants DataForSEO vivent déjà à
`/settings/mesure`. Ici on les **appelle**, on **range** le résultat, on
**l'affiche**. On n'ajoute ni Google Search Console, ni score sur 100, ni
visibilité IA, ni trafic estimé DataForSEO, ni backlinks par URL.

## 1. Objectif

Un adoptant ouvre une fiche page ou article et lit, en une ligne, quatre
chiffres côte à côte : l'audience Umami de cette URL, et le rang du mot-clé
qu'il a choisi pour elle. Il ouvre l'accueil et voit la courbe Umami du
site, trois pastilles DataForSEO à côté, puis quatre listes en bas.

Deux sources, jamais mélangées sur le même axe :

| Source | Ce qu'elle dit | Ce qu'elle ne dit pas |
|---|---|---|
| Umami | Qui est venu, d'où, quelles pages | Un rang Google |
| DataForSEO | Où se trouve le mot-clé, quels mots et quelles pages sortent déjà, les backlinks du **domaine** | Un visiteur, un cookie, un pixel |

Rien de tout cela n'entre dans le navigateur d'un visiteur. `consentVersion`
reste `1.0.0`.

## 2. Décisions, et ce qu'elles ferment

| Décision | Conséquence |
|---|---|
| Un seul `targetKeyword` par page et par article | Jamais une liste. Jamais dans `seo`. Jamais dans le HTML. |
| Pas de courbe sur la fiche | `AnalyticsPanel` ne monte pas `CourbeAudience`. Quatre indicateurs, une ligne. |
| Pas de dual-axis rang sur l'accueil | `CourbeAudience` reste Umami (pages vues + visiteurs). Le rang n'y entre pas. |
| Backlinks = domaine, 1 appel / semaine | Autre endpoint que le SERP. Pas de backlinks par URL sur la fiche. |
| Relever n'est jamais un effet de l'ouverture | `PageAnalytics` continue d'appeler `analytics.forPath` (Umami). Aucun appel DataForSEO au montage. |
| Throttle 1 h sur Relever | Le cron du lundi n'est pas un Relever : il a son propre rythme. |
| Brouillon : pas de relevé auto | Le cron saute `status !== "published"`. Le bouton Relever est inactif. |
| Sans clés DataForSEO | Sur l'accueil : aucune pastille, aucune liste DataForSEO — pas de carte vide. Les deux listes Umami restent. Sur la fiche : l'état « DataForSEO absent » avec un lien vers `/settings/mesure`. |
| Pas de GSC, pas de score /100, pas d'AI visibility, pas de trafic estimé DFS | Aucun écran, aucun champ, aucun appel pour ces quatre-là. |

## 3. Fiches `$pageId` et `$postId`

Les deux routes gardent `PageAnalytics`. Le chemin mesuré ne change pas :
`publicPath(page.slug, homePageSlug)` pour une page (et `null` tant que
`homePageSlug` n'est pas arrivé), `/blog/${post.slug}` pour un article.

`AnalyticsPanel` reste une fonction pure de ses props. `PageAnalytics`
cherche : Umami via l'action déjà là, le rang via une **query** sur
`seoRanks` (pas une action — le dernier relevé est en base). Le bouton
Relever déclenche une action, et rien d'autre.

### 3.1 Les quatre indicateurs

Une ligne, `grid` à quatre colonnes dès `sm`. Pas de courbe. Chaque
cellule est un `Indicateur` : libellé, chiffre en `tabular-nums`,
`FlecheTendance`.

| # | Libellé | Source | Chiffre | Flèche |
|---|---|---|---|---|
| 1 | Vues 7 j | Umami `last7.pageviews` | l'entier, y compris 0 | vs les 7 jours d'avant (`compare=prev`, déjà lu par `siteSummary`, pas encore par `forPath`) |
| 2 | Visiteurs 30 j | Umami `last30.visitors` | l'entier, y compris 0 | vs les 30 jours d'avant |
| 3 | Position | `seoRanks.position` | le rang 1–100, ou l'état §3.3 | vs `seoRanks.previousPosition` |
| 4 | Écart vs sem. préc. | `previousPosition − position` | entier signé (négatif = on a gagné des places) | même sens que le signe une fois inversé pour le rang |

Le quatrième n'est **pas** un compteur de backlinks. C'est l'écart de
**rang** d'une semaine sur l'autre pour **ce** mot-clé sur **cette** URL.

`analytics.forPath` s'étend : `last7` et `last30` portent `pageviewsPrev` et
`visitorsPrev` (`null` si Umami n'a pas rendu `comparison`). Les tests
d'`AnalyticsPanel` qui attendent « 7 derniers jours » / deux fenêtres
empilées sont réécrits pour les quatre indicateurs. Zéro mesuré reste un
chiffre ; un Umami muet reste une phrase de `LIBELLES_ETAT`, jamais un
zéro.

### 3.2 `FlecheTendance`

Trois glyphes, trois couleurs, un seul composant partagé avec les pastilles
de l'accueil :

| Sens | Glyphe | Couleur |
|---|---|---|
| amélioration | ↑ | vert (`text-emerald-600`) |
| dégradation | ↓ | rouge (`text-red-600`) |
| égal, ou pas de période de comparaison | → | gris (`text-muted-foreground`) |

« Amélioration » dépend de la métrique. Une vue ou un visiteur ou un
backlink qui **monte** est une amélioration. Un **rang** qui **descend**
(12 → 7) est une amélioration. `trend()` de `site-dashboard.tsx` reste
tel quel pour les totaux Umami de l'accueil (pourcentage). La flèche des
rangs n'utilise pas `trend` : elle compare deux entiers de rang, et
l'absence de précédent est `→`, pas « +100 % ».

### 3.3 États du rang (indicateurs 3 et 4)

Un seul discriminant, calculé côté query à partir de `targetKeyword`, de
la ligne `seoRanks` et de `secrets.status` / `dataforseo.identifiants`.
L'UI n'arbitre pas.

| État | Condition | Affichage |
|---|---|---|
| `no_keyword` | `targetKeyword` absent ou vide | « Aucun mot-clé cible. » Pas de bouton Relever. |
| `never_ranked` | mot-clé posé, aucune ligne `seoRanks` | « Jamais relevé. » Relever actif (si publié et clés présentes). |
| `ranked` | dernière ligne : notre URL est dans le top 100 | rang + écart + flèches |
| `out_of_top_100` | crawl allé au `depth` 100, notre URL absente, aucune autre URL de **notre** hôte dans les organiques | « Hors du top 100. » |
| `other_url` | une URL de notre hôte ranke, ce n'est pas celle de cette fiche | « Une autre URL ranke » + l'URL trouvée, tronquée |
| `keyword_changed` | `seoRanks.keyword` ≠ `targetKeyword` actuel | « Mot-clé changé — le dernier relevé porte encore “…” » Relever visible, soumis au throttle 1 h comme les autres |
| `dfs_absent` | les deux secrets DataForSEO n'ont pas une source autre que `aucune` (même règle que `/settings/mesure`) | « DataForSEO n'est pas configuré. » Lien interne vers `/settings/mesure`. Pas de Relever. |
| `draft` | `status !== "published"` | les chiffres Umami restent (le chemin a pu être mesuré). Rang : pas de Relever, pas d'appel cron. Si une ligne `seoRanks` existe d'une publication antérieure, on la montre ; sinon `never_ranked` sans bouton. |

`other_url` l'emporte sur `out_of_top_100` : si une page sœur sort déjà,
le dire est plus utile que « hors top 100 ». `keyword_changed` l'emporte
sur `ranked` / `out_of_top_100` / `other_url` : le chiffre affiché
appartiendrait à un autre mot. `dfs_absent` l'emporte sur tout le reste
sauf `no_keyword` (sans mot-clé, configurer DataForSEO ne sert à rien
sur cette fiche).

### 3.4 Bouton Relever

Dans le `CardHeader` d'`AnalyticsPanel`, à droite du titre « Audience »
(`CardAction`, déjà utilisé sur ces fiches). Libellé « Relever ». Inactif
quand :

- l'état est `no_keyword`, `dfs_absent` ou `draft` ;
- ou `seoRanks.fetchedAt` a moins d'une heure.

Le debounce est **par document**, pas global. Un Relever sur `/contact`
n'interdit pas `/blog/welcome`. Le cron du lundi n'écrit pas
`fetchedAt` d'une façon qui bloquerait un Relever le lundi matin : le
throttle ne s'applique qu'à l'action manuelle `seoRanks.relever`.

Au clic : une action Convex, `requireRole` owner / admin / editor,
`requireOwnDocument` pour un editor. Elle n'est pas déclenchée par
`useEffect`. Un mot-clé qui vient de changer ne lève pas le throttle :
c'est le même document, le même plafond. Le cron du lundi suivant
relevé le nouveau mot. Un SERP qui échoue (timeout, 429, identifiants
refusés) n'écrit pas de ligne et ne touche pas `fetchedAt` ; l'action
rend `{ ok: false, reason }` et le bouton le dit. L'upsert du succès
est une seule mutation : soit la ligne est à jour, soit l'ancienne
reste.

### 3.5 Le champ `targetKeyword`

Un champ texte dans la section « qui la trouve en cherchant » des deux
fiches — à côté de `seo.title` / `seo.description`, **pas** dedans.

- Constante `MAX_TARGET_KEYWORD_LENGTH = 80`, exportée de `content.ts`,
  importée par les deux écrans pour le `maxLength`. Testée aux deux
  bornes. Trop long : `{ code: "FIELD_TOO_LONG", field: "targetKeyword", max: 80 }`.
- Chaîne vide = retrait. Trim à l'écriture. Pas de minuscule forcée : le
  mot-clé est envoyé à Google tel quel.
- Il n'entre **pas** dans `seoValidator`. `seo` est projeté tel quel par
  `getPublishedPage` / `getPublishedPost` / `previewPage` / `previewPost`
  et lu par `PageHead`. Un champ de plus dans `seo` finirait dans le
  document que le site public sérialise, même si aucune balise ne le
  rend aujourd'hui.
- Il vit en frère de `seo` sur `pages` et `posts` : `targetKeyword:
  v.optional(v.string())`. Expand seulement.
- Les quatre queries publiques et d'aperçu **omettent** le champ à la
  projection (destructurer, ne pas le renvoyer). `pages.get` et
  `posts.get` (dashboard) le gardent. Le test de famille publique
  (`pages.publicQueryFamily.test.ts`) refuse qu'une query sans `token`
  rende `targetKeyword`. Un test `PageHead` / `loadPage` refuse que la
  chaîne du mot-clé apparaisse dans le HTML d'une page publiée.

`GenerateSeoGeoButton` / `ai.generateSeoGeo` ne remplissent pas ce
champ : un mot-clé cible est un choix d'opérateur, pas une phrase à
générer. Le même bouton remplit en revanche l'extrait d'un article ;
l'image de une est une action distincte (`aiImage.generatePostCover`).

## 4. Dashboard — `SiteDashboard`

Route inchangée : `apps/admin/src/routes/_authed/index.tsx` rend
`SiteDashboardPanel` puis `TuilesContenu`. Cette livraison ne touche pas
aux tuiles.

### 4.1 Courbe

`CourbeAudience` ne change pas de contrat : série Umami `pageviews` +
`visitors`, `SelecteurPeriode` (7 j / 30 j / 12 mois), `CadreSansMesure`
quand Umami est muet. **Aucun** axe de rang, aucune série DataForSEO, pas
de second `ChartConfig`.

### 4.2 Pastilles — à côté de la courbe

Dès que DataForSEO est configuré (les deux secrets, même règle qu'en
§3.3), une colonne s'ouvre à droite de `CourbeAudience` (`lg:grid-cols`
courbe + pastilles). Trois `PastilleSeo`, chacune un `Indicateur` +
`FlecheTendance` :

| Pastille | Chiffre | Flèche | Source |
|---|---|---|---|
| Position moyenne | moyenne arithmétique des `seoRanks.position` dont l'état courant est `ranked`, pages **et** articles publiés qui ont encore ce mot-clé | vs la même moyenne calculée sur `previousPosition` (ceux qui en ont une) | `seoRanks` |
| Backlinks | `seoSiteBacklinks.backlinks` | vs `backlinksPrev` | overview domaine, 1× / semaine |
| Domaines référents | `seoSiteBacklinks.referringDomains` | vs `referringDomainsPrev` | le même appel |

Pas de quatrième pastille. Les trois tiennent la colonne ; en inventer
une (trafic estimé, score, AI) rouvrirait ce que §2 ferme.

Sans clés DataForSEO : la colonne n'est pas rendue. Pas de skeleton, pas
de « — », pas de carte grise. La courbe reprend toute la largeur, comme
aujourd'hui.

Sans aucun `ranked` : la pastille « Position moyenne » affiche « — » et
`→`, pas 0 — zéro voudrait dire « tous premiers », ce qui est faux.
Sans snapshot backlinks (premier lundi pas encore passé, et personne n'a
rien forcé) : les deux pastilles backlinks disent « Pas encore relevé »,
`→`.

Le domaine cible des deux appels site est `settings.declaredDomain`. S'il
est vide, on n'appelle pas Labs ni l'overview ; les pastilles backlinks
et les deux listes DataForSEO du §4.3 portent « Déclarez le domaine » +
lien `/settings/domaine`. La SERP d'une fiche n'a pas besoin de ce
champ : elle a l'URL absolue via `publicUrl`.

### 4.3 Quatre listes en bas

Aujourd'hui : `grid sm:grid-cols-2`, deux `Ranking` — « Pages les plus
visitées » et « D'où viennent-ils ». On passe à **quatre** colonnes
(`lg:grid-cols-4`) **uniquement** si DataForSEO est configuré.

| Colonne | Titre (copie) | Source | Ligne |
|---|---|---|---|
| 1 | Pages les plus visitées | Umami `topPages` (déjà `limit=5`) | chemin + visites |
| 2 | D'où viennent-ils | Umami `topReferrers` (déjà `limit=5`) | libellé + visites |
| 3 | Mots-clés qui amènent | `seoSiteKeywords`, 5 premières lignes triées par `position` croissante | mot-clé + rang |
| 4 | Pages qui sortent déjà | les URL distinctes de `seoSiteKeywords` qui appartiennent à notre hôte, 5 premières, meilleure position | chemin + rang |

Sans clés DataForSEO : le `grid` à deux colonnes actuel, les deux
`Ranking` Umami seulement. On ne monte pas deux `Ranking` vides.

Les états déjà écrits dans `Ranking` tiennent : `null` → « Liste
indisponible pour le moment. » ; `[]` → « Rien sur cette période. » Les
listes 3 et 4 ne se rendent que si le snapshot Labs existe ; avant le
premier lundi, `[]` — « Rien sur cette période. » — pas une carte
absente (les clés, elles, sont là).

`SiteDashboard` reste une fonction pure. `SiteDashboardPanel` ajoute une
query (rangs site + snapshot) à côté de `analytics.siteSummary`. Toujours
pas d'action DataForSEO au montage.

## 5. Mot-clé, lieu, secrets

### 5.1 Secrets

Aucun secret nouveau. `DATAFORSEO_LOGIN` et `DATAFORSEO_PASSWORD` sont
déjà dans `SECRET_NOMS`, saisis à `/settings/mesure`, chiffrés sous
`SECRETS_KEY`, lus par `lireSecret`. Aucune query ne rend le mot de
passe. `settings.get` (publique) n'acquiert aucun champ de cette
livraison.

### 5.2 Lieu SERP

Deux champs optionnels sur `settings`, expand seulement, **absents** de
`settings.get`, présents dans `settings.getPrivate` et `settings.update`
(owner / admin, déjà le cas) :

```
serpLocationCode: v.optional(v.number())
serpLanguageCode: v.optional(v.string())
```

À la lecture, l'absence vaut **Google France** : `location_code = 2250`,
`language_code = "fr"`. L'écran `/settings/mesure` (`SeoPixelPage`)
ajoute une ligne sous DataForSEO : un `<Select>` dont la seule option
livrée est « France (Google) ». D'autres pays sont un autre lot — le
schéma les accepte déjà (un entier, une chaîne de 8 caractères max),
l'UI ne les propose pas.

`serpLanguageCode` hors `[a-z]{2}` : `{ code: "INVALID_SERP_LOCALE" }`.
`serpLocationCode` hors entier positif : le même code. Bornes testées.

Ce n'est pas un secret : ce n'est pas un jeton. Ce n'est pas public : le
site n'a rien à en faire. D'où `getPrivate` seulement — le même
raisonnement qu'`emailFrom` et `declaredDomain`.

### 5.3 Traitement et registre

DataForSEO reçoit l'URL publique de la page et le mot-clé cible — du
contenu d'opérateur, pas une donnée qui désigne un visiteur. Aucune
ligne nouvelle dans `processings` (`legal.ts`). Aucun bump de
`consentVersion`. Le test
`curl … | grep -cE "googletagmanager|connect\.facebook\.net"` reste à 0 ;
rien n'y ajoute `dataforseo.com`.

## 6. Schéma — expand seulement

Trois tables nouvelles. Deux champs optionnels sur `pages` et `posts`.
Deux champs optionnels sur `settings`. Rien n'est retiré.

### 6.1 `pages` / `posts`

```
targetKeyword: v.optional(v.string())
```

Pas d'index : on ne liste pas par mot-clé. Le cron parcourt les publiés
(`by_status` / `by_status_published`) et saute ceux sans mot-clé.

### 6.2 `seoRanks`

Une ligne par page **ou** article qui a déjà été relevé. Pas d'historique
au-delà du couple courant / précédent — la fiche n'a pas de courbe.

```
kind: v.union(v.literal("page"), v.literal("post"))
pageId: v.optional(v.id("pages"))
postId: v.optional(v.id("posts"))
keyword: v.string()          // celui du relevé, pas forcément le courant
url: v.string()              // URL demandée (publicUrl)
position: v.optional(v.number())
previousPosition: v.optional(v.number())
rankedUrl: v.optional(v.string())  // renseigné si other_url
status: v.union(
  v.literal("ranked"),
  v.literal("out_of_top_100"),
  v.literal("other_url"),
)
fetchedAt: v.number()
previousFetchedAt: v.optional(v.number())
```

Index : `by_page` (`pageId`), `by_post` (`postId`). Unicité : la mutation
d'écriture refuse une seconde ligne pour le même `pageId` / `postId` ;
elle met à jour. Avant d'écrire le nouveau `position`, elle copie
`position → previousPosition` et `fetchedAt → previousFetchedAt`.

`url` et `rankedUrl` sont bornés à `MAX_CANONICAL_URL_LENGTH` (2048).
`keyword` à `MAX_TARGET_KEYWORD_LENGTH`.

### 6.3 `seoSiteKeywords`

Snapshot Labs, **remplacé** à chaque tirage hebdomadaire (on efface les
lignes du snapshot précédent, on écrit les nouvelles). Pas de fusion
silencieuse qui laisserait un mot-clé mort.

```
keyword: v.string()
position: v.number()
url: v.string()
fetchedAt: v.number()
```

Index `by_fetched_at` (`fetchedAt`) pour tout supprimer d'un coup. Plafond
d'écriture : 50 lignes. L'écran n'en montre que 5. Pas de volume de
recherche, pas d'`etv`, pas de CPC — c'est le trafic estimé que §2
refuse, sous un autre nom.

### 6.4 `seoSiteBacklinks`

Singleton, comme `settings`. Une ligne, ou aucune.

```
backlinks: v.number()
referringDomains: v.number()
backlinksPrev: v.optional(v.number())
referringDomainsPrev: v.optional(v.number())
fetchedAt: v.number()
```

À chaque overview : les compteurs courants deviennent `*Prev`, les
nouveaux s'écrivent. Expand : la table n'existe pas encore, les
déploiements en place n'ont rien à migrer.

## 7. Appels DataForSEO

Tout passe par `packages/backend/convex/lib/dataforseo.ts` (déjà le ping
`user_data`) et un module voisin `lib/dataforseoSerp.ts` — le fichier
actuel reste sous 200 lignes. Timeout SERP : **30 s** (un live depth 100
dépasse souvent les 8 s du ping). Timeout Labs / overview : 8 s, comme le
reste du dépôt. Identifiants : `lireSecret`, jamais en argument d'action
planifiée.

### 7.1 SERP — fiche et cron page par page

```
POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced
```

Un task :

```
keyword: targetKeyword
location_code: settings.serpLocationCode ?? 2250
language_code: settings.serpLanguageCode ?? "fr"
device: "desktop"
depth: 100
stop_crawl_on_match: [{
  match_value: "<hôte><publicPath>",   // exemple.fr/blog/welcome — sans schéma
  match_type: "wildcard"
}]
find_targets_in: ["organic"]
```

`match_value` est le hôte déclaré (`declaredDomain`) concaténé au chemin
`publicPath` (l'accueil est `exemple.fr/`, pas `exemple.fr/accueil`). On
ne matche **que cette URL** : si on matchait le domaine entier, le crawl
s'arrêterait sur la première page sœur et on déclarerait `other_url` en
ratant un rang 40 sur la bonne URL.

Après la réponse, on parcourt les items `type === "organic"` :

1. une URL dont le hôte + chemin (sans query, sans hash, slash final
   normalisé) égale `publicUrl` → `ranked`, `position` = `rank_absolute` ;
2. sinon, une URL dont le hôte est le nôtre → `other_url`, `rankedUrl` =
   cette URL, `position` absent ;
3. sinon → `out_of_top_100`.

`stop_crawl_on_match` facture les pages réellement crawlées, pas les
dix pages d'un depth 100 si le match arrive en page 2. C'est tout l'intérêt
du live plutôt que d'un Regular qui irait au bout.

### 7.2 Labs — mots-clés du site, 1× / semaine

```
POST https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live
```

`target` = `declaredDomain` (sans schéma). Même `location_code` /
`language_code` que le SERP. `limit` = 50. On garde `keyword`,
`rank_absolute` (ou `rank_group` si `rank_absolute` manque), `url` de
l'item. On jette `etv`, `impressions`, `cpc`, `search_volume`.

Un seul appel pour tout le site, le lundi, dans le même cron que le SERP.

### 7.3 Backlinks — overview domaine, 1× / semaine

```
POST https://api.dataforseo.com/v3/backlinks/overview/live
```

`target` = `declaredDomain`. On lit `backlinks` et `referring_domains`.
Pas d'`/summary` par URL, pas de `/backlinks/list`. Autre famille
d'endpoints, autre ligne de facturation — d'où la table à part.

### 7.4 Planning

Un cron de plus dans `crons.ts`, le lundi 4 h 15 UTC (à l'écart du
`retention-purge` du 1er à 3 h 15) :

```
crons.weekly("seo-weekly", { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 15 },
  internal.seoRanks.refreshWeekly)
```

`crons.test.ts` cesse d'exiger « exactement deux tâches » : la liste
devient `retention-purge`, `revalidate-sweep`, `seo-weekly`.

`refreshWeekly` (internalAction) :

1. Si DataForSEO est absent → return, sans écrire de zéro.
2. Si `declaredDomain` est posé : un appel Labs, un appel overview,
   remplacement de `seoSiteKeywords`, mise à jour du singleton
   `seoSiteBacklinks`.
3. Pour chaque page et chaque article `status === "published"` avec
   `targetKeyword` non vide : un SERP (§7.1), upsert `seoRanks`. Les
   brouillons sont sautés. Un document dont le mot-clé a changé est
   relevé avec le **nouveau** (c'est le cron, pas un Relever : le
   throttle 1 h ne s'applique pas).

Les appels SERP partent **en série**, pas en `Promise.all` : un site à
trente pages publiées avec mot-clé ferait trente lives d'un coup, et le
plafond de concurrence DataForSEO n'est pas le nôtre à tenir. Une panne
sur l'item N n'annule pas N+1 ; la ligne garde l'ancien relevé, le
suivant passe.

`seoRanks.relever` refait le §7.1 pour **un** document, refuse si
`fetchedAt` < 1 h, refuse un brouillon, refuse l'absence de clés.

## 8. Unités

Chaque unité a un contrat lisible sans ouvrir les autres.

| Unité | Fait | Dépend de | Ne fait pas |
|---|---|---|---|
| `content.ts` `MAX_TARGET_KEYWORD_LENGTH` + champ schéma | borne et forme | rien | appeler DataForSEO |
| `pages` / `posts` update + projection | écrit / omet `targetKeyword` | `requireRole`, `seoValidator` inchangé | relevé |
| `lib/dataforseoSerp.ts` | POST SERP / Labs / overview, parse, timeout | `authorizationHeader` déjà là | écrire en base |
| `seoRanks.relever` | un live, upsert, throttle | secrets, `publicUrl`, rôle | s'exécuter au montage |
| `seoRanks.refreshWeekly` | lundi : Labs + overview + SERP des publiés | idem | servir l'UI |
| `seoRanks.forDocument` | query : état §3.3 | `seoRanks`, `targetKeyword`, statut des secrets | fetch HTTP |
| `seoRanks.siteSnapshot` | query : moyennes, pastilles, listes 3–4 | les trois tables | fetch HTTP |
| `Indicateur` + `FlecheTendance` | rend un chiffre et une flèche | props seulement | connaître Umami ni DFS |
| `AnalyticsPanel` | quatre indicateurs + Relever + états | résultat Umami + résultat `forDocument` | fetch |
| `PageAnalytics` | `forPath` au montage, query rang, action au clic | les deux | appeler DataForSEO tout seul |
| `PastilleSeo` | une pastille d'accueil | props | |
| `SiteDashboard` | courbe, pastilles, 2 ou 4 `Ranking` | `SiteSummary` + snapshot | fetch DFS |
| `SeoPixelPage` | Select du lieu SERP | `getPrivate` / `update` | appeler le SERP |

Fichiers nouveaux sous 200 lignes. `analytics-panel.tsx` et
`site-dashboard.tsx` dépassent déjà le seuil s'ils avalent tout : les
indicateurs et les pastilles sortent dans leurs fichiers. `Ranking` et
`Figure` restent où ils sont.

Modules Convex : `seoRanks.ts` est le point d'entrée. Les helpers restent
sous `lib/` (deux points dans le chemin, déjà le cas de
`lib/dataforseo.ts`). Aucune fixture sous `convex/` hors `*.test.ts`.
Toute mutation / action publique entre dans `MUTATION_REGISTRY` (ou le
registre des actions si le dépôt en a un pour `dataforseo.enregistrer`)
et dans `registryModules.ts`.

Rôles : lire les chiffres = owner / admin / editor, comme
`analytics.forPath` et `analytics.siteSummary`. Écrire le lieu SERP =
owner / admin. Relever = owner / admin / editor, avec
`requireOwnDocument` pour l'editor. Le cron n'a pas de session.

## 9. Ce qui ne change pas

- `apps/web` n'a ni clé admin ni session. Aucune query publique nouvelle.
  Celles qui existent déjà omettent `targetKeyword`.
- `settings.get` ne gagne aucun champ. `serpLocationCode` /
  `serpLanguageCode` ne sont pas des secrets, et ne sont pas publics non
  plus.
- `CourbeAudience`, `CadreSansMesure`, `SelecteurPeriode`, `Figure`,
  `trend()`, `LIBELLES_ETAT`, `TuilesContenu` : même contrat.
- Umami `script.js` / `recorder.js`, pixels, `consentVersion`.
- `DATAFORSEO_*` : mêmes noms, même table `secrets`, même précédence.
- Expand / migrate / contract : cette livraison est un expand. Pas de
  champ retiré, pas de table renommée.

## 10. Vérification

Un owner, clés DataForSEO posées, domaine déclaré, une page publiée avec
`targetKeyword = "agence web lyon"` :

1. Ouvre `/pages/<id>` : quatre cases. Umami chiffre (ou l'état Umami).
   Rang = « Jamais relevé ». Aucune requête vers `api.dataforseo.com`
   dans les logs Convex à l'ouverture.
2. Clique Relever. La case 3 devient un rang ou « Hors du top 100 » ou
   « Une autre URL ranke ». Un second clic dans l'heure : bouton inactif.
3. Change le mot-clé, enregistre : état « Mot-clé changé ». Si le
   dernier relevé a moins d'une heure, Relever reste inactif. Passée
   l'heure (ou au cron du lundi), le nouveau mot est relevé et
   `seoRanks.keyword` l'égale.
4. Passe la page en brouillon : Relever inactif. Le cron du lundi suivant
   ne l'appelle pas.
5. Ouvre `/` : courbe Umami inchangée. Trois pastilles à droite. Quatre
   listes en bas. Aucun axe de rang sur le graphique.
6. Retire les deux secrets DataForSEO. Recharge `/` : plus de pastilles,
   plus des listes 3 et 4, les deux listes Umami restent. Recharge la
   fiche : lien vers `/settings/mesure`, pas de Relever.
7. `curl` du HTML public de la page : la chaîne `agence web lyon`
   n'apparaît dans aucune balise. `getPublishedPage` / `previewPage` /
   `getPublishedPost` / `previewPost` ne portent pas `targetKeyword`.
8. `settings.get` (sans session) ne contient ni `serpLocationCode`, ni
   une ligne `seoRanks`, ni un login DataForSEO.

Les tests qui tiennent ça, pas une lecture de code :

- `analytics-panel.test` : quatre indicateurs, chaque état §3.3, zéro
  Umami ≠ Umami muet, Relever absent aux états qui l'interdisent ;
- `site-dashboard.test` : pastilles absentes sans DFS, présentes avec,
  `Ranking` × 2 vs × 4, `CourbeAudience` sans série de rang
  (`--color-pageviews` toujours, aucun `--color-rank`) ;
- `seoRanks` (Convex) : throttle 1 h, brouillon refusé, cron saute les
  brouillons, upsert copie `previous*`, Labs jette `etv`, overview
  domaine seulement, `other_url` vs `out_of_top_100` vs `ranked` ;
- projection publique : `targetKeyword` absent, `settings.get` sans lieu
  SERP ;
- `crons.test` : la troisième tâche `seo-weekly` ;
- `content` / pages / posts : borne 80, les deux bords.
