# Notifications — cloche, e-mails, préférences

**Date** : 1er septembre 2026
**Statut** : design tranché par Antoine, prêt à planifier
**Invariants** : [`2026-08-27-astrotan-design.md`](2026-08-27-astrotan-design.md),
[`2026-08-29-secrets-et-chiffrement.md`](2026-08-29-secrets-et-chiffrement.md)

Cette livraison ajoute deux choses à l'administration, et une seule
surface pour les régler : une **cloche** dans le header, et des **e-mails
immédiats** pour deux événements. Les modèles restent le catalogue déjà
là — `lib/catalogueEmails.ts`, table `emailTemplates`, écran
`/settings/emails`. On n'invente ni un second catalogue, ni une file
d'attente, ni un digest.

## 1. Objectif

Un membre de l'équipe ouvre l'administration et voit, à droite du mot
« Administration », une cloche. Un visiteur vient d'écrire, ou un
collègue vient de publier un article : la cloche le dit, le clic ouvre
`/leads` ou `/posts/$id` et marque lu. S'il a activé l'e-mail pour ce
type, un message part tout de suite — le même système que l'invitation et
la réinitialisation, le même Resend, le même `gabaritPour`.

Deux couches, jamais mélangées :

| Couche | Qui décide | Où |
|---|---|---|
| Le **type** (texte, interrupteur site) | owner et admin, comme aujourd'hui | `/settings/emails`, `emails.setTemplate` / `setActif` / `resetTemplate` |
| Les **canaux** (cloche, e-mail) | chaque compte, pour soi | même page, bloc « Mes notifications » |

L'UI masque. Chaque mutation revérifie le rôle (`requireRole`). Un editor
règle sa cloche et son e-mail ; il ne touche pas aux gabarits.

## 2. Décisions, et ce qu'elles ferment

| Décision | Conséquence |
|---|---|
| C : owner cadre les types ; chacun active cloche / e-mail pour soi | Pas de matrice « l'owner coche les canaux de l'équipe ». `emails.setActif` reste l'interrupteur **site** (e-mail de ce type, pour tout le monde). Les canaux personnels vivent dans `notificationPrefs`. |
| Modèles = `/settings/emails` | Quatrième clé de `CATALOGUE` : `postPublished`. `leadNotification` reste la clé du nouveau lead. Même `validerGabarit`, mêmes `{{variables}}`, mêmes mutations. |
| V1 : nouveau lead, collègue a publié un article | Pas de page publiée. Pas de dépublication. Pas de digest. Pas de webhook de notification (le webhook des leads, `leads.deliverWebhook`, ne bouge pas). |
| Page **Email & notifications** | L'URL reste `/settings/emails`. `SETTINGS_PAGES` porte déjà ce libellé et ce `h1` ; la phrase sous le titre reste vide. On n'ajoute pas de route. |
| E-mails immédiats | Un événement → un e-mail par destinataire qui a le canal e-mail. Pas de regroupement, pas de « plus tard dans la journée ». |
| Table `notifications` + déclenchement dans la **même mutation** que l'événement | Voir §4. L'e-mail peut rater ; la ligne cloche est déjà commise. |
| Pas d'e-mail à l'auteur de son propre article | Ni cloche ni e-mail pour `posts.createdBy`, ni pour l'acteur de `posts.publishPost`. Ils savent. |
| Resend éteint → pas d'e-mail, cloche OK | Même silence que `leads.notifyStaff` aujourd'hui : clé absente (`lireSecret("RESEND_API_KEY")`) → l'action d'envoi retourne, elle ne lève pas. |
| Clic cloche → `/leads` ou `/posts/$id` + lu | Une route déjà là, pas une fiche notification. Marquer lu est une mutation, pas un effet de navigation. |

## 3. Ce qui existe déjà, et ce qu'on ne reprend pas

Trois e-mails partent aujourd'hui, décrits dans
`packages/backend/convex/lib/catalogueEmails.ts` :

