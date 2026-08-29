---
name: consent-rgpd
description: Use when working on cookie consent, the consent banner, Google Consent Mode, tracking pixels (Meta, Google), or the regulatory pages (mentions légales, politique de confidentialité, politique de cookies) of the public Astro site. Also use when asked "how do I add a tracker", "why is there no banner", "add Facebook pixel", "RGPD", "GDPR", "CNIL", or when a third-party script must load only after consent.
---

# Consentement, cookies et pages réglementaires

## Le modèle, en une phrase

**Une balise qui dépose quelque chose sur l'appareil du visiteur, ou qui
l'identifie, attend son accord ; une balise qui ne fait ni l'un ni l'autre
n'attend rien.** Tout le reste découle de là.

Le modèle est celui d'[Open Consent](https://www.openconsent.dev/docs) (MIT) —
mêmes catégories, même `consentVersion`, même `expirationDays`, même Google
Consent Mode v2, même enregistrement de traçabilité. Ce qui change est
l'exécution : Open Consent se livre en composants React par le registre
shadcn, et `apps/web` ne charge aucun framework. **Ne pas l'installer** ;
ajouter React au site public pour un bandeau coûterait plus cher que tout ce
que le bandeau économise.

## Où vit quoi

| Fichier | Rôle |
|---|---|
| `apps/web/src/lib/consent.ts` | **La décision.** Quelles balises, pour quel accord. Pur, testé — aucun DOM, aucun stockage. |
| `apps/web/src/lib/consent.test.ts` | Le filet. `sans réponse, rien ne part` est le test à ne jamais casser. |
| `apps/web/src/config/consent.ts` | Le réglage du site : version, durée, position, Consent Mode, traçabilité. |
| `apps/web/src/components/consent/GoogleConsentMode.astro` | Le bloc `consent default` — en ligne dans le `<head>`, avant tout. |
| `apps/web/src/components/consent/ConsentBanner.astro` | Le bandeau, le panneau, l'injection. |
| `apps/web/src/config/legal.ts` | L'identité de l'éditeur et le registre des traitements. **À remplir par tout adoptant.** |
| `apps/web/src/pages/{mentions-legales,confidentialite,cookies}.astro` | Les trois pages. |
| `packages/backend/convex/consent.ts` | La preuve, si la traçabilité est allumée. |

## Ajouter un traceur

Une seule chose à faire, et une seule à ne pas faire.

**À faire** : ajouter le cas dans `consentTags()` de `lib/consent.ts`, avec sa
catégorie, sa source ou son code, et **les noms des cookies qu'il dépose** —
`cookies: ["_fbp", "_fbc"]`. Puis sa ligne dans `DEPOSITS`, dans
`pages/cookies.astro`. Puis **incrémenter `consentVersion`** dans
`config/consent.ts`.

**À ne pas faire** : poser la balise dans un `.astro`, un layout, ou
`Analytics.astro`. Une balise écrite dans le HTML part avant que quiconque ait
répondu, et le bandeau devient un décor.

L'oubli de `consentVersion` est le plus grave des trois : sans lui, des gens
auront « accepté » un tiers qui n'existait pas quand ils ont cliqué.

## Ce qui ne demande PAS d'accord, et pourquoi

`script.js` d'Umami — le comptage — ne dépose aucun cookie, ne conserve pas
l'adresse IP et ne suit personne d'un site à l'autre. Il compte des pages
vues, pas des personnes, et reste dans `analyticsScripts.ts`, chargé sans
condition.

`recorder.js` — Replays et Heatmaps — rejoue ce qu'une personne a fait sur la
page, y compris ce qu'elle a saisi. Il est dans `consentTags()`, catégorie
`analytics`. **Cette frontière est la seule décision subtile du dossier** :
la déplacer sans y penser transforme une mesure exemptée en traitement
illicite, ou l'inverse.

## Google Consent Mode v2

Obligatoire depuis mars 2024 pour tout site qui envoie du trafic de l'EEE, du
Royaume-Uni ou de la Suisse vers Google Analytics ou Google Ads. Sans lui,
Google **cesse de traiter** ces données — ce n'est pas une conformité de plus,
c'est la condition pour que la balise serve encore à quelque chose.

Trois choses doivent être vraies, et l'ordre en fait partie :

1. `gtag('consent','default', …)` avec **tout à `denied`** sauf
   `security_storage`, plus `wait_for_update: 500` ;
2. ce bloc s'exécute **avant** `gtag.js`. Ici c'est acquis par construction :
   `gtag.js` n'est jamais dans le HTML, il est injecté après réponse ;
3. `gtag('consent','update', …)` part **avant** l'injection de `gtag.js`,
   sinon la balise démarre sur le défaut et n'est corrigée qu'après son
   premier envoi.

Les sept signaux, et leur correspondance avec nos trois catégories, sont dans
`consentModeState()`. `ad_user_data` et `ad_personalization` sont l'ajout de
la v2 : les omettre, c'est rester en v1.

**La vérification qui prouve les trois points d'un coup**, sur une page
d'accueil avec `PUBLIC_GOOGLE_TAG_ID` posé :

```js
// Dans la console, AVANT de répondre au bandeau :
JSON.stringify(window.dataLayer)
// → un seul élément, "consent"/"default", tout "denied".
// Puis cliquer « Tout accepter » et redemander :
[...window.dataLayer].map((a) => Array.from(a))
// → ["consent","default",…], ["consent","update",…], ["js",…], ["config",…]
//    dans CET ordre. "update" après "config" est le bug.
```

