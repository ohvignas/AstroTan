---
name: template-into-astrotan
description: Intégrer un template Astro tiers (starter, thème, kit acheté) dans apps/web — copier les fichiers, retirer ce qui ne peut pas suivre, rebrancher Convex. À invoquer dès qu'on demande de « reprendre le design de X », « porter ce starter », « cloner ce thème », ou quand un dépôt Astro externe est cloné dans un scratchpad pour servir de base visuelle. Porte les erreurs réellement commises lors du portage d'astro-emdash, pas des bonnes pratiques générales.
---

# Intégrer un template Astro dans AstroTan

## Ce que « porter un template » veut dire ici

Trois demandes se ressemblent et ne coûtent pas la même chose :

| Demande | Ce qu'on fait |
|---|---|
| « inspire-toi de X » | on prend les tokens, on écrit ses composants |
| « reprends le design de X » | on copie les composants, on branche notre câblage |
| « copie X tel quel » | on copie l'arborescence, puis on retire ce qui ne suit pas |

**Demander laquelle avant de commencer.** Le portage d'`astro-emdash` a été
fait deux fois : une première version « inspirée » a été rejetée en une
phrase — « t'as rien gardé du template ». Une reprise de tokens sans
composants ne ressemble à rien du template.

Et si une démonstration en ligne existe, **l'ouvrir et la capturer avant
d'écrire**. Déduire l'apparence d'un fichier CSS de 568 lignes rate ce qui
saute aux yeux : le thème par défaut d'`astro-emdash` est *sombre*, et rien
dans son CSS ne le dit — c'est un script du layout qui pose la classe.

## L'ordre qui garde le build vert

Chaque étape se termine par `pnpm --filter @astrotan/web run build`. Sauter
l'ordre coûte des heures de démêlage, parce que les erreurs d'Astro sur un
import cassé ne nomment pas le fichier fautif.

1. **Lire** le `global.css`, le layout de base, l'en-tête, le pied de page et
   la page d'accueil du template. Ces cinq fichiers portent 80 % du design.
2. **Fusionner les tokens** dans `packages/tokens/theme.css`. Jamais ailleurs
   (voir plus bas).
3. **Copier** les composants d'interface et de section, sans les retoucher.
4. **Remplacer les dépendances qui ne suivent pas** — icônes, `cn`, i18n.
   Build.
5. **Écrire les layouts**, avec `PageHead` et `Analytics`. Build.
6. **Réécrire les pages**, une par une, en gardant le câblage. Build.
7. **Supprimer** les composants remplacés, et grep pour les imports orphelins.
8. **Vérifier au navigateur** à 1440 / 768 / 375 px.

## Ce qui se copie tel quel

Les composants de présentation pure : cartes, grilles, sections, conteneurs,
boutons, tarifs, FAQ, hero. Ils ne dépendent que de variables CSS et de
`Astro.props`. Copier le fichier, changer les chemins d'import, terminé.

`clsx` et `tailwind-merge` sont déjà dans le dépôt — un `lib/cn.ts` copié
fonctionne sans rien installer.

## Ce qui résiste, et le remplacement qui marche

### i18n — retirer, ne pas adapter

Le site est en français, une seule langue. `t("nav.home")`, `resolveRoute()`,
`Astro.currentLocale`, `LanguageSwitcher` : remplacer par le texte français
et par le chemin littéral. C'est mécanique, et ça supprime deux fichiers de
configuration et un dictionnaire.

### Content collections — retirer

`getCollection("stack")`, `astro:content`, `src/content/` : nos contenus
viennent de Convex. Une collection ajoutée « juste pour six lignes » est un
**troisième magasin de données** dans un dépôt qui en a déjà deux. Remplacer
par un tableau littéral dans le frontmatter de la page qui s'en sert, et
faire descendre les entrées en propriété au composant.

### La couche SEO du template — retirer entièrement

Un template sérieux apporte son `SEO.astro`, son `JsonLd.astro`, ses images
OG dynamiques. **Tout cela est déjà chez nous, dans `PageHead.astro`**, et
alimenté par ce que l'administration saisit (`page.seo`, `page.geo`). Garder
les deux donne deux `<title>` et deux `og:image` dans le même document, qui
divergent dès le premier changement.

