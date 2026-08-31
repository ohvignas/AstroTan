# SEO et Pixel — écran de clés, DataForSEO, pixels

**Date** : 31 août 2026
**Statut** : design tranché en conversation, prêt à planifier
**Invariants** : [`2026-08-29-secrets-et-chiffrement.md`](2026-08-29-secrets-et-chiffrement.md), skill `consent-rgpd`

Cette livraison change **l'écran des clés** à `/settings/mesure`. Elle ne
débranche pas Umami du site. Elle n'ajoute pas Google Search Console. Elle
n'implémente pas l'audience article (7 j / 30 j, mot-clé cible, rang
hebdomadaire) — c'est la passe 2, décrite en §8 pour ne pas se fermer de
porte.

## 1. Objectif

Un adoptant ouvre `/settings/mesure` et y pose, retire ou remplace trois
choses, avec le même geste qu'à `/settings/emails` (liste, déplier, peu de
texte) :

1. les identifiants **DataForSEO** (login + mot de passe API) ;
2. l'identifiant du **pixel Meta / Facebook** ;
3. l'identifiant de la **balise Google** (`G-`, `AW-`, `GT-`, `DC-`).

Le menu et le `h1` portent **SEO & Pixel**. L'URL reste `/settings/mesure`
— renommer la route casserait les liens, le `routeTree` et le test de
correspondance fichier ↔ chemin.

## 2. Décisions, et ce qu'elles ferment

| Décision | Conséquence |
|---|---|
| Pas de Google Search Console | Aucun écran, aucun secret, aucun appel. |
| Umami quitte cet écran | Plus aucun champ `UMAMI_*` ni `PUBLIC_UMAMI_*` ici. Le script `script.js` et `convex/analytics.ts` restent. Les cinq `UMAMI_API_*` restent dans `SECRET_NOMS` et se posent encore par `convex env set` ou `secrets.set`. |
| DataForSEO = secret chiffré | Jamais dans `settings`. Deux noms : `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`. Même table, même AES-GCM, même précédence que Resend et OpenRouter. |
| IDs de pixels = pas des secrets | Ils finissent dans le HTML après accord. Ils vivent dans `settings` (`metaPixelId`, `googleTagId`), projetés par `settings.get` (publique) pour que le site les lise. |
| `consentTags()` les lit | Aucune balise dans un `.astro` ou un layout. L'absence d'identifiant reste l'interrupteur. |
| `consentVersion` | **Ne pas incrémenter.** Meta et Google existent déjà dans `consentTags()`. Changer la *source* de l'ID n'ajoute pas un tiers. |
| UX = emails | Catalogue de trois lignes toujours visibles. Ajouter = déplier une ligne vide et enregistrer. Modifier = déplier. Supprimer = vider / confirmer. Pas de phrase sous le `h1`. |
| Cette livraison | L'écran de clés. Aucun appel DataForSEO. Aucun champ mot-clé sur l'article. |

## 3. Où vit chaque valeur

Trois logements, jamais un quatrième. Recopiés de la spec secrets, appliqués ici.

| Valeur | Logement | Pourquoi |
|---|---|---|
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | Table `secrets`, chiffrés sous `SECRETS_KEY` | Identifiants d'API. `settings.get` est publique. |
| `metaPixelId`, `googleTagId` | Table `settings` | Visibles dans le HTML une fois le pixel chargé. Le site public n'a pas de session : il les lit par `settings.get`. |
| `PUBLIC_META_PIXEL_ID`, `PUBLIC_GOOGLE_TAG_ID` | Build de `apps/web` | Repli pour un déploiement qui ne les a jamais saisis à l'écran. Ce n'est plus le chemin normal. |
| `PUBLIC_UMAMI_*`, `UMAMI_API_*` | Inchangés | Hors de cet écran. |

**Précédence DataForSEO** — celle de `secrets.ts`, un seul endroit : l'environnement gagne, la base sert sinon, `secrets.status` rend `source`.