| `cle` | Titre | Désactivable | Envoi |
|---|---|---|---|
| `invitation` | Invitation à rejoindre l'administration | non | `invitations.sendInvitationEmail` |
| `leadNotification` | Nouveau message de contact | oui | `leads.notifyStaff` |
| `passwordReset` | Réinitialisation de mot de passe | non | `passwordReset` |

`invitation` et `passwordReset` ne deviennent pas des types de
notification. Leur destinataire n'est pas un compte qui a coché une case :
c'est la personne invitée, ou celle qui a demandé un nouveau mot de passe.
Leur interrupteur site, leur texte et leurs variables (`{{lien}}`)
restent tels quels.

`leadNotification` change de destinataires, pas de métier. Aujourd'hui
`leads.staffRecipients` envoie à chaque owner et admin non banni. Demain
le destinataire est chaque compte **qui a le canal e-mail ouvert** pour
cette clé — défaut §6, qui reproduit le comportement actuel pour owner et
admin, et laisse l'editor hors de l'e-mail tant qu'il n'a pas coché.

L'écran : `apps/admin/src/routes/_authed/settings/emails.tsx` +
`apps/admin/src/components/email-templates.tsx`. Deux questions, dans cet
ordre : de la part de qui (`SectionCleResend`, `ChampAdresseExpedition`),
puis qu'est-ce qui part (`ListeEmails` / `EditeurGabarit`). Une troisième
s'ajoute **en dessous**, pas à la place : mes canaux. L'éditeur de gabarit
continue de n'enregistrer que par `emails.setTemplate` — jamais par la
barre de `settings.update`.

Le header : `apps/admin/src/components/app-shell.tsx`, barre `h-14`,
aujourd'hui `SidebarTrigger` + filet + le mot « Administration ». La
cloche s'y accroche à **droite** (`ml-auto`). Pas dans la sidebar.

Resend : `packages/backend/convex/lib/resend.ts` (`makeResend`), clé lue
par `lireSecret`, `testMode` tant que `RESEND_TEST_MODE !== "false"`.
Cette livraison ne touche ni à la précédence, ni au mode d'essai, ni à
l'écran qui a déjà décidé de ne plus en parler.

## 4. Architecture — une mutation, deux sorts

Convex n'envoie pas d'HTTP depuis une mutation. `makeResend` prend un
`ActionCtx`. `leads.submit` le sait déjà : il écrit le lead, puis
`ctx.scheduler.runAfter(0, internal.leads.notifyStaff, …)`. Un `throw` de
Resend **dans** la mutation ferait rollback de tout, cloche comprise —
l'inverse de la décision.