Piège précis rencontré : le `FAQ.astro` d'`astro-emdash` émet son propre
bloc JSON-LD `FAQPage`. `PageHead` en émet un depuis `page.geo.faq`. Les
deux se contredisent dès que l'administration en saisit un.

### `astro-icon` — remplacer par un composant local

`astro-icon` exige `@iconify-json/lucide` et `@iconify-json/simple-icons` :
une vingtaine de mégaoctets de dépendances pour la quinzaine de tracés
qu'un site utilise vraiment. Écrire
`components/ui/primitives/Icon/Icon.astro` avec une table
`Record<string, string>` de tracés SVG et **la même signature**
(`<Icon name="lucide:search" />`) : les appels copiés du template n'ont alors
pas à être relus.

### Le JavaScript des composants — réécrire en CSS

Contrainte du dépôt, et argument de vente de la page d'accueil : **aucun
`client:*`, aucun composant React**. Les trois cas rencontrés et leur
équivalent natif :

| Le template | L'équivalent sans JavaScript |
|---|---|
| onglets `role="tab"` + écouteurs | `<input type="radio">` masqués + `:checked ~` |
| accordéon FAQ + écouteur `toggle` | `<details name="faq">`, exclusif nativement |
| menu mobile + `aria-expanded` | `<input type="checkbox">` masquée + `<label>` |
| apparition au défilement (IntersectionObserver) | `animation-timeline: view()` sous `@supports` |

Le motif radio a un prix qu'il faut connaître **avant** de l'écrire : `~`
n'atteint que des frères. Les radios doivent donc être les **premiers
enfants** du conteneur, loin des étiquettes qu'elles commandent, et
l'appariement se fait par `:nth-of-type` — donc un nombre fini de règles
écrites en dur. Faire échouer la construction au-delà (`throw new Error`),
sinon un sixième onglet s'affiche sans jamais pouvoir être sélectionné.

Et toujours gater `animation-timeline: view()` derrière
`@supports (animation-timeline: view())` : sans ce garde, un navigateur qui
ignore la propriété applique quand même `opacity: 0` et la page est vide.

## Les points de branchement qui ne doivent jamais sauter

Un template fournit l'apparence ; notre code fournit les données et les
garanties. Là où les deux se contredisent, **notre câblage gagne**.

| Ce qui doit survivre | Où |
|---|---|
| `export const prerender = false` + `loadPage` | chaque page adossée à une ligne `pages` |
| `settings.homePageSlug`, branche 404, `Astro.response.status = 404`, `Astro.cache.set(false)` | `pages/index.astro` |
| `PageHead.astro` | le `<head>` de chaque page, via le layout |
| `Analytics.astro` (Umami) | le `<head>` de chaque page, via le layout |
| `loadPost` + `renderStoredHtml` | `/blog/[slug]` |
| `settings.siteName` / `settings.logoId` / `settings.socials` | en-tête et pied de page |
| `SiteMark.astro` | marque par défaut, en-tête + pied de page + favicon |

**Mettre `PageHead` et `Analytics` dans le layout, et nulle part ailleurs.**
Une page qui contourne le layout est une page non mesurée, et le trou ne se
voit pas. Le contrôle :

```bash
for p in / /a-propos /contact /services /tarifs /blog; do
  echo "$p $(curl -s http://127.0.0.1:4331$p | grep -c data-website-id)"
done   # chaque ligne doit finir par 1
```

**Chaque page ajoutée a besoin de sa ligne `pages` publiée**, sinon elle
répond 404 — c'est l'invariant, pas un défaut. Un agent n'a pas de session
pour la créer : **lister les slugs à créer dans le rapport final** plutôt que
de laisser l'utilisateur découvrir des 404.

`scripts/generate-served-paths.mjs` tourne au `prebuild` et suit tout seul
les fichiers ajoutés ou renommés — mais uniquement si le build est relancé.

## Les tokens : un seul fichier, et c'est `packages/tokens/theme.css`

Un template arrive avec `styles/tokens/{colors,typography,spacing}.css`. Les
recopier tels quels crée une seconde source de vérité à côté de `theme.css`,
qui est documenté comme LE point de personnalisation du site. **Fusionner les
trois dans `theme.css`**, et ne laisser dans `apps/web/src/styles/global.css`
que ce qui n'est pas un token : polices, styles de base, classes de sections
partagées.

Deux couches dans `theme.css`, et l'ordre compte :

