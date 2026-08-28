# Lot 4 — Redirections : décisions acquises

**Ce document n'est pas un plan.** Un agent a rédigé un plan pour ce lot le
2026-08-28 ; il a été arrêté avant d'implémenter et son plan n'a jamais été
écrit sur le disque. Ce qui suit est ce qui reste : les décisions prises en
relisant sa proposition, et les défauts trouvés dans ce qu'il proposait.

Les reprendre coûte quelques minutes. Les redécouvrir a coûté une session.

## Périmètre

**Redirections seulement. Pas de navigation en base.**

Le menu et le pied de page vivent dans le balisage de chaque page, en code —
c'est la conséquence directe de « la base ne porte aucun contenu de page »
(spec §4). Une table `navigation`, un `loadNavigation()` et des écrans
d'admin pour les éditer n'auraient aujourd'hui aucun lecteur : `PageLayout`
et la route attrape-tout où ils devaient s'insérer ont été supprimés.

À rouvrir seulement si le propriétaire du projet décide qu'un menu stocké en
base doit se rendre dans un balisage designé — question de design, pas
d'infrastructure.

## Décision 1 — Exclusion mutuelle vérifiée à l'écriture, pas au rendu

Une redirection dont le `from` vaut le chemin d'un contenu vivant masquerait
ce contenu : le middleware s'exécute avant la route.

Résolu **à l'écriture des deux côtés** — `redirects` refuse un `from` qui
correspond à un contenu existant, et la création/renommage d'une page refuse
un slug qui correspond à une redirection active. L'alternative (interroger
Convex depuis le middleware pour savoir si une page existe) ajoute un
aller-retour réseau sur *chaque* requête du site pour rattraper une faute de
saisie.

## Décision 2 — Trois points d'écriture, pas deux

`redirects.create` et `pages.create`/`update` ne suffisent pas. Le troisième
est **la réactivation d'une redirection désactivée** (`enabled: false → true`).

Sans lui, ce chemin passe entre les mailles :

1. créer une redirection `/x` alors qu'aucune page ne porte ce slug — accepté
2. la désactiver
3. créer une page de slug `/x` — accepté, la redirection est inactive
4. réactiver la redirection — la page est masquée, sans qu'aucune des deux
   autres gardes n'ait jamais été franchie

## Décision 3 — Quatrième source de vérité : les fichiers `.astro`

L'invariant « une redirection ne peut jamais rendre inatteignable un contenu
vivant » ne se réduit pas à « une ligne `pages` existe » plus « un chemin est
prérendu ».

Une page designée n'est ni l'un ni l'autre : `src/pages/accueil.astro` est en
`prerender = false`, et sa ligne en base n'existe que si quelqu'un l'a créée.
Une redirection `from: /accueil` la masquerait sans déclencher aucune des deux
gardes.

Il faut donc consulter **les fichiers réellement présents sous
`apps/web/src/pages/`**. Un manifeste engendré au build, jamais une liste
tenue à la main — celle-ci divergera à la deuxième page.

## Décision 4 — Pas de 301 pour un brouillon jamais publié

Au renommage d'un slug, la redirection automatique n'est créée que si la page
a déjà été publiée (`publishedAt !== undefined`).

Sinon, renommer trois fois un brouillon laisse trois redirections mortes, qui
bloquent ensuite la création d'une page sur ces chemins par la garde de la
décision 1.

## Piège — l'aperçu passe par la vraie URL

`mintPreviewToken` signe désormais le **slug**, et un aperçu s'ouvre sur
`/{slug}?t=…`, pas sur une route parallèle.

Le middleware de redirection s'exécute avant la page. Une requête portant
`?t=` doit donc le traverser sans être redirigée — sinon la prévisualisation
d'une page dont le slug vient de changer est cassée, exactement au moment où
l'on s'en sert.

## Le reste de sa proposition, qui tenait

- `lib/safeHref.ts` — schémas autorisés (chemin relatif, `http`, `https`,
  `mailto`, `tel`), refus de `//` et `/\` (URL protocol-relative, qui sort du
  site), refus des caractères de contrôle. `seo.canonicalUrl` sur `pages` est
  l'autre champ URL stocké qui atterrit dans un attribut sans passer par un
  assainisseur : même helper.
- `normalizePath` partagé backend ↔ web, avec un **test de contrat** entre les
  deux implémentations. C'est la classe de bug qui mord.
- Champ `kind` sur `revalidationOutbox` : sans lui, les lignes de redirection
  (sans `pageId`) tombent dans le balayage `pageId === undefined` de
  `pages.publicationStatus`, dont tout l'argument de coût est « cet ensemble
  ne grandit jamais ».
- Mémo des redirections côté Astro (60 s), **purgeable depuis
  `/api/revalidate`** — sinon une 301 fraîche reste invisible 60 s au lieu de
  5.