Donc, dans `leads.submit` et dans `posts.publishPost` (la mutation
d'événement, pas une autre) :

1. L'événement s'écrit (lead, article publié).
2. Les lignes `notifications` s'écrivent **dans la même transaction**,
   pour chaque destinataire cloche (§6).
3. L'action d'envoi est **planifiée** dans cette même mutation
   (`runAfter(0)`), jamais un cron, jamais une table d'outbox maison.
4. L'action d'envoi **ne crée pas** la ligne cloche. Si Resend est
   éteint, si `gabarit.actif` est faux, si l'action lève : la cloche
   reste.

`leads.notifyStaff` reste une `internalAction`. Elle change de liste de
destinataires et gagne les variables nouvelles. Une jumelle
`posts.notifyPublished` (même fichier `posts.ts`, ou `notifications.ts`
en `internalAction` appelée depuis `publishPost`) fait le même travail
pour `postPublished`.

Pas de file de retry au-delà de ce que `@convex-dev/resend` fait déjà.
Pas de statut « e-mail envoyé » sur la ligne `notifications` : la cloche
ne ment pas sur un envoi qu'elle ne garantit pas.

Un seul résolveur de destinataires, `packages/backend/convex/lib/notifier.ts`,
appelé par les deux mutations (cloche) et par les deux actions (e-mail).
Deux copies de « qui a le droit d'être prévenu » divergeraient la
première semaine.

## 5. Schéma — expand seulement

Deux tables nouvelles. Rien n'est retiré. `emailTemplates.cle` est déjà
un `v.string()` : une quatrième clé de catalogue n'est pas un changement
de schéma.

```
notificationPrefs: defineTable({
  authUserId: v.string(),          // id Better Auth, comme profiles.authUserId
  cle: v.union(
    v.literal("leadNotification"),
    v.literal("postPublished"),
  ),
  cloche: v.boolean(),
  email: v.boolean(),
  majAt: v.number(),
})
  .index("by_user_cle", ["authUserId", "cle"])
  .index("by_user", ["authUserId"])

notifications: defineTable({
  authUserId: v.string(),
  cle: v.union(
    v.literal("leadNotification"),
    v.literal("postPublished"),
  ),
  titre: v.string(),               // libellé de la cloche, figé à l'écriture
  leadId: v.optional(v.id("leads")),
  postId: v.optional(v.id("posts")),
  readAt: v.optional(v.number()),
})
  .index("by_user", ["authUserId"])
  .index("by_lead", ["leadId"])
  .index("by_post", ["postId"])
```

Unicité de `notificationPrefs` : la mutation, pas un index unique. Une
ligne par `(authUserId, cle)`. L'absence de ligne **est** le défaut §6 —
même idée que l'absence de ligne dans `emailTemplates`.

`titre` est un libellé d'équipe, pas le corps du message :

| `cle` | `titre` | Cible | Clic |
|---|---|---|---|
| `leadNotification` | « Nouveau message de contact » | `leadId` | `/leads` |
| `postPublished` | le `title` de l'article, déjà borné par `content.ts` | `postId` | `/posts/$postId` |

Le nom du visiteur n'entre **pas** dans `notifications`. Il vit dans
`leads` ; l'e-mail l'interpole déjà (`{{nom}}`). Recopier ce nom dans
la cloche ferait porter à cette table une donnée de visiteur, et
interdirait de la classer seulement avec les comptes d'administration.

`leadId` / `postId` : exactement un des deux, celui de la `cle`. Pas de
champ `href` — la route se dérive, elle ne se stocke pas.

### 5.1 Conservation

`notificationPrefs` : jusqu'à la suppression du compte. `users.remove`
efface les lignes `by_user` avant (ou juste après) l'appel Better Auth —
sinon un compte parti laisse des préférences orphelines que plus rien
n'écrit.

`notifications` :

- partent avec le compte (`users.remove`, même index) ;
- partent avec la fiche (`deleteLeadCascade` gagne l'index `by_lead` ;
  `leads.remove` passe par cette fonction s'il duplique encore la
  cascade) ;
- partent avec l'article (`posts.remove`, index `by_post`) ;
- et, au-delà, `retention.purge` efface toute ligne dont
  `_creationTime` a plus de **90 jours** (`NOTIFICATION_RETENTION_DAYS`,
  constante à côté de `LEAD_RETENTION_DAYS` dans `retention.ts`). Une
  cloche n'est pas un dossier.

`_dataRegistry.ts` :

| Table | Classement |
|---|---|
| `notificationPrefs` | `declaredAs: "Gérer les comptes de l'administration"` |
| `notifications` | idem |

`apps/web/src/config/legal.ts`, finalité « Gérer les comptes de
l'administration » : la phrase `data` s'allonge des préférences de
notification et des lignes de cloche (destinataire, type, libellé,
identifiant de cible). La phrase `retention` dit les 90 jours pour la
cloche, et la suppression du compte pour les deux. `legal.test.ts`
refuse une table déclarée dont la finalité n'est plus publiée : c'est
déjà le filet.

Pas de nouvelle entrée dans `AUDIT_ACTIONS`. Régler sa propre cloche
n'est pas un geste d'administration. Le cadrage des types reste
`emailTemplate.set` / `toggle` / `reset`.

## 6. Destinataires et défauts

Comptes considérés : owner, admin, editor, **non bannis**
(`isCurrentlyBanned`, déjà utilisé par `staffRecipients`). Un compte
banni n'obtient ni ligne cloche nouvelle, ni e-mail. Les trois rôles
lisent `/leads` et `/posts/$id` ; un editor a donc une raison d'ouvrir
la cloche.

Résolution d'un canal, pour une `cle` et un compte :

```
ligne notificationPrefs → la valeur écrite
pas de ligne           → le défaut ci-dessous
```

| `cle` | Canal | Défaut |
|---|---|---|
| `leadNotification` | cloche | vrai pour les trois rôles |
| `leadNotification` | e-mail | vrai si owner ou admin, **faux** si editor |
| `postPublished` | cloche | vrai pour les trois rôles |
| `postPublished` | e-mail | faux pour les trois rôles |

Le défaut e-mail de `leadNotification` est celui de
`leads.staffRecipients` aujourd'hui : un déploiement qui n'a touché à
rien continue d'écrire aux owner et admin, et seulement à eux. Un editor
qui veut l'e-mail le coche. `postPublished` est nouveau : il n'envoie
rien tant que personne n'a coché — la cloche suffit à rendre le type
visible.

Un e-mail part seulement si **tout** ceci est vrai :

1. `gabaritPour(cle).actif` — l'interrupteur site (`emails.setActif`) ;
2. le canal e-mail du destinataire (ligne ou défaut) ;
3. `lireSecret(ctx, "RESEND_API_KEY")` non vide ;
4. le compte n'est pas banni ;
5. pour `postPublished` : le destinataire n'est ni `createdBy` ni
   l'acteur de `publishPost`.

La cloche s'écrit si 4 et 5, et si le canal cloche est ouvert. Elle
**ignore** l'interrupteur site et l'absence de Resend. Couper
`leadNotification` depuis l'accordéon arrête les e-mails, pas les
cloches. C'est le même silence que « Resend éteint → cloche OK ».

`leads.submit` n'a pas de session. Il parcourt les comptes via
`listUsersWithRole` (déjà exporté de `users.ts`) pour les trois rôles,
déduplique comme `staffRecipients`, puis applique le résolveur. Zéro
compte : zéro ligne, zéro e-mail — l'état normal d'un clone avant
bootstrap.

Relance de lead (`messageCount > 1`) : une nouvelle cloche, un nouvel
e-mail, comme aujourd'hui. La mention de relance reste composée **autour**
du gabarit par `notifyStaff`, jamais comme variable.

Article : notification seulement si `post.status !== "published"` **avant**
l'écriture. Une republication (article déjà en ligne, working copy
appliquée, invalidation de cache) n'écrit rien et ne planifie rien.
Dépublier puis republier est un nouveau passage brouillon → publié : ça
notifie. C'est le geste « un collègue a publié », pas « un collègue a
enregistré ».