1. des variables **nues** dans `:root` / `:root.dark` — toujours émises,
   c'est ce que lisent les blocs `<style>` copiés (`var(--muted-foreground)`) ;
2. un bloc `@theme` qui les expose à Tailwind (`bg-card`, `text-ink-mid`).

Tout mettre dans `@theme` casse en silence : Tailwind élague les tokens
qu'aucune classe n'utilise, et les `var()` écrits à la main dans les
`<style>` scoped se résolvent alors dans le vide.

Deux pièges de plus :

- **Ne pas déclarer `--spacing-*` dans `@theme`.** Tailwind v4 dérive `p-4` de
  `--spacing` seul ; y ajouter `--spacing-4` redéfinit l'échelle de tout le
  site. Nommer l'échelle du template autrement (`--space-lg`).
- **Garder les alias de nos pages existantes** (`--color-paper`,
  `--color-ink-mid`, `--color-rule`…) en les faisant pointer sur les tokens du
  template. Les supprimer « pour aligner » casse quatre pages afin de renommer
  des couleurs identiques.

## Le piège qui coûte le plus cher, et qui est muet

**Un `<style>` scoped d'Astro n'atteint pas les éléments rendus par un
composant enfant.** Astro n'appose son attribut de portée qu'aux balises
écrites dans *ce* fichier.

Concrètement : `ThemeToggle.astro` contient deux `<Icon>` et une règle
`.theme-toggle__icon--dark { display: none }`. La règle ne s'applique pas, et
**les deux icônes s'affichent en même temps**. Rien n'avertit — ni le build,
ni le typecheck, ni les tests.

Toute règle qui vise un élément venu de `<Icon>`, `<Image>`, `<SiteMark>` ou
de n'importe quel composant enfant doit passer par `:global()` :

```css
.theme-toggle :global(.theme-toggle__icon--dark) { display: none; }
.header__brand :global(.header__logo) { height: 2rem; }
```

Le contrôle après portage : lister les composants enfants de chaque
`.astro`, et vérifier qu'aucune règle scopée ne cible une de leurs classes.

## Les mesures affichées deviennent fausses

Une page d'accueil qui affiche « 0 octet de JavaScript » et « 12,8 ko à la
première visite » décrit **la page d'avant**. Après un portage qui apporte
des polices auto-hébergées et le CSS du template, les vraies valeurs étaient
1,3 ko de JavaScript en ligne (la bascule de thème) et 26 ko à la première
visite.

**Re-mesurer et corriger, puis le signaler.** Laisser un chiffre invérifiable
dans une vitrine technique se retourne contre elle : le premier lecteur qui
ouvre l'onglet réseau le vérifie. Et si le template propose un bloc de scores
Lighthouse à 100 : ne pas l'afficher sans avoir lancé Lighthouse.

```bash
curl -s http://127.0.0.1:4331/ -o /tmp/h.html
echo "HTML gzip: $(gzip -9c /tmp/h.html | wc -c)"
for f in $(grep -oE '/_astro/[^"]+\.css' /tmp/h.html | sort -u); do
  echo "$f $(curl -s http://127.0.0.1:4331$f | gzip -9c | wc -c)"
done
```

## Les garde-fous, qui doivent tous être muets

```bash
grep -rn 'style="' apps/web/src --include='*.astro'   # rien
grep -rn '<img '   apps/web/src --include='*.astro'   # rien
grep -rn 'client:' apps/web/src --include='*.astro'   # rien
PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @astrotan/web run build
pnpm --filter @astrotan/web exec vitest run
```

Le premier est un grep littéral : **il trouve jusqu'à une mention dans un
commentaire**. Écrire « un attribut `style` en ligne » et non l'exemple.

## La vérification visuelle

Le panneau navigateur intégré rend des captures périmées quand il est
masqué : le contenu apparaît blanc ou décalé alors que la page est correcte.
**Ne pas conclure sur une capture blanche.** Vérifier par
`get_page_text`, ou passer au MCP `playwright`, qui rend des captures fiables
même hors écran :

```
browser_navigate → browser_resize (1440/768/375) → browser_take_screenshot
browser_evaluate: () => document.documentElement.scrollWidth
                       - document.documentElement.clientWidth   // doit valoir 0
```

Et tester la bascule de thème dans les deux sens : un portage qui n'a été
regardé qu'en sombre laisse passer des couleurs dont la seule définition vit
dans `:root.dark`.
