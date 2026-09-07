/** Corps HTML des deux articles produit. Hors `seed.ts` pour ne pas le gonfler. */

export const PILLAR_BODY = `
<p>AstroTan n'est pas un site que quelqu'un héberge pour toi. C'est un template : tu clones le dépôt, tu pointes ton propre déploiement Convex, tes domaines et un VPS, puis tu écris tes pages en fichiers <code>.astro</code>. Le dashboard décide qui doit trouver une page. Jamais ce qu'elle contient.</p>
<p>Trois morceaux, une pile :</p>
<ul>
<li>le site public, <a href="/fonctionnalites">Astro 7</a> en rendu serveur ;</li>
<li>l'administration, TanStack Start et React 19 ;</li>
<li>Convex, partagé, pour les données, l'auth et les articles.</li>
</ul>
<p>Docker et Traefik posent le tout sur une machine. Le rollback rejoue le pipeline sur un sha, pas les images seules : <code>convex deploy</code> a déjà remplacé functions et schéma.</p>

<h2>Pour qui c'est fait</h2>
<p>Pour une agence ou un indépendant qui livre des sites vitrine, et qui en a assez de WordPress plus dix extensions pour le SEO, les cookies et le formulaire. Tu sais lire un fichier. Tu ne veux pas qu'un visiteur charge 400 ko de JavaScript pour une page de 26 ko.</p>
<p>Ce n'est pas un constructeur de pages dans le navigateur. Si tu cherches Elementor, passe ton chemin. Si tu veux que le design vive dans le code, et le référencement dans l'admin, c'est le bon outil.</p>

<h2>Ce qu'une page est, ce qu'un article est</h2>
<p>Une page <em>est</em> son fichier. Le balisage, la mise en page et les mots s'écrivent depuis une maquette. La ligne en base porte le slug, le titre, le statut, le SEO et le GEO. Trois modèles de contenu ont été essayés puis retirés (blocs, Markdown de page, champs déclarés). Chacun refaisait plus mal ce que le fichier fait déjà.</p>
<p>Un article, lui, porte son texte en base. Un billet <em>est</em> du contenu. L'éditeur riche du dashboard écrit de l'HTML, assaini avant d'atteindre un visiteur. C'est le seul endroit du template où la base garde du corps.</p>

<h2>Ce que l'administration décide</h2>
<p>Publication, aperçu à la vraie URL (jeton HMAC sur le slug, jamais une route parallèle), balises title et description, résumé GEO pour les moteurs de réponse, FAQ en JSON-LD, mot-clé cible pour DataForSEO plus tard. L'accès est sur invitation seule : pas d'inscription ouverte, pas d'OAuth. Le rôle vit sur l'utilisateur Better Auth. Chaque mutation le revérifie. L'interface masque, elle ne décide pas.</p>
<p>Un brouillon n'est jamais public. Le site n'a ni session ni clé d'administration. Il n'appelle que des queries qui filtrent <code>status === "published"</code> côté serveur. Connaître l'adresse ne suffit pas à lire le brouillon.</p>

<h2>La pile, sans promesse en trop</h2>
<p>Astro 7, adaptateur Node standalone. TanStack Start pour le dashboard ; TanStack Query n'est pas dans le dépôt, Convex pousse déjà les mises à jour. Better Auth en installation locale. Umami auto-hébergé pour l'audience, sans cookie. Consentement et pixels déclarés : aucun tag tiers n'est écrit dans le HTML avant une réponse.</p>
<p>Les <a href="/tarifs">tarifs</a> et le <a href="/contact">formulaire</a> sont sur le site. La page d'<a href="/">accueil</a> dit la même chose que celle-ci, plus court.</p>
`.trim()

export const COMPARE_BODY = `
<p>WordPress reste le réflexe pour un site vitrine. Tu installes le CMS, un thème, Yoast, un bandeau de cookies, un plugin de cache, un constructeur. Six mois plus tard le thème a divergé, le plugin SEO a changé de propriétaire, et le HTML public n'est plus celui que tu as validé.</p>
<p>AstroTan inverse la charge. Le site public est du code Astro. L'administration gère publication, SEO, consentement et accès. Tu n'installes pas une extension pour chaque trou. Les trous sont déjà fermés, ou ils n'existent pas.</p>

<h2>SEO sans plugin</h2>
<p>Title, description, canonique, noindex : des champs sur la fiche. Le <code>&lt;head&gt;</code> les rend. JSON-LD Organization, Article, FAQPage et fil d'Ariane sortent des mêmes données. <code>sitemap.xml</code> et <code>llms.txt</code> listent uniquement les pages et articles publiés. « Ne pas indexer » et « ne pas faire citer par une IA » sont deux interrupteurs distincts.</p>
<p>Le mot-clé cible vit à côté du SEO, pas dedans. Il débloque un relevé DataForSEO plus tard. Il ne s'invente pas tout seul dans le HTML.</p>

<h2>Consentement sans GTM bricolé</h2>
<p>Aucun pixel n'est écrit dans la page. Umami, Meta, Google : chacun est déclaré dans le registre de consentement du site. Le bandeau n'apparaît que s'il y a quelque chose à demander. Ajouter un tiers impose d'incrémenter la version de consentement, sinon les gens auraient « accepté » un outil qui n'existait pas au clic.</p>
<p>Umami tourne dans la même pile Docker. Les identifiants de lecture ne touchent pas le navigateur. Compter une visite n'est pas rejouer la session : le recorder est un autre réglage, éteint par défaut.</p>

<h2>Admin sans wp-admin</h2>
<p>TanStack Start, pas une page PHP. Invitation, rôles owner / admin / editor. Un editor écrit ses brouillons. Publier exige owner ou admin. Sur l'instance publique de démonstration, le compte Tester ne publie pas, ne pose pas de secret, ne génère pas de couverture : ces mutations refusent le compte démo côté serveur.</p>
<p>Les articles s'écrivent dans l'éditeur. « Générer avec l'IA » produit le SEO et le GEO à partir du titre, du corps et du mot-clé. Une autre action pose une couverture. Les deux passent par OpenRouter, clé chiffrée, jamais en clair dans la table publique <code>settings</code>.</p>

<h2>Mise en ligne sur un VPS</h2>
<p>Compose, Traefik, certificats Let's Encrypt. Premier essai en CA de staging : la prod plafonne à cinq certificats par semaine. Le DNS doit pointer sur la machine, sans proxy orange devant le challenge HTTP-01.</p>
<p>Un rollback n'est pas « remettre les anciennes images ». C'est rejouer <code>convex deploy</code> + build + compose sur un sha. Les images seules laisseraient le schéma d'aujourd'hui face au frontend d'hier.</p>
<p>Le détail des <a href="/fonctionnalites">fonctions déjà résolues</a> et les <a href="/tarifs">tarifs</a> sont à côté. Pour un projet, <a href="/contact">écrire</a> suffit. L'<a href="/">accueil</a> résume le produit en une page.</p>
`.trim()