## 7. Permissions

Chaque fonction publique revérifie. L'UI ne décide pas.

| Fonction | Rôles | Ce qu'elle refuse en plus |
|---|---|---|
| `emails.list` / `setTemplate` / `setActif` / `resetTemplate` | owner, admin | inchangé. Un editor voit le message déjà là : « Réservé au propriétaire et aux administrateurs. » |
| `notifications.mesPrefs` (query) | owner, admin, editor | uniquement **soi** (`requireRole` puis `acteur._id`) |
| `notifications.setPrefs` | owner, admin, editor | `cle` hors union → validateur Convex. Pas d'`authUserId` en argument : on écrit la session, personne d'autre. |
| `notifications.liste` (query) | owner, admin, editor | uniquement soi. 30 lignes les plus récentes (`_creationTime` desc), plus `nonLues` (entier). |
| `notifications.marquerLu` | owner, admin, editor | la ligne doit exister **et** `authUserId === acteur._id`. Sinon `{ code: "NOT_FOUND" }` — pas `FORBIDDEN`, pour ne pas révéler qu'une ligne d'autrui existe. Déjà lu : succès no-op, comme `emails.resetTemplate` sur une ligne absente. |

`MUTATION_REGISTRY` s'allonge de `notifications.setPrefs` et
`notifications.marquerLu`, rôles `["owner", "admin", "editor"]`.
`lib/authz.test.ts` les joue.

