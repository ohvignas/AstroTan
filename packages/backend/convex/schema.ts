import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { LEAD_STATUSES } from "./content"
import {
  roleValidator,
  pageStatusValidator,
  outboxStatusValidator,
  consentActionValidator,
} from "./validators"
import { geoValidator, seoValidator } from "./content"
import { auditActionValidator } from "./lib/auditEvent"

// `seoValidator`/`geoValidator` live in `content.ts`, alongside the length
// bounds Convex's `v.string()` cannot express itself
// (`assertPageTextWithinLimits`), so `pages.create`/`pages.update` import
// the identical validators rather than redeclaring their shape.

// Le validateur des colonnes, dérivé de la liste unique de `content.ts` —
// pour qu'ajouter une colonne ne demande pas de penser au schéma.
const leadStatusValidator = v.union(
  ...LEAD_STATUSES.map((status) => v.literal(status)),
)

export default defineSchema({
  // Pas de champ `role` ici : il vit sur l'utilisateur Better Auth.
  profiles: defineTable({
    authUserId: v.string(),
    displayName: v.string(),
    avatarId: v.optional(v.id("_storage")),
  }).index("by_auth_user", ["authUserId"]),

  invitations: defineTable({
    email: v.string(),
    role: roleValidator,
    tokenHash: v.string(),
    expiresAt: v.number(),
    invitedBy: v.string(),
    acceptedAt: v.optional(v.number()),
    // Staged plaintext token, cleared (patched away) by
    // `internal.invitations.claimPendingToken` the moment the scheduled
    // send job actually runs, and again defensively by `accept` on
    // successful acceptance. Review round 1, I1: the token used to be a
    // scheduled-function *argument* instead, which Convex retains verbatim
    // in the `_scheduled_functions` system table (readable via
    // `ctx.db.system` from any function in the deployment, and visible in
    // the dashboard) for as long as that job record exists — contradicting
    // `lib/token.ts`'s own claim that the plaintext is "never persisted
    // anywhere". Staging it here instead, in a row we control, is what
    // bounds the exposure on the paths this project actually exercises to
    // milliseconds (scheduling to claim) or the time until acceptance.
    //
    // Not an unconditional bound (review round 2, item 3): if the
    // scheduled action fails before its own claim-and-clear mutation call
    // returns, and the invitation is then never accepted or revoked,
    // nothing clears this field — it sits on the row, unreachable through
    // any query (see `invitations.list`), until an operator revokes the
    // invitation (deleting the row) or `expiresAt` passes with nothing
    // acting on it. See `invitations.ts`'s `create` for the full account of
    // what is and isn't actually bounded.
    pendingToken: v.optional(v.string()),
    // The scheduled `sendInvitationEmail` job's own id, so `revoke` can
    // cancel it (M8) rather than letting an already-revoked invitation's
    // email go out after the fact.
    scheduledEmailId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"]),

  // Task 1 of Lot 2: shapes only. Nothing here enforces the lot's
  // invariant ("a draft is visible only to a valid preview-token holder,
  // a published page needs no rebuild") — that's Task 2's public/preview
  // query split. This table just has to make that split easy to write and
  // hard to get wrong: `status` is a closed two-value union a public query
  // can filter on with a plain `.eq`, not a free-form string a filter
  // could silently fail to match.
  pages: defineTable({
    slug: v.string(),
    title: v.string(),
    status: pageStatusValidator,
    // The page's content, as Markdown. A page is text plus settings, not a
    // tree of composable blocks — see `content.ts`'s header for why this
    // template deliberately has no page builder.
    //
    // Required: the expand/migrate/contract cycle that replaced the old
    // `blocks` field is complete (`migrations.ts`'s `blocksToMarkdown`,
    // run against every existing row before this field was tightened and
    // `blocks` dropped from the schema).
    // No content field of any kind, and that is the design: a page's
    // markup is an `.astro` file written in code, and this row carries
    // only what the dashboard is allowed to decide — the slug it answers
    // on, its title, whether it is live, and how it should be found.
    seo: v.optional(seoValidator),
    // Generative Engine Optimization: the abstract, FAQ and entities an
    // answer engine needs to quote the page rather than paraphrase it.
    geo: v.optional(geoValidator),
    publishedAt: v.optional(v.number()),
    // `v.string()`, not `v.id()`: both hold a Better Auth user id, and
    // Better Auth's tables live in a Convex *component* (Local Install,
    // §5) — Convex doesn't type references across that boundary, the same
    // reason `profiles.authUserId` is a bare string. Resolving either to a
    // displayable name goes through `profiles.by_auth_user`.
    createdBy: v.string(),
    updatedBy: v.string(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),

  // Le seul endroit où ce template garde encore du contenu en base, et
  // l'exception est délibérée : un article de blog *est* du contenu, et
  // personne ne demandera à un agent d'écrire chaque billet. Les pages ont
  // pris le chemin inverse — une page est son fichier `.astro`.
  posts: defineTable({
    slug: v.string(),
    title: v.string(),
    excerpt: v.optional(v.string()),
    // `_storage` directement, comme `seo.ogImageId` : la table `media` est
    // un sidecar de métadonnées, pas la cible des références.
    coverId: v.optional(v.id("_storage")),
    body: v.string(),
    status: pageStatusValidator,
    seo: v.optional(seoValidator),
    geo: v.optional(geoValidator),
    publishedAt: v.optional(v.number()),
    tagIds: v.array(v.id("tags")),
    createdBy: v.string(),
    updatedBy: v.string(),
  })
    .index("by_slug", ["slug"])
    // Composite dans cet ordre : `/blog` demande « les publiés, du plus
    // récent au plus ancien » en un seul parcours d'index, jamais un
    // `.collect()` filtré en mémoire.
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_created_by", ["createdBy"]),

  // Une redirection ne peut jamais rendre inatteignable un contenu vivant.
  // Le middleware s'exécutant avant la route, une redirection qui
  // revendique un chemin déjà servi l'avale purement et simplement — sans
  // erreur, sans trace. La garde est donc à l'écriture, aux **trois** points
  // où la paire (redirection, contenu) peut entrer en conflit : la création,
  // le côté slug, et la réactivation d'une redirection désactivée.
  // Une personne qui a écrit depuis le formulaire de contact.
  //
  // C'est la SEULE table que le site public alimente. Partout ailleurs il ne
  // fait que lire, et cette exception est la raison pour laquelle l'écriture
  // passe par une porte étroite : une route Astro qui voit l'IP, limite le
  // débit et détient un secret partagé. Le navigateur n'écrit jamais ici.
  //
  // Une personne, pas un message : quelqu'un qui réécrit ne crée pas une
  // seconde carte. Sa fiche garde son nom, ses messages s'ajoutent dans
  // `leadMessages`, et elle repasse en tête du tableau — parce qu'il y a de
  // nouveau quelque chose à traiter.
  leads: defineTable({
    name: v.string(),
    email: v.string(),
    status: leadStatusValidator,
    // Quand cette personne a écrit pour la dernière fois. Distinct de
    // `_creationTime`, qui date sa première venue : c'est le récent qui
    // décide de l'ordre de la colonne, pas l'ancienneté.
    lastMessageAt: v.number(),
    messageCount: v.number(),
  })
    // L'unicité se joue sur l'email : c'est ce qui fait qu'un habitué reste
    // une seule carte. Convex n'a pas de contrainte d'unicité — cet index
    // est ce qui rend la vérification possible avant écriture.
    .index("by_email", ["email"])
    // Une colonne du tableau se lit par ce couple : son statut, et le plus
    // récent en tête.
    .index("by_status", ["status", "lastMessageAt"]),

  // Ce qu'une personne a écrit, une ligne par envoi.
  //
  // Séparé de la fiche pour que réécrire n'efface rien. Fusionner les deux
  // obligerait à choisir entre garder le premier message ou le dernier, et
  // les deux choix perdent quelque chose que personne ne pourra retrouver.
  leadMessages: defineTable({
    leadId: v.id("leads"),
    subject: v.optional(v.string()),
    body: v.string(),
    // Recopié depuis la requête, jamais pour identifier quelqu'un : il sert
    // à reconnaître une vague d'envois automatiques après coup.
    userAgent: v.optional(v.string()),
  }).index("by_lead", ["leadId"]),

  // Ce qui est arrivé à une fiche, dans l'ordre où c'est arrivé.
  //
  // La table `leads` ne porte que l'état COURANT : `status` dit où la fiche
  // se trouve aujourd'hui, et le déplacement qui l'y a amenée n'existait
  // nulle part — `leads.move` écrivait le nouveau statut par-dessus
  // l'ancien, qui disparaissait. Un tableau à colonnes sans mémoire des
  // colonnes traversées ne permet pas de répondre à « depuis quand cette
  // personne attend ? », qui est la seule question qu'on se pose devant
  // une fiche ancienne.
  //
  // Les événements sont écrits DANS la mutation qui change les choses, pas
  // par une action planifiée : une écriture planifiée peut échouer seule,
  // et un historique auquel il manque une ligne est pire qu'absent — on le
  // croit complet.
  //
  // Champs à plat plutôt qu'une union d'objets : `from`/`to` n'ont de sens
  // que pour `status`, `messageId` que pour `message`. Une union donnerait
  // ce typage gratuitement, mais un index Convex se déclare sur un champ
  // commun à toutes les branches, et c'est `leads.timeline` — un seul
  // lecteur, un seul endroit — qui recompose la forme typée à la lecture.
  leadEvents: defineTable({
    leadId: v.id("leads"),
    type: v.union(v.literal("created"), v.literal("message"), v.literal("status")),
    // Le couple qui manquait. `from` absent sur `created` : rien ne
    // précède la création.
    from: v.optional(leadStatusValidator),
    to: v.optional(leadStatusValidator),
    // Le message que cet événement accompagne. Le CORPS n'est pas recopié
    // ici : il vit dans `leadMessages` et nulle part ailleurs, sans quoi
    // deux copies du même texte finiraient par diverger.
    messageId: v.optional(v.id("leadMessages")),
    // Qui a fait le geste, quand il vient de l'administration. Absent
    // quand il vient du visiteur — c'est ce qui distingue « Antoine a
    // classé la fiche » de « la personne a réécrit ».
    actorId: v.optional(v.string()),
    // Le nom d'affichage RECOPIÉ au moment du geste, volontairement. Un
    // historique doit rester lisible après un changement de nom ou la
    // suppression du compte ; le relire à l'affichage rendrait des lignes
    // anonymes le jour où quelqu'un s'en va.
    actorName: v.optional(v.string()),
  }).index("by_lead", ["leadId"]),

  // La preuve du consentement — voir `consent.ts` pour pourquoi elle est
  // éteinte par défaut. Une ligne par geste, jamais écrasée : « a accepté
  // puis retiré » est une information, et un enregistrement qui garde
  // seulement le dernier état ne peut plus la produire.
  consentRecords: defineTable({
    consentVersion: v.string(),
    visitorId: v.string(),
    consentId: v.string(),
    action: consentActionValidator,
    // ISO 8601 tel que le navigateur l'a produit, gardé en chaîne : c'est
    // l'heure de l'appareil qui a répondu, pas celle de notre serveur, et
    // les convertir en nombre effacerait le fuseau — qui fait partie de la
    // preuve.
    timestamp: v.string(),
    analytics: v.boolean(),
    marketing: v.boolean(),
    preferences: v.boolean(),
  })
    .index("by_visitor", ["visitorId"])
    // Ce qui rend l'écriture idempotente : la requête part en `keepalive`
    // au moment où quelqu'un quitte la page, et peut être rejouée.
    .index("by_consent", ["consentId"]),

  // Ce que quelqu'un a fait, et qu'on ne pourrait pas reconstituer
  // autrement. Le dépôt sait déjà qui a CRÉÉ une page (`createdBy`) et qui
  // a déplacé une fiche (`leadEvents.actorName`) ; il ne savait pas qui
  // avait changé un rôle, écrit un jeton, supprimé un contact ou dépublié.
  //
  // Écrit DANS la même mutation que le geste, jamais par une action
  // planifiée : une action planifiée peut échouer seule, et un journal
  // auquel il peut manquer une ligne est pire qu'absent — on le croit
  // complet.
  //
  // Jamais de valeur de secret ici, même tronquée : un journal se relit
  // longtemps après, souvent par plus de monde que l'écran d'origine. Le
  // nom du jeton suffit, et `auditLog.test.ts` l'atteste avec une valeur
  // sentinelle plutôt que de le promettre.
  //
  // AUCUN INDEX, et c'est délibéré. Le seul ordre dont ce journal a besoin
  // est le chronologique, que Convex sert déjà par l'index implicite
  // `by_creation_time` de toute table — un `.index("by_creation", [])`
  // n'ajouterait rien qu'un nom de plus à lire dans le schéma. Un index
  // par acteur ou par action se justifiera le jour où l'écran de lecture
  // filtrera dessus, pas avant.
  auditLog: defineTable({
    action: auditActionValidator,
    // L'identifiant Better Auth de l'acteur : ce qui permet de recouper
    // deux lignes même après un changement de nom.
    acteurId: v.string(),
    // Le nom d'affichage RECOPIÉ au moment du geste. Le relire à
    // l'affichage rendrait anonymes toutes les lignes le jour où quelqu'un
    // quitte l'équipe — et c'est ce jour-là qu'on relit un journal.
    acteurNom: v.string(),
    // Ce que le geste visait, déjà composé par le point d'écriture : le
    // seul à savoir ce qu'il est prudent d'y mettre. Absent pour
    // `settings.update`, qui ne vise rien en particulier.
    cible: v.optional(v.string()),
    detail: v.optional(v.string()),
  }),

  redirects: defineTable({
    // Normalisé comme un slug de page : sans slash de tête ni de fin, pour
    // que `/contact`, `contact` et `/contact/` ne puissent pas désigner
    // trois lignes différentes.
    from: v.string(),
    to: v.string(),
    code: v.union(v.literal(301), v.literal(302)),
    enabled: v.boolean(),
    createdBy: v.string(),
  }).index("by_from", ["from"]),

  // Singleton : une ligne, ou aucune. Ce qui appartient au *site* plutôt
  // qu'à une page — son nom, son logo, la page servie à `/`, les valeurs
  // SEO par défaut. Une page décide de son slug et de son SEO ; elle ne
  // peut pas décider qu'elle est la page d'accueil, parce que c'est une
  // affirmation sur le site, et que deux pages pourraient sinon la
  // revendiquer toutes les deux.
  settings: defineTable({
    siteName: v.string(),
    logoId: v.optional(v.id("_storage")),
    // Distincte du logo, et pas par goût du réglage : le logo porte le nom
    // écrit et s'affiche en large dans l'en-tête ; l'icône est carrée et
    // sert là où la place est contrainte — favicon, onglet, partage. Servir
    // le logo comme favicon rendrait le nom illisible à 32 px.
    iconId: v.optional(v.id("_storage")),
    // Un slug, pas un identifiant de document : `index.astro` cherche la
    // page par slug comme toutes les autres routes, donc un seul chemin de
    // résolution. `pages.update` suit le renommage pour que la page
    // d'accueil reste la page d'accueil.
    homePageSlug: v.optional(v.string()),
    defaultSeo: v.optional(seoValidator),
    socials: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),

    // Le webhook déclenché à l'arrivée d'un lead — n8n, Make, ou n'importe
    // quel service qui écoute une URL. Trois champs et pas un de plus :
    // l'adresse, le secret qui signe l'envoi, et l'état du dernier essai.
    //
    // `leadWebhookLastStatus` existe parce qu'un webhook muet depuis trois
    // semaines est le défaut le plus courant de ce genre d'intégration :
    // sans trace visible dans l'écran, personne ne s'aperçoit qu'il ne part
    // plus rien.
    leadWebhookUrl: v.optional(v.string()),
    leadWebhookSecret: v.optional(v.string()),
    leadWebhookLastStatus: v.optional(v.string()),
    leadWebhookLastAt: v.optional(v.number()),

    // L'adresse d'expédition des emails. PAS un secret : elle apparaît dans
    // l'en-tête de chaque message envoyé. Elle peut donc rester dans
    // `settings`, contrairement aux jetons.
    emailFrom: v.optional(v.string()),

    /**
     * Le domaine que l'opérateur déclare depuis `/settings/domaine`.
     *
     * Il ne se contentait de rien piloter : le domaine réel était figé au
     * build et dans les labels Docker, et ce champ ne servait qu'à
     * vérifier le DNS et à signaler une divergence. Il PILOTE désormais,
     * et c'est tout l'objet du lot « changer de domaine depuis le
     * dashboard » : le routage Traefik (`convex/routing.ts` → le service
     * `routeur`) et les deux origines des liens envoyés par email
     * (`convex/lib/origines.ts`) en dérivent.
     *
     * Conséquence directe, et la raison pour laquelle chaque lecteur le
     * revalide : cette chaîne devient une règle de routage et une origine
     * d'URL. `settings.update` la valide à l'écriture, mais ce n'est pas
     * le seul chemin qui écrit ici (migration, `npx convex run`,
     * restauration de sauvegarde). `normaliserHote` repasse dessus à
     * chaque lecture, et une valeur douteuse REPLIE sur l'environnement
     * au lieu de sortir.
     */
    declaredDomain: v.optional(v.string()),

    /**
     * Les hôtes web SORTANTS : ceux d'avant le dernier changement de
     * domaine, avec la date à laquelle chacun a cessé d'être le courant.
     *
     * Tout ce lot applique le même principe — ajouter, vérifier, puis
     * seulement retirer. Le service `routeur` garde les anciens hôtes
     * routés jusqu'à ce que le nouveau serve un certificat valide ;
     * `trustedOrigins` ajoute la nouvelle origine sans retirer l'ancienne.
     * Ce champ est ce qui manquait pour que la validation d'hôte du site
     * public l'applique aussi : sans lui, un visiteur qui arrive encore
     * sur l'ancien domaine — DNS pas propagé, résolveur qui garde son
     * cache — n'est pas reconnu, son `x-forwarded-for` n'est pas honoré,
     * et il partage un seau de limitation de débit avec tous les autres
     * retardataires.
     *
     * `settings.update` les note, `routing.hotes` les filtre à la lecture,
     * et les deux passent par `lib/hotesSortants.ts` — c'est là que vivent
     * la fenêtre (72 h) et le plafond (5 entrées), avec leur justification.
     *
     * **Ce qu'un hôte sortant autorise, et rien de plus** : honorer
     * `x-forwarded-for` (`routing.hotes`), servir d'origine de confiance
     * pour ENTRER — se connecter, demander une réinitialisation
     * (`auth.ts` `trustedOrigins`, via `lib/origines.ts`, qui lit donc
     * bien ce champ depuis la correction du verrouillage au deuxième
     * changement de domaine) —, et servir de cible à RÉESSAYER pour
     * l'invalidation de cache (`revalidate.ts` `drain`, via
     * `lib/origines.ts` `webSortantes`) le temps que le nouveau domaine
     * serve à son tour un certificat valide. Toujours PAS un accès, et
     * pas une origine de lien d'email : celle-là ne suit que le domaine
     * courant.
     *
     * `v.optional()` (invariant 6) : le champ se déploie seul, et son
     * absence est l'état de tout déploiement qui n'a jamais changé de
     * domaine. Il n'entre dans AUCUNE projection de `settings.ts` —
     * `settings.publicProjection.test.ts` le vérifie.
     */
    previousDomains: v.optional(
      v.array(v.object({ host: v.string(), since: v.number() })),
    ),

    // IDs de pixels publicitaires. Optionnels (expand) : les déploiements
    // existants n'en portent pas. Chaîne vide = retiré volontairement,
    // distinct de l'absence (`undefined`) qui laisse le fallback PUBLIC_*.
    metaPixelId: v.optional(v.string()),
    googleTagId: v.optional(v.string()),
  }),

  // Les jetons saisis depuis l'écran des réglages — CHIFFRÉS, jamais en
  // clair.
  //
  // Une table à part, et jamais un champ de plus dans `settings` : celle-ci
  // a une projection publique (`settings.get`), appelée par le site sans
  // session, et le jour où le secret de signature du webhook y est entré il
  // est devenu lisible par tout Internet. « En optionnel » n'aurait rien
  // changé à cela. Ici, aucune query ne rend `iv` ni `chiffre`.
  //
  // Chiffrement d'enveloppe : la clé maîtresse est `SECRETS_KEY`, posée
  // dans l'environnement Convex par la CLI. Une copie de la base ne suffit
  // donc pas — un export de sauvegarde, un accès au tableau de bord, une
  // query mal écrite : aucun des trois ne donne le jeton. Voir
  // `lib/secretsCrypto.ts` pour ce que le dispositif n'achète pas.
  secrets: defineTable({
    /** Le nom de la variable correspondante : `OPENROUTER_API_KEY`, … */
    nom: v.string(),
    /** 12 octets, NEUFS à chaque écriture — un IV réutilisé casse AES-GCM. */
    iv: v.bytes(),
    chiffre: v.bytes(),
    majAt: v.number(),
    majPar: v.string(),
  }).index("by_nom", ["nom"]),

  // Ce que l'adoptant a changé aux emails que ce dépôt envoie — et RIEN
  // d'autre. Le texte de référence, lui, vit dans le code
  // (`lib/catalogueEmails.ts`), et l'absence de ligne ici est le cas
  // NORMAL : c'est l'état de tout déploiement neuf. Même forme que
  // `choisirExpediteur` (`lib/expediteur.ts`), qui replie déjà sur une
  // valeur du code quand le réglage manque.
  //
  // Une ligne n'existe donc que si quelqu'un a touché quelque chose, et
  // `emails.gabaritPour` sait toujours répondre sans elle.
  emailTemplates: defineTable({
    /**
     * Une clé du catalogue (`CleEmail`). Pas d'index unique en base :
     * c'est la mutation qui garantit l'unicité, et un index le dirait
     * mieux — à revoir si un jour le catalogue dépasse la dizaine.
     */
    cle: v.string(),
    /**
     * Le texte réécrit depuis l'administration — OPTIONNEL, et c'est
     * structurel, pas une commodité.
     *
     * Le brief de cette tâche les voulait obligatoires. Deux conséquences
     * l'ont fait changer, toutes deux silencieuses :
     *
     *   1. Couper un email (`setActif`) devait alors matérialiser le
     *      texte par défaut dans la ligne. Une version ultérieure du
     *      catalogue qui améliore ce texte ne serait jamais appliquée
     *      chez qui n'a fait que basculer un interrupteur — un gel du
     *      texte que personne n'a demandé et que rien n'affiche.
     *   2. « Personnalisé » ou « par défaut », la seule chose que l'écran
     *      doit pouvoir dire sans deviner, deviendrait indécidable : une
     *      ligne existerait aussi pour qui n'a jamais touché au texte.
     *
     * Ici, `objet === undefined` veut dire exactement « le littéral du
     * code », et rien d'autre.
     */
    objet: v.optional(v.string()),
    corps: v.optional(v.string()),
    /** Faux = cet email ne part plus. Refusé sur les emails non désactivables. */
    actif: v.boolean(),
    /**
     * L'identifiant Better Auth de qui a écrit cette ligne — la même
     * forme que `secrets.majPar`, et pour la même raison : c'est ce que
     * rend `requireRole`, qui ne connaît pas la table `profiles`.
     *
     * Un `v.id("profiles")` (ce que demandait le brief) aurait obligé
     * chaque écriture à résoudre un profil qui peut légitimement manquer
     * le temps qu'`auth.onUpdate` le crée — une mutation qui échoue pour
     * une raison sans rapport avec le geste. Le classement RGPD est le
     * même dans les deux cas : `_dataRegistry.ts` déclare cette table
     * sous « Savoir qui a publié, modifié ou téléversé quoi ».
     */
    majPar: v.string(),
    majAt: v.number(),
  }).index("by_cle", ["cle"]),

  // Deux chaînes pour une idée : le `name` qu'un humain a tapé, gardé tel
  // quel pour l'affichage, et le `slug` qui en est dérivé — c'est lui qui
  // décide de l'URL et de l'unicité. « Astro » et « astro » sont le même
  // tag ; autoriser les deux produirait deux URL listant les mêmes
  // articles, et personne ne s'en apercevrait avant que la seconde ait des
  // lecteurs.
  tags: defineTable({
    name: v.string(),
    slug: v.string(),
  }).index("by_slug", ["slug"]),

  // Métadonnées des fichiers de Convex storage. Table *sidecar* : les
  // champs qui désignent un fichier (`seo.ogImageId`, et le `coverId` des
  // articles) référencent `_storage` directement, et cette table s'y
  // raccroche par `by_storage`. Conséquence assumée : un `storageId` peut
  // exister sans ligne ici — un fichier téléversé hors médiathèque — et
  // c'est un `alt` manquant, jamais une erreur.
  media: defineTable({
    storageId: v.id("_storage"),
    filename: v.string(),
    mime: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // Obligatoire, jamais optionnel : une image sans alternative textuelle
    // est un défaut d'accessibilité qu'aucune interface ne rattrape, et un
    // champ qu'on peut remplir plus tard n'est jamais rempli.
    alt: v.string(),
    size: v.number(),
    createdBy: v.string(),
  })
    .index("by_storage", ["storageId"])
    .index("by_created_by", ["createdBy"]),

  // Lot 2, Task 3; design spec §6.2 ("Boucle de publication — outbox
  // durable"). Convex does not retry scheduled actions, so a lost
  // invalidation would otherwise leave a page whose `status` says
  // published invisible until its cache `maxAge` expires — with nothing
  // for an operator to look at. `publishPage` inserts a row here in the
  // *same* mutation that flips `pages.status`, which is what makes the
  // row impossible to lose: either both writes land (one Convex
  // transaction) or neither does.
  //
  // `by_status_next_attempt` (compound, in that order) is what lets
  // `revalidate.ts`'s `listDueRows` ask for exactly "pending rows due
  // now" — `.eq("status", "pending").lte("nextAttemptAt", now)` — as a
  // single index range scan, not a full table scan filtered in memory.
  //
  // `pageId` (M4, whole-lot review): optional — additive, per CLAUDE.md's
  // expand/migrate/contract discipline — rather than a required field a
  // schema push against existing rows would reject. Before this field
  // existed, `pages.publicationStatus` had to `.collect()` every row in
  // this *entire* table and filter in memory for `tags.includes(tag)`:
  // correct, but a full-table scan that re-runs on every reactive
  // subscription re-render, and one this table has no bound on (rows are
  // deliberately never deleted — see this table's own header above — so
  // it only ever grows). `by_page_created_at` is what turns "find this
  // page's most recent outbox row" back into a single index range scan:
  // `.withIndex(q => q.eq("pageId", id)).order("desc").first()`. Convex
  // appends `_creationTime` as an implicit final tiebreaker on every
  // index (confirmed against `convex`'s own `system_fields.d.ts`), which
  // is also what fixes the old strict-`>` reduce's tie-losing bug for
  // free: two rows inserted in the same millisecond are still ordered
  // correctly by insertion order, not just left to whichever the JS
  // reduce happened to see first.
  revalidationOutbox: defineTable({
    tags: v.array(v.string()),
    // Ce sur quoi porte la ligne. Optionnel : les lignes antérieures à ce
    // champ n'en portent pas — voir `OutboxTarget` dans `revalidate.ts`.
    kind: v.optional(v.union(v.literal("page"), v.literal("post"), v.literal("site"))),
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
    status: outboxStatusValidator,
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    // Discriminant ajouté avec les articles (lot 3, Task 5) : voir
    // `OutboxTarget` dans `revalidate.ts`. Optionnel — les lignes écrites
    // avant lui n'en portent pas, et `kind === undefined` est exactement
    // l'ensemble figé que le repli de `pages.publicationStatus` balaie.
    .index("by_kind_page_created_at", ["kind", "pageId", "createdAt"])
    .index("by_post_created_at", ["postId", "createdAt"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_page_created_at", ["pageId", "createdAt"]),
})
