/** Corps HTML des articles produit. Hors `seed.ts` pour ne pas le gonfler. */

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

export const VIBE_BODY = `
<p>Le vibecoding, c'est coder un site avec une IA dans l'éditeur. Tu décris la page à Cursor, le modèle pose le HTML, tu corriges, tu relances. En une soirée tu as une home qui tient sur <code>localhost:4321</code>.</p>
<p>Un client, un moteur ou ChatGPT ne voient pas localhost. Sans title, sans sitemap, sans consentement, sans déploiement qu'on sait annuler, tu as un proto. Un <strong>vibecoding site vitrine</strong> qu'on montre et qu'on classe demande le reste de la pile.</p>

<h2>Ce que le vibecoding produit</h2>
<p>Un fichier qui rend. Du React ou du HTML collé, un thème Tailwind. L'IA pose le markup en quelques passes. Elle invente aussi un plugin SEO, un bandeau cookies copié d'un tutoriel, un pixel dans le <code>&lt;head&gt;</code>. Ça tient jusqu'à la première mise à jour, ou jusqu'au premier audit.</p>
<p>Le modèle ignore tes secrets, tes rôles, et le filtre <code>status === "published"</code>. Il ne pose pas un rollback. Il ne sépare pas le design (le fichier) de la publication (la fiche).</p>

<h2>Le trou entre localhost et un client</h2>
<p>Pour montrer le site, il te faut une URL HTTPS, des balises, un sitemap qui ne liste que le publié, un <code>llms.txt</code> pour les IA, un bandeau qui n'apparaît que s'il y a un tiers à demander, et une pile que tu recules d'un sha.</p>
<p>Tu peux recoder tout ça à chaque projet. Ou partir d'un template qui le tient, et garder le vibecoding pour les pages.</p>

<h2>Ce qu'AstroTan pose autour du code</h2>
<p><a href="/blog/astrotan-site-vitrine-cms">AstroTan</a> est ce template. Site public Astro 7, admin TanStack Start, backend Convex, Docker derrière Traefik. Tu clones, tu pointes ton Convex et ton VPS. Les pages restent des <code>.astro</code> : tu les fais écrire par Cursor, tu les relis, tu les commits.</p>
<p>L'admin décide publication, title, description, résumé GEO, FAQ, mot-clé cible. Le site n'a ni session ni clé admin. Un brouillon reste invisible. Le consentement est déclaré ; aucun tag n'est écrit dans le HTML avant une réponse. Le rollback rejoue <code>convex deploy</code>, le build et Compose sur un sha.</p>

<h2>Ce que tu écris encore toi-même</h2>
<p>Le design. Les mots. Le fichier de chaque page. L'IA t'aide ; elle ne publie pas. Owner ou admin publie. Sur l'instance de démo, le compte Tester refuse ces mutations côté serveur.</p>
<p>Pour le détail SEO et GEO, lire <a href="/blog/site-seo-geo">site SEO GEO</a>. Pour se passer de WordPress, <a href="/blog/site-vitrine-sans-wordpress">l'article comparatif</a>. Les <a href="/fonctionnalites">fonctions déjà résolues</a> et les <a href="/tarifs">tarifs</a> sont à côté. Pour un projet, <a href="/contact">écrire</a> suffit.</p>
`.trim()