Aucune query publique nouvelle. `apps/web` n'appelle rien de ceci.

## 8. Catalogue et variables

`CleEmail` devient
`"invitation" | "leadNotification" | "passwordReset" | "postPublished"`.
Le premier test de `catalogueEmails.test.ts` (« exactement les emails que
ce dépôt envoie ») passe à quatre clés, dans cet ordre — invitation,
lead, reset, article. C'est le rappel qui a justifié le test.

### 8.1 `leadNotification` — expand des variables

Les cinq d'aujourd'hui restent : `nom`, `email`, `sujet`, `message`,
`lien`. Un gabarit déjà personnalisé qui les emploie continue de valider
et de partir.

On **ajoute**, sans les rendre obligatoires :

| Variable | Valeur | Confiance (`VARIABLES_DE_CONFIANCE`) |
|---|---|---|
| `nom_du_site` | `settings.siteName`, ou `"AstroTan"` si le singleton n'existe pas | non — ce n'est pas une URL |
| `url` | la même URL que `lien` : `${admin}/leads` via `deriverOrigines` / `settings.domaineDeclare`, comme `notifyStaff` aujourd'hui | **oui**, avec `lien` |

`{{sujet}}` n'est pas dans la liste V1 d'Antoine et n'est **pas** retiré :
le formulaire de contact l'envoie, le corps par défaut l'affiche, le
retirer casserait les gabarits enregistrés. `{{url}}` est le nom V1 ;
`{{lien}}` reste l'exemplaire déjà expédié. Les deux reçoivent la même
chaîne.

`VARIABLES_DE_CONFIANCE.leadNotification` devient `["lien", "url"]`.
`nom`, `email`, `sujet`, `message` restent hors confiance : ils viennent
du formulaire public. `catalogueEmails.test.ts` continue d'échouer si on
y ajoute l'un d'eux.

Objet et corps par défaut : **inchangés**. Ils n'emploient pas encore
`{{nom_du_site}}` / `{{url}}`. L'adoptant qui les veut les tape. Forcer
un nouveau défaut gèlerait un texte différent chez qui n'a jamais
ouvert l'éditeur — et chez qui a une ligne `actif: false` sans texte,
`gabaritPour` replie déjà sur le littéral du code.

`destinataire` du catalogue, seul champ de description à réécrire :

> Chaque compte qui a activé l'e-mail pour ce type, un e-mail par
> personne.

L'écran ne rend plus `quand` / `destinataire` (`email-templates.tsx` les
a retirés du déplié) ; la phrase vit pour `emails.list` et pour les
tests.

### 8.2 `postPublished` — entrée nouvelle

```
cle: "postPublished"
titre: "Un collègue a publié un article"
quand: "Quand un owner ou un admin publie un article qui n'était pas en ligne."
destinataire: "Chaque compte qui a activé l'e-mail pour ce type, sauf l'auteur et la personne qui publie."
desactivable: true
variables: ["nom_du_site", "url", "titre", "auteur"]
variablesObligatoires: []
objetParDefaut: "{{auteur}} a publié « {{titre}} »"
corpsParDefaut:
  "{{auteur}} a publié « {{titre}} » sur {{nom_du_site}}.

  Ouvrir dans l'administration : {{url}}"
```

Valeurs, toutes construites côté serveur :

| Variable | Source |
|---|---|
| `nom_du_site` | comme ci-dessus |
| `url` | `${admin}/posts/${postId}` |
| `titre` | `posts.title` après l'écriture (working copy déjà appliquée) |
| `auteur` | `profiles.displayName` de `createdBy`, même repli que `lib/postAuthor.ts` (`displayName` → e-mail → `—`) |

`VARIABLES_DE_CONFIANCE.postPublished` : `["url"]` seulement. `titre` et
`auteur` ne sont pas saisis par un visiteur anonyme, mais ce n'est pas
une raison de les mettre en lien : ce ne sont pas des URL. Le
`Record<CleEmail, …>` force la décision pour toute clé nouvelle — c'est
déjà le commentaire du module.