## Les pixels Meta et Google

Deux variables, aucune obligatoire :

```bash
PUBLIC_META_PIXEL_ID=123456789012345
PUBLIC_GOOGLE_TAG_ID=G-XXXXXXXXXX
```

**Leur absence est l'interrupteur.** Sans elles, la catégorie « Publicité » ne
s'affiche pas, et sur un site qui n'a aucun traceur soumis à consentement,
le bandeau **ne s'affiche pas du tout** — `shouldAskConsent()` rend `false` et
`ConsentBanner.astro` ne rend rien. Demander l'autorisation de faire une
chose qu'on ne fait pas est une nuisance, et une description fausse du site.

`PUBLIC_`, et elles doivent l'être : un identifiant de pixel est visible dans
le source de chaque page de tout site qui en porte un. **Figées au build**,
comme `PUBLIC_CONVEX_URL` — les changer demande de reconstruire l'image.

La balise Google est classée `marketing`, pas `analytics`, alors même qu'elle
sert souvent à mesurer : le même `gtag.js` alimente Analytics ET Ads, et
l'identifiant seul ne dit pas lequel. Classer au plus exigeant est le seul
choix qui ne se trompe pas dans le sens qui coûte cher.

## La traçabilité

Le RGPD (art. 7-1) demande de pouvoir **démontrer** qu'une personne a
consenti, pas seulement d'avoir affiché un bandeau.

Éteinte par défaut, et c'est un arbitrage assumé : la garder, c'est conserver
un identifiant d'appareil et un horodatage pour chaque visiteur qui répond —
donc traiter une donnée personnelle de plus, au nom de la conformité. Un site
vitrine s'en passe ; un site qui fait de la publicité ciblée a intérêt à
l'allumer.

Pour l'allumer, **les deux moitiés** :

```bash
# 1. le secret, des deux côtés — identique, et long
cd packages/backend && npx convex env set CONSENT_LOG_SECRET "$(openssl rand -hex 32)"
# puis la même valeur dans l'environnement du conteneur `web`
```

```ts
// 2. apps/web/src/config/consent.ts
traceability: { enabled: true, endpoint: "/api/consent" },
```

Le secret seul n'allume rien : garder cette preuve est une décision, et elle
doit être écrite quelque part qu'on relit.

Relire une preuve — il n'y a pas encore d'écran pour cela :

```bash
cd packages/backend && npx convex run consent:history '{"visitorId":"…"}'
```

## Les pages réglementaires

Trois pages, trois fichiers, trois lignes publiées dans l'administration —
comme toute page de ce site (voir le skill `add-page`). Sans leur ligne,
elles répondent 404 et le pied de page a trois liens morts sur toutes les
pages du site.

`seed:demoContent` les crée. Sur un déploiement neuf :

```bash
cd packages/backend && npx convex run seed:demoContent
```

**`src/config/legal.ts` doit être rempli.** Les valeurs livrées décrivent le
dépôt AstroTan, pas votre site : les laisser publierait des mentions légales
fausses, ce qui est pire que pas de mentions légales du tout.

Le tableau `processings` décrit ce que le site fait **réellement**. Ajouter un
traitement y ajoute une ligne ; en garder une pour faire sérieux est une
déclaration fausse, et c'est exactement ce que le règlement sanctionne.

## Les pièges déjà payés

1. **`<dialog>` et le `margin: 0` global.** La feuille de style remet les
   marges à zéro sur tous les éléments, ce qui écrase le centrage que le
   navigateur applique lui-même à un `<dialog>` modal. Sans `margin: auto`
   explicite, le panneau s'ouvre collé en haut à gauche.
2. **L'espace avalé avant un lien.** `dans la\n<a>politique</a>` rend
   « lapolitique ». Écrire `dans la{" "}` avant le retour à la ligne.
3. **`dataLayer.push(["consent","update",…])` ne marche pas.** Les commandes
   `consent` de Google se lisent depuis l'objet `arguments` ; un tableau
   poussé à la place est ignoré en silence. On appelle le `gtag` global posé
   par `GoogleConsentMode.astro`.
4. **Une nouvelle query publique casse `pages.publicQueryFamily.test.ts`.**
   Le test refuse toute forme d'arguments qu'il ne sait pas piloter, exprès :
   lui apprendre la forme est le geste attendu, pas contourner le test.
5. **Retirer un accord doit effacer les cookies déjà posés**, puis recharger.
   Un script déjà chargé reste en mémoire tant que la page vit ; couper le
   futur en laissant le passé sur l'appareil n'est pas un retrait.

## La vérification qui compte

```bash
# 1. le HTML servi ne contient AUCUNE balise tierce avant réponse
curl -s http://localhost:4321/ | grep -cE "googletagmanager|connect\.facebook\.net|recorder\.js"   # → 0

# 2. le bandeau est là quand il doit l'être
curl -s http://localhost:4321/ | grep -c data-consent-banner                                        # → 1

# 3. les trois pages répondent
for p in /mentions-legales /confidentialite /cookies; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:4321$p"
done                                                                                                # → 200 ×3
```

Le premier contrôle est le seul qui ne se remplace pas par une lecture de
code : c'est celui qui a montré que `recorder.js` partait sans accord dans
tout ce qui a précédé ce dossier.
