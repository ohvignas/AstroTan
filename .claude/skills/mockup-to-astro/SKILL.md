---
name: mockup-to-astro
description: Use when converting an HTML mockup, a static export, or a design handoff into Astro pages and components in apps/web — including "intègre cette maquette", "clone ce design", "convertis ce HTML". Also use when asked to improve a page's performance, Lighthouse score, LCP, CLS, image loading, or font loading.
---

# Convertir une maquette en pages Astro

Le design d'un site fait avec ce template s'écrit en code. Une maquette
arrive en HTML ; le travail consiste à la transformer sans que le rendu
bouge, tout en remplaçant ce qu'un export statique fait mal.

## Ce qu'on demande au concepteur, en amont

Si la maquette n'est pas encore produite, ces contraintes-là évitent 90 % du
travail de conversion. Les faire appliquer coûte une passe au concepteur,
contre des heures ensuite.

1. **Tailwind v4 uniquement, aucun attribut `style=""`.** Valeur arbitraire
   quand rien ne correspond : `p-[26px]`, `bg-[#E8008A]`.
2. **CDN Tailwind dans le `<head>` pour l'aperçu**, commenté comme tel.
3. **Les couleurs et polices de la charte dans un seul bloc `@theme`**, jamais
   dupliquées ailleurs dans le balisage.
4. **Chaque section enveloppée** : `<section data-section="hero">`. Ce sont
   les points de découpe en composants, offerts.
5. **`<img>` avec `width` et `height` explicites**, `alt` rempli, chemins
   locaux groupés.
6. **HTML sémantique** : un seul `<h1>`, `<main>`, `<nav>`, `<footer>`,
   titres sans saut de niveau.
7. **Pas de JavaScript** ; composants interactifs figés dans leur état
   initial, avec un commentaire décrivant le comportement attendu.

## La conversion

### Prendre la référence visuelle AVANT de toucher à quoi que ce soit

C'est ce qui autorise à tout changer dessous. Ouvrir la maquette dans un
navigateur (MCP `playwright`) en 1440, 768 et 375 px, capturer. Après
conversion, capturer la page Astro aux mêmes tailles et comparer.

Seuil ~1 %, pas 0 : sous-ensembler une police en woff2 décale les métriques
d'une fraction de pixel, et convertir un JPEG en AVIF change la compression.

### Les remplacements, dans l'ordre

| Dans la maquette | Dans Astro | Pourquoi |
|---|---|---|
| `<img src="assets/x.jpg">` | `<Image src={import} />` depuis `src/assets/` | `srcset` + AVIF/WebP + pas de CLS |
| `style="padding:24px"` | `class="p-6"` | 40 éléments identiques → une règle CSS partagée |
| couleur en dur | token `@theme` | un seul endroit à changer |
| `.otf` / `.ttf` | `.woff2` sous-ensemblée, préchargée | ~70 % de poids en moins, rendu non bloqué |
| section répétée | composant sous `src/components/` | le HTML arrête de se répéter |
| SVG répété | un composant | autant de copies en moins par page |

**Le piège silencieux** : `astro:assets` n'optimise que ce qui est importé
depuis `src/`. Les assets doivent **déménager dans `src/assets/`** ; laissés
dans `public/`, ils traversent le pipeline sans être touchés et rien ne le
signale. Voir le skill `add-page`.

L'image du hero garde `loading="eager"` et `fetchpriority="high"` — c'est
l'élément LCP. Tout le reste passe en `loading="lazy"`.

### Ce qu'on retire, ce qu'on garde

- **Retirer** : la balise `<script>` du CDN Tailwind. Le build compile les
  classes.
- **Garder, et déplacer une seule fois** : le bloc
  `<style type="text/tailwindcss">` (`@theme`, `@font-face`, `@keyframes`,
  bases) vers `apps/web/src/styles/global.css`. Il est identique sur toutes
  les pages ; le copier dans chacune est la duplication à ne pas commencer.

### Brancher la page

Chaque page reçoit les quatre lignes du skill `add-page`. Le balisage
converti va dans la branche « page trouvée » ; la branche 404 reste distincte.

## Les garde-fous

Un règlement sans sanction est une suggestion. Ce qui doit faire échouer la
vérification :

```bash
# aucun style inline ne doit survivre
grep -rn 'style="' apps/web/src --include='*.astro' && echo "ÉCHEC"
# aucune balise img brute ne doit survivre
grep -rn '<img ' apps/web/src --include='*.astro' && echo "ÉCHEC"
# le site doit se construire
PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @astrotan/web build
```

Puis mesurer, et **reporter les chiffres réels** : poids HTML avant/après,
poids transféré (gzip), LCP. Une conversion sans mesure n'est pas une
conversion, c'est un déplacement de fichiers.

## Le responsive

Un export statique est presque toujours une mise en page desktop à largeur
fixe, sans point de rupture. Google indexe en mobile-first : un site non
responsive plafonne son référencement quoi qu'on fasse ensuite.

Les décisions à trancher — et à trancher **une fois**, puis à appliquer
partout, pas page par page :

- le menu devient un burger, ou un panneau plein écran ?
- les grilles de cartes s'empilent, ou défilent horizontalement ?
- dans le hero, l'image passe au-dessus ou en dessous du texte ?
- quels éléments décoratifs disparaissent sous 768 px ?

Si une version responsive de la maquette existe, elle sert de référence
mobile pour la comparaison pixel. Sinon, poser ces choix explicitement dans
le rapport, pour que la page suivante les reprenne au lieu d'en inventer
d'autres.