`rendreTexte` / `rendreHtml` / `singleLine` sur l'objet rendu : le même
ordre que `notifyStaff`. `titre` d'article peut porter un saut de ligne
si un jour les bornes lâchent ; `singleLine` sur l'objet ferme la porte
SMTP. Pas de `replyTo` : on ne répond pas à un collègue par ce message.

Pas de mention « republie » dans le gabarit : ce cas n'envoie pas (§6).

## 9. UI

### 9.1 `/settings/emails`

Ordre des blocs, et rien d'autre :

1. `SectionCleResend` — inchangé.
2. `ChampAdresseExpedition` — inchangé, barre au clic, `auto: {}`.
3. `SettingsGroup` « Ce que ce site envoie » — l'accordéon gagne la
   quatrième ligne `postPublished`. Même `ListeEmails`, même une ligne
   dépliée, mêmes garde-fous (`actionSurLigne`, `useUnsavedChangesGuard`).
   Owner / admin seulement.
4. `SettingsGroup` « Mes notifications » — **tous les rôles**. Deux
   lignes, toujours visibles : « Nouveau message de contact », « Un
   collègue a publié un article ». Sur chaque ligne, deux `Switch` :
   **Cloche** et **E-mail**. Enregistrement immédiat
   (`notifications.setPrefs`), pas la barre de page. Un editor qui n'a
   pas le droit d'ouvrir l'accordéon voit quand même ce bloc — c'est
   tout ce qu'il vient faire ici.

Pas de phrase sous le `h1`. Pas d'explication Resend dans ce bloc : le
silence d'envoi est déjà le contrat de `notifyStaff`.

### 9.2 Cloche

Fichier nouveau : `apps/admin/src/components/notifications-cloche.tsx`
(rendu sans Convex dans le test, mutations dans un mince connecteur —
même découpe que `email-templates.tsx` / `ListeEmailsConnectee`). Monté
dans `AppShell`, à droite du header.