export const GEO_BODY = `
<p>Un <strong>site SEO GEO</strong> tient sur deux couches. Le HTML public, que tu contrôles. Les champs de la fiche (title, description, résumé, FAQ), que l'admin remplit une fois. Sitemap, JSON-LD et <code>llms.txt</code> sortent de ces champs. Ils ne peuvent pas décrire la page autrement.</p>
<p>AstroTan pose cette séparation. Tu n'installes pas Yoast. Tu n'ouvres pas GTM pour coller un pixel. Le détail sans WordPress est dans <a href="/blog/site-vitrine-sans-wordpress">l'article comparatif</a> ; celui-ci dit comment le SEO et le GEO se tiennent.</p>

<h2>Title, description, sitemap depuis la fiche</h2>
<p>Chaque page et chaque article portent un title, une description, un canonique, un interrupteur noindex. Le <code>&lt;head&gt;</code> les rend. <code>sitemap.xml</code> liste uniquement les contenus publiés. Le mot-clé cible vit à côté : il servira à un relevé DataForSEO plus tard. Il n'écrit rien tout seul dans le HTML.</p>
<p>JSON-LD Organization, Article, FAQPage et fil d'Ariane viennent des mêmes données. Une FAQ saisie dans l'admin apparaît dans la page et dans le graphe.</p>

<h2>Résumé, entités, llms.txt pour les IA</h2>
<p>Le GEO, ici, ce sont les champs que recopie un moteur de réponse. Un résumé de quelques phrases, des entités nommées, une FAQ autonome. <code>llms.txt</code> liste les pages et articles publiés, avec ce résumé. « Ne pas indexer » et « ne pas faire citer » sont deux interrupteurs. Une page juridique peut refuser la citation sans disparaître de Google.</p>
<p>Le bouton « Générer avec l'IA » du dashboard produit ces champs à partir du titre, du corps et du mot-clé. OpenRouter, clé chiffrée, jamais en clair dans la table publique <code>settings</code>.</p>

<h2>Le HTML reste dans le fichier .astro</h2>
<p>Une page <em>est</em> son fichier. La base porte slug, titre, statut, SEO et GEO. Tu fais écrire le <code>.astro</code> en vibecoding si tu veux ; le référencement se saisit dans l'admin, pas dans un frontmatter que personne ne relit. L'<a href="/blog/astrotan-site-vitrine-cms">article pilier</a> raconte cette règle. L'article <a href="/blog/vibecoding-site-vitrine">vibecoding</a> dit pourquoi le proto ne suffit pas.</p>

<h2>Les pixels attendent une réponse</h2>
<p>Umami, Meta, Google : chacun est déclaré dans le registre de consentement. Aucun tag n'est écrit dans le HTML avant que le visiteur réponde. Ajouter un tiers impose d'incrémenter la version, sinon les gens auraient accepté un outil absent au clic.</p>
<p>Umami tourne dans la même pile Docker. Les identifiants de lecture ne touchent pas le navigateur. Compter une visite n'est pas rejouer la session. Les <a href="/fonctionnalites">fonctions</a>, les <a href="/tarifs">tarifs</a> et le <a href="/contact">formulaire</a> sont sur le site. L'<a href="/">accueil</a> résume le produit.</p>
`.trim()

export const VPS_BODY = `
<p>Installer un <strong>site vitrine sur un VPS</strong>, avec AstroTan, c'est un ordre. Convex d'abord, variables ensuite, DNS, puis Compose derrière Traefik. Inverser deux étapes, c'est un certificat refusé ou un frontend qui parle à un schéma trop vieux.</p>
<p>Personne ne « déploie AstroTan » pour toi. Tu clones le template. Chaque instance a son Convex, ses domaines, sa machine. Cette page dit la séquence. Le <a href="/blog/astrotan-site-vitrine-cms">pilier</a> dit ce que tu installes.</p>

<h2>Ce qu'il te faut avant de commencer</h2>
<p>Un déploiement Convex (URLs <code>*.convex.cloud</code> / <code>*.convex.site</code>, clé de deploy). Un dépôt GitHub. Deux domaines, site et admin. Un VPS avec Docker, un utilisateur non-root, les ports 80 et 443 libres. Une clé SSH pour le workflow.</p>
<p>Les packages GHCR sont privés par défaut. Décide public ou <code>docker login</code> avant le premier pull. Sinon Compose échoue sur une image que la machine n'a pas le droit de lire.</p>

<h2>Bootstrap, puis le premier déploiement</h2>
<p><code>pnpm bootstrap</code> est le seul script qui voit toute la configuration. Il lit <code>.env.deploy</code>, pose les variables Convex, écrit les <code>.env.local</code>, pousse les secrets GitHub, prépare <code>.env.vps</code>. Tu copies ce fichier sur la machine, <code>chmod 600</code>. Le pipeline ne l'écrase jamais.</p>
<p>Après le premier <code>convex deploy</code>, tu relances bootstrap une fois : il crée les lignes <code>pages</code> (sans elles chaque URL répond 404) et le premier compte, rôle <code>owner</code>. Un premier compte <code>admin</code> bloque le déploiement à un seul administrateur, sans issue par l'interface.</p>

<h2>Certificats en staging</h2>
<p>Let's Encrypt production autorise cinq certificats par sept jours. Le premier essai se fait contre la CA de staging. Le DNS doit pointer sur le VPS, sans proxy orange devant le challenge HTTP-01. Quand le staging répond, tu bascules.</p>
<p>Umami, Redis et Postgres partent dans la même pile. Le site public n'embarque aucun cookie de mesure tant que tu n'as pas déclaré le tracker et obtenu une réponse.</p>

<h2>Rollback : rejouer un sha</h2>
<p>Remettre les anciennes images laisse le schéma d'aujourd'hui face au frontend d'hier. <code>convex deploy</code> a déjà remplacé functions et tables. Le retour arrière relance le pipeline entier sur un sha : functions, images, compose.</p>
<p>Pour le SEO une fois en ligne, <a href="/blog/site-seo-geo">site SEO GEO</a>. Pour un proto Cursor, <a href="/blog/vibecoding-site-vitrine">vibecoding</a>. Les <a href="/fonctionnalites">fonctions</a>, les <a href="/tarifs">tarifs</a>, <a href="/contact">écrire</a>.</p>
`.trim()