**Précédence des pixels** — ce n'est pas un secret, la règle n'est donc pas la même. Un champ en base *écrit* (y compris la chaîne vide d'un retrait) l'emporte. Un champ *jamais écrit* (`undefined` en document, `null` dans `get`) retombe sur `PUBLIC_*`. Sinon un « Supprimer » suivi d'un rebuild qui porte encore la variable de build ferait revenir le pixel, en silence.

```
choisirIdentifiant(enBase, auBuild):
  enBase === null ou undefined  →  auBuild trimé, ou absent
  enBase === ""                 →  absent   (retrait explicite)
  enBase === "123…"             →  "123…"
```

`settings.update` reçoit `v.optional(v.union(v.string(), v.null()))` :
`undefined` = ne touche pas, `null` = retire. Le retrait **écrit `""`**
dans le document, il n'efface pas le champ — sinon `undefined` et
« retiré » redeviendraient indiscernables, et le repli `PUBLIC_*`
rouvrirait le pixel.

## 4. Schéma — expand seulement

Deux champs optionnels sur `settings`, rien d'autre. Aucune table neuve.
Aucun champ existant retiré.

```
metaPixelId: v.optional(v.string())
googleTagId: v.optional(v.string())
```

Bornes, testées aux deux bords :

| Champ | Forme acceptée | Max |
|---|---|---|
| `metaPixelId` | chiffres uniquement, 5 à 20 | 20 |
| `googleTagId` | `G-`, `AW-`, `GT-` ou `DC-` puis `[A-Z0-9]+` | 64 |
| chaîne vide | oui, c'est le retrait | — |

Hors forme : `ConvexError` `{ code: "INVALID_PIXEL_ID", field }`.
Trop long : `{ code: "FIELD_TOO_LONG", field, max }`, le code déjà en
vigueur.

La forme vit dans `packages/backend/convex/lib/pixelId.ts` (pur, testé).
`settings.ts` a déjà dépassé 600 lignes : y inliner la validation
reproduirait le fichier-fourre-tout que ce dépôt refuse d'agrandir. Le
site public a son propre helper (`apps/web/src/lib/pixelIds.ts`) : fusion
build + base, aucun validateur Convex. Deux unités, deux raisons.

`SECRET_NOMS` s'allonge de deux littéraux, et le `nomValidator` à la main
aussi — le typecheck `_memeListe` échoue si l'un dérive. `MAX_SECRET_LENGTH`
(2048) s'applique tel quel. Pas de vérificateur dans `secretCheck.ts` :
essayer le login sans le mot de passe, ou l'inverse, n'interroge rien de
désigné, et cette livraison n'appelle pas DataForSEO. L'écran enregistre
donc en `sans_verificateur`, comme les `UMAMI_API_*`.

`packages/backend/.env.example` documente les deux noms. Sans ça,
`scripts/check-env-wiring.mjs` échoue dès que `lireSecret` les lit.

## 5. Projections

`settings.get` (publique, sans session) **ajoute** `metaPixelId` et
`googleTagId`. Trois valeurs, et Convex ne retire pas `""` :

| En document | Dans `get` / `getPrivate` | Sens |
|---|---|---|
| champ absent | `null` | jamais saisi → repli `PUBLIC_*` |
| `""` | `""` | retiré à l'écran → aucun pixel, même si `PUBLIC_*` existe au build |
| `"123…"` | `"123…"` | celui-là |

`null` et `""` ne se confondent pas. `metaPixelId: settings.metaPixelId ?? null` est le bon mapping (absent → `null`, `""` traverse). `settings.metaPixelId || null` écraserait le retrait et rouvrirait le pixel au prochain rebuild. Le test de projection sème les deux formes — une ligne avec `""`, une avec un ID — et refuse qu'un secret (`leadWebhookSecret`, un jeton, un login DataForSEO) apparaisse. Les deux champs entrent dans `AUTORISES` et `AUTORISES_PRIVE`.

`settings.get` rend aussi `null` **pour la ligne entière** tant qu'aucun save n'a créé le singleton — clone neuf. Ce `null-là` n'est pas un identifiant : c'est l'absence de réglages.

Un editor *voit* les IDs (`getPrivate`) et ne les *écrit* pas (`update` reste owner/admin).

Aucune query ne rend `DATAFORSEO_*` en clair, ni un fragment, ni l'IV.
`secrets.status` dit configuré / source / illisible, comme pour Resend.

## 6. Site public — une seule fusion, partout

Aujourd'hui `consentTags(import.meta.env)`, `ConsentBanner.astro`,
`GoogleConsentMode.astro`, `cookies.astro` et `securityHeaders.ts` lisent
uniquement le build. Un ID saisi à l'écran n'aurait aucun effet, en
silence — le défaut que la spec secrets a déjà nommé.

Un helper pur, testé, `apps/web/src/lib/pixelIds.ts` :

```
fusionnerPixels(settings, env) → ConsentEnv
```

`settings` est le retour de `settings.get` : soit `null` (pas de ligne),
soit l'objet projeté. `null` se lit comme « jamais saisi » pour les deux
IDs — repli `PUBLIC_*`, pas d'exception. Sur un objet, chaque champ passe
par `choisirIdentifiant`. Tous les lecteurs passent par ce helper.
`consentTags` ne change pas de contrat : il continue de lire un `ConsentEnv`.

`consentVersion` reste `1.0.0`. Les cas Meta et Google existent déjà. Un
site qui n'avait aucun pixel et en saisit un pose une question *nouvelle*
au visiteur — mais c'est l'absence d'identifiant qui tenait le bandeau
éteint, pas une version de politique. `shouldAskConsent` redevient vrai,
le bandeau s'affiche, et une réponse antérieure sans catégorie `marketing`
n'accorde pas le pixel (`tagsToInject` filtre sur la catégorie). Incrémenter
la version redemanderait à tout le monde, y compris aux sites qui n'ont
toujours aucun pixel. Ce n'est pas un nouveau tiers dans le *code*.

### CSP

`enTetesSecurite` n'ouvre les origines Meta / Google que si l'identifiant
*effectif* est posé — le test « sans identifiant, la CSP ne nomme ni
Google ni Meta » reste la garde. Le middleware lit donc `settings.get`
(déjà publique), fusionne, et passe le résultat. Mémo 60 s, comme les
redirections ; `/api/revalidate` le purge, comme `purgeRedirectMemo`.

Sans cette lecture, un pixel saisi à l'écran s'injecte après accord et la
CSP bloque `connect` / `img` : consentement décoratif, déjà payé une fois.

### Cache

Les pages portent le bandeau dans le HTML mis en cache (`maxAge: 300`).
Changer un ID sans invalider laisse cinq minutes un bandeau faux.

Quand `metaPixelId` ou `googleTagId` change réellement (même règle que
`champsModifies` de `settings.update`), la mutation enfile une ligne
d'outbox aux tags `["pages", "posts"]` et planifie `revalidate.drain`.
`drain` ne lit que les tags : il ne branche pas sur `kind`. `OutboxTarget`
s'étend d'un littéral `site` — expand d'union, les lignes existantes
restent valides. Pas de bouton « réessayer » pour cette ligne : le cron
de 60 s et le `drain` immédiat suffisent. `pages.publicationStatus` ne
scanne pas ce `kind` : il n'a pas de `pageId`, et le mélange avec le repli
legacy (`kind === undefined`) serait une régression.

## 7. L'écran

Route : `apps/admin/src/routes/_authed/settings/mesure.tsx`.
Corps : nouveau fichier `settings-seo-pixel.tsx` (+ test). `MeasurementPage`
disparaît de `settings-environment.tsx` — elle porte aujourd'hui Umami, les
`PUBLIC_*` hors portée, et trop de phrases.

`SETTINGS_PAGES` :

```
to: "/settings/mesure"
label: "SEO & Pixel"
title: "SEO & Pixel"
description: ""
```

Le test « le titre commence par le libellé » normalise ` & ` → ` et ` ;
ici les deux chaînes sont identiques, ça passe.

Trois lignes, toujours, dans cet ordre :

| Ligne | État affiché | Éditeur déplié |
|---|---|---|
| DataForSEO | **configuré** seulement si les deux noms ont une source autre que `aucune` (environnement ou base). Un seul des deux = **absent** — `lireSecret` n'aurait de toute façon rien d'utilisable. | `ChampSecret` login + `ChampSecret` mot de passe. Lien `https://app.dataforseo.com/api-access`. Sans clé maîtresse : la même phrase que Resend. |
| Pixel Meta | l'ID, ou « absent » | champ texte, pas `password`. L'ID n'est pas un secret. |
| Google Ads | l'ID, ou « absent » | idem. Placeholder `AW-…` / `G-…`. |

Une seule ligne dépliée à la fois. Replier une ligne sale pose la même
question qu'`actionSurLigne` côté emails. Rien ne s'enregistre tout seul.
`INVALID_PIXEL_ID` et `FIELD_TOO_LONG` passent par `describeSettingsError`
(`apps/admin/src/lib/settingsErrors.ts`), comme les autres codes de
`settings.update` : phrase à côté du champ, pas une alerte native.

Un editor voit les deux IDs (ils sont dans `getPrivate`) et la mention
« réservé » sur DataForSEO (`secrets.status` est owner/admin). Il n'a
aucun bouton d'écriture.

Retirer DataForSEO : `secrets.clear` sur les deux noms, après confirmation
qui nomme la conséquence réelle d'aujourd'hui — ces identifiants ne
servent plus, le site public ne casse pas. Retirer un pixel :
`settings.update({ …: null })` → `""` en base, invalidation, le bandeau se
tait si plus rien ne le demande.

## 8. Passe 2 — hors livraison, assez pour ne pas se fermer

L'écran article, plus tard : 7 j et 30 j côte à côte (Umami, déjà lu), un
champ **mot-clé cible** sur le post, un rang DataForSEO rafraîchi chaque
semaine. Cette passe n'ajoute aucun de ces trois. Elle impose seulement :

- les deux noms de secret ci-dessus, et aucun autre ;
- aucun appel sortant DataForSEO dans ce lot, pour ne pas inventer un
  traitement dans `legal.ts` avant qu'il ait lieu ;
- le mot-clé cible n'entre pas dans `posts` maintenant — expand plus tard,
  quand l'écran le demandera.

## 9. Ce qui ne change pas

- `apps/web` n'a toujours ni clé admin ni session. `settings.get` reste
  publique et filtrée champ par champ.
- Aucune balise tierce dans le HTML avant une réponse. Le test
  `curl … \| grep -cE "googletagmanager|connect\.facebook\.net"` reste à 0.
- Umami `script.js` se charge toujours sans accord. `recorder.js` toujours
  après.
- `SECRETS_KEY` absente : DataForSEO se saisit uniquement par
  `convex env set`. L'écran le dit, il n'offre pas de champ.
- Fichiers nouveaux sous 200 lignes. `MeasurementPage` n'est pas agrandie,
  elle est remplacée.

## 10. Vérification

Un owner sur `/settings/mesure` :

1. Ajoute un pixel Meta `123456789012345`, enregistre. Le site public,
   après invalidation, affiche le bandeau ; `curl` du HTML ne contient
   toujours pas `connect.facebook.net`. « Tout accepter » injecte le pixel.
2. Ajoute DataForSEO (login + mot de passe). `secrets.status` passe à
   `source: "base"` pour les deux noms. Aucune query ne contient le mot de
   passe.
3. Supprime le pixel. Le bandeau disparaît si Google n'est pas posé. Un
   `PUBLIC_META_PIXEL_ID` encore présent au build **ne revient pas**.
4. Un editor ouvre la même page : il lit les IDs, il ne les écrit pas, il
   ne voit pas l'état DataForSEO.

Les tests qui tiennent ça, pas une lecture de code : `settings.publicProjection`,
`secrets.test` (sentinelle absente du JSON), `consent.test` (`tagsToInject`
vide sans réponse), `pixelIds.test`, `settings-seo-pixel.test`,
`settings-nav.test` (libellé + fichier de route).