- Bouton icône `Bell` (lucide, déjà dans l'admin). `aria-label`
  « Notifications ».
- Pastille numérique si `nonLues > 0`, plafonnée à `9+`.
- Panneau (Popover / DropdownMenu déjà shadcn) : les lignes de
  `notifications.liste`, `titre` + date relative courte. Vide : « Aucune
  notification ».
- Clic d'une ligne : `notifications.marquerLu` puis navigation TanStack
  (`/leads` ou `/posts/$postId`). Pas de `<a href>` brut : le garde-fou
  des brouillons d'écran doit voir la navigation.
- Pas de « Tout marquer lu ». Pas de toast. Convex pousse la query : la
  pastille baisse toute seule.

Cible article disparue (course entre clic et `posts.remove`) : la
navigation ouvre `/posts/$id`, la route existante gère le « introuvable ».
On ne réécrit pas cette route.

## 10. Erreurs

Pas de nouveau code à côté de `GABARIT_INVALIDE` /
`EMAIL_NON_DESACTIVABLE`. Un gabarit `postPublished` passe par
`validerGabarit` et `describeSettingsError` comme les trois autres.

`notifications.marquerLu` / `setPrefs` :

| Code | Quand | Phrase (`settingsErrors` ou équivalent déjà lu par l'écran) |
|---|---|---|
| `UNAUTHENTICATED` | session absente | déjà dans `SETTINGS_ERROR_MESSAGES` |
| `BANNED` | compte banni | déjà là |
| `FORBIDDEN` | rôle hors owner/admin/editor | déjà là |
| `NOT_FOUND` | ligne cloche d'autrui ou absente | déjà là |

L'action d'envoi : clé absente → `return null`. Gabarit inactif →
`return null`. Aucune origine admin (`deriverOrigines`) → **lève**,
comme `notifyStaff` aujourd'hui : le job en échec est visible dans le
tableau de bord Convex, la cloche et l'événement sont déjà en base. On
ne change pas ce cri.

Un `sendEmail` qui lève au milieu de la boucle destinataires : les
destinataires suivants de **cet** appel ne partent pas. La cloche de
chacun est déjà écrite. Pas de rattrapage maison.

## 11. Unités

| Unité | Fait | Dépend de | Ne fait pas |
|---|---|---|---|
| `lib/catalogueEmails.ts` | quatre clés, variables, défauts | rien | envoyer |
| `lib/gabarit.ts` | valider, substituer, échapper | le catalogue | connaître un lead |
| `lib/notifier.ts` | résoudre canaux, insérer les lignes cloche, décider qui est exclu | `listUsersWithRole`, prefs, `isCurrentlyBanned` | appeler Resend |
| `emails.ts` | `gabaritPour`, écran, mutations de gabarit | catalogue, `requireRole` | savoir qui a coché |
| `notifications.ts` | prefs, liste, marquer lu | `requireRole` | envoyer un e-mail |
| `leads.submit` | lead + cloches + `runAfter(notifyStaff)` | notifier | Resend |
| `leads.notifyStaff` | e-mails `leadNotification` | `gabarit`, `makeResend`, résolveur e-mail | écrire une cloche |
| `posts.publishPost` | publier + cloches si transition + `runAfter` | notifier | Resend |
| `posts.notifyPublished` (internalAction) | e-mails `postPublished` | idem notifyStaff | écrire une cloche |
| `notifications-cloche.tsx` | pastille, liste, clic | props / query | connaître Resend |
| bloc « Mes notifications » | deux lignes, quatre switchs | `mesPrefs` / `setPrefs` | éditer un gabarit |

Fichiers nouveaux sous 200 lignes. `emails.tsx` (route) n'avale pas les
switchs : ils sortent dans un composant, comme `ListeEmails`.
`app-shell.tsx` n'avale pas le panneau : il monte le connecteur.

Helpers de test : `packages/backend/testing/`, jamais un fichier à nom
simple sous `convex/` hors le point d'entrée `notifications.ts`. Après
toute modification de `convex/`, un `npx convex dev --once` réel — `tsc`
et vitest ne voient pas ce que le bundler refuse.

## 12. Hors-scope

Rien de cette liste n'a de champ, de clé de catalogue, de ligne de menu
ou de test « à préparer ».

- Digest, récap quotidien ou hebdomadaire, regroupement de N événements
  en un e-mail.
- Page publiée, page dépubliée, article dépublié, media, invitation
  acceptée, rôle changé.
- Webhook de notification. `leads.deliverWebhook` reste le webhook des
  **leads**, déclenché comme aujourd'hui, indépendant de la cloche.
- File d'attente maison, retry au-delà du composant Resend, statut
  d'envoi sur la ligne cloche.
- « Tout marquer lu », préférences d'un autre compte, e-mail à
  l'auteur de son article, e-mail à qui vient de cliquer Publier.
- Changer `RESEND_TEST_MODE` depuis l'écran, renommer la route
  `/settings/emails`, incrémenter `consentVersion`.
- TanStack Query. Convex pousse `notifications.liste`.

## 13. Ce qui ne change pas

- `apps/web` n'a ni clé admin ni session. `leads.submit` reste la seule
  écriture publique, secret partagé, rate limit inchangé.
- `settings.get` ne gagne aucun champ. Les prefs ne sont pas publiques.
- Invitation et réinitialisation : mêmes clés, mêmes variables, mêmes
  `desactivable: false`, même `claimPendingToken`.
- Expand seulement. Pas de champ retiré sur `emailTemplates`, pas de
  rename de `leadNotification`.
- `SECRETS_KEY`, table `secrets`, précédence environnement → base.
- Le journal n'enregistre toujours pas le corps d'un gabarit.

## 14. Vérification

Les tests qui tiennent ça, pas une lecture de code :

1. **Défauts.** Aucune ligne `notificationPrefs`. `leads.submit` écrit
   une cloche pour owner, admin **et** editor ; `notifyStaff` n'appelle
   `sendEmail` que pour owner et admin. `publishPost` (brouillon →
   publié) écrit une cloche pour les comptes autres que `createdBy` et
   l'acteur ; zéro `sendEmail`.
2. **Prefs.** Un editor coche e-mail sur `leadNotification` : le
   prochain submit l'inclut. Un owner décoche e-mail : il disparaît de
   `sendEmail`, sa cloche reste. Un owner appelle `setPrefs` avec
   l'`authUserId` d'un autre : le validateur n'a pas ce champ ; la ligne
   écrite est la sienne.
3. **Auteur.** `createdBy` de l'article = l'acteur qui publie : zéro
   cloche, zéro e-mail pour lui, même avec les deux canaux à vrai. Un
   troisième compte avec e-mail à vrai : un `sendEmail`, une cloche.
4. **Republication.** Article déjà `published` : `publishPost` n'insère
   aucune `notifications` et ne planifie pas l'action.
5. **Resend éteint.** `lireSecret` vide : cloches présentes, zéro
   `sendEmail`, l'action retourne. Gabarit `leadNotification` inactif
   (`setActif false`) : idem pour l'e-mail, cloches présentes.
6. **Échec e-mail.** `sendEmail` lève : les lignes `notifications`
   commises dans `submit` / `publishPost` sont toujours là (l'action
   court **après** le commit).
7. **Marquer lu.** Owner A ne marque pas la ligne de B (`NOT_FOUND`).
   Clic : `readAt` posé, `nonLues` diminue. Second clic : no-op.
8. **Cascade.** `leads.remove` / `retention.purge` : plus aucune
   `notifications` sur ce `leadId`. `posts.remove` : idem `postId`.
   `users.remove` : plus aucune pref ni cloche pour cet `authUserId`.
9. **Gabarit.** `setTemplate` `postPublished` avec `{{inconnu}}` →
   `GABARIT_INVALIDE`. `{{url}}` dans le HTML est une ancre ; `{{titre}}`
   ne l'est pas. `leadNotification` accepte encore `{{lien}}` et
   `{{sujet}}`.
10. **UI.** `settings-nav.test` : libellé « Email & notifications »,
    chemin `/settings/emails`. Un editor voit « Mes notifications » et
    pas l'accordéon. `notifications-cloche` : pastille absente si
    `nonLues === 0` ; clic d'une ligne lead navigue vers `/leads`.

`npx convex dev --once` après les fichiers à nom simple sous `convex/`.

## 15. Relecture — contradictions fermées

- **« Envoi dans la même mutation » vs runtime Convex.** Le
  *déclenchement* est dans la mutation (`insert` + `runAfter(0)`).
  L'HTTP est dans l'action, comme `notifyStaff` aujourd'hui. Mettre
  `sendEmail` dans la mutation et le laisser lever détruirait la cloche.
- **`{{url}}` vs `{{lien}}`.** Les deux, même valeur, sur
  `leadNotification`. `postPublished` n'a que `{{url}}`. On ne renomme
  pas `lien` : ce serait un contract, pas un expand.
- **`{{sujet}}` absent de la liste V1.** Conservé : déjà expédié, déjà
  dans le défaut. V1 **ajoute** `nom_du_site` et `url`, elle n'ampute
  pas.
- **Owner cadre / chacun active.** Cadrage = `emails.*` (owner/admin).
  Canaux = `notifications.setPrefs` (soi, trois rôles). Pas de troisième
  table « l'owner a choisi pour Pierre ».
- **Editor et e-mail lead.** Défaut faux : on ne commence pas à écrire
  aux editors. La cloche, elle, est vraie : ils ouvrent déjà `/leads`.
- **Libellé cloche sans le nom du visiteur.** Évite de classer
  `notifications` sous deux finalités. Le détail est dans l'e-mail et
  sur `/leads`.
- **`staffRecipients`.** Cesse d'être la source des e-mails. Le
  résolveur unique le remplace. La query peut rester le temps que
  `notifyStaff` bascule ; plus aucun nouvel appelant.
- **Nav déjà renommée.** `settings-nav.tsx` porte déjà « Email &
  notifications ». Cette spec le confirme ; elle n'invente pas un second
  libellé.

Aucun TBD. Ce qui n'est pas écrit ici n'est pas dans la livraison.
