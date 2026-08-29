import { ConvexError, v } from "convex/values"
import { internalAction, internalMutation, mutation, query } from "./_generated/server"
import { api, components, internal } from "./_generated/api"
import { decideAccess, requireRole } from "./lib/authz"
import { authComponent, createAuth, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth"
import { generateToken, hashToken } from "./lib/token"
import { BOOTSTRAP_ISSUER } from "./bootstrap"
import { MIN_PASSWORD_SCORE, scorePassword } from "./lib/passwordStrength"
import { roleValidator } from "./validators"
import { MAX_DISPLAY_NAME_LENGTH } from "./profiles"
import { MUTATION_REGISTRY } from "./_registry"
import { makeResend } from "./lib/resend"
import { resoudreExpediteur } from "./lib/expediteur"
import { rendreHtml, rendreTexte, singleLine } from "./lib/gabarit"
import { journaliser } from "./lib/auditEvent"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Module-level client, exactly as `@convex-dev/resend`'s own README sets
// it up. Its configuration — `testMode` read from the environment (review
// I3) rather than hard-coded — now lives in `lib/resend.ts`, shared with
// `leads.ts`'s own notification send: one place decides how this project
// talks to Resend, so the two can't drift into disagreeing about test
// mode.
// Construit à CHAQUE envoi, plus au chargement du module : la clé peut
// désormais venir de la base, ce qui demande un contexte d'action et une
// lecture asynchrone. Le coût est un objet de plus par email envoyé.

// Le seul chemin par lequel un compte peut naître dans ce système : une
// invitation valide, jamais expirée, jamais déjà consommée, pour l'email et
// le rôle exacts qu'elle porte, émise par quelqu'un qui a toujours
// l'autorité de le faire au moment où elle est acceptée. `create` fabrique
// cette invitation ; `accept` (plus bas) est ce qui la consomme pour
// fabriquer le compte.
export const create = mutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["owner", "admin"])
    // Un owner ne fabrique pas non plus un second owner par ce chemin :
    // l'unicité de l'owner est déjà garantie ailleurs (bootstrap +
    // `databaseHooks`, Task 6) — il n'existe aucun scénario légitime où
    // inviter un `owner` serait la bonne opération, pour personne, pas
    // seulement pour un admin. Le deuxième verrou (databaseHooks, plus bas
    // dans `accept`) refuse aussi une invitation "owner" fabriquée hors de
    // ce chemin — les deux barrières sont indépendantes *une fois qu'un
    // owner existe déjà* (`owners > 0` dans `auth.ts`) ; voir
    // `invitations.test.ts` et le commentaire du hook lui-même pour la
    // fenêtre de bootstrap où ce n'est pas encore le cas.
    if (args.role === "owner") throw new ConvexError({ code: "FORBIDDEN" })

    // I1 (Lot 1 final review): spec §5 gives `admin` authority to invite
    // `editor` only — reserving `admin` invitations to `owner`, same as
    // `users.setRole`/`users.remove` reserve acting on an existing `admin`
    // to `owner`. Symmetric with the `role === "owner"` refusal above,
    // which applied to every actor already; this is the missing
    // actor-specific half.
    if (actor.role === "admin" && args.role === "admin") {
      throw new ConvexError({ code: "FORBIDDEN" })
    }

    // M1 (review): normalise avant stockage — `createUser` (dans `accept`)
    // fait de toute façon `email.toLowerCase()` et valide le format avec
    // zod, mais seulement au moment de l'acceptation. Sans cette
    // normalisation ici, une adresse mal capitalisée ou avec des espaces
    // superflus produit une invitation dont le hash de token est valide
    // mais dont l'email ne correspondra jamais exactement au compte que
    // `createUser` finira par créer avec l'email normalisé.
    const email = args.email.trim().toLowerCase()

    // Round 2 (review, item 5): `email` was `v.string()` — unbounded.
    // `accept` defaults `displayName` to `invite.email` whenever no `name`
    // argument is given (the common case), so a very long but otherwise
    // syntactically valid address became a `profiles.displayName` past the
    // 100-character limit `MAX_DISPLAY_NAME_LENGTH` enforces everywhere
    // else it's set (`profiles.updateMine`, and `accept`'s own explicit
    // `name` argument). Bounding `email` here closes that specific
    // inconsistency at its source rather than special-casing the fallback
    // in `accept`.
    if (email.length === 0 || email.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new ConvexError({ code: "INVALID_EMAIL" })
    }

    // Minor (Lot 1 final review): server-side format validation — the
    // browser's `type="email"` input (`apps/admin`) was, until now, the
    // *only* place this was ever checked, and a non-browser caller (a
    // direct Convex mutation call, `t.mutation` in a test, a future
    // integration) bypasses it entirely. A single `@` with a non-empty
    // local and domain part on each side is deliberately loose — this
    // isn't the place to relitigate RFC 5322 — just enough to reject
    // "obviously not an email" before it's staged as an invitation and
    // (eventually) handed to `resend.sendEmail`.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ code: "INVALID_EMAIL" })
    }

    // Minor (Lot 1 final review): `invitations.by_email` had zero readers
    // — `create` could mint a second, redundant invitation for an email
    // that already had one still pending, or for an email that already
    // has an account. Neither is dangerous (the *effective* invariant,
    // "exactly one account per email", was already enforced — the second
    // case just failed later, at `accept`, via `createUser`'s own
    // `USER_ALREADY_EXISTS`), but both are a wasted, permanently-unusable
    // invitation and a confusing operator experience: mint one, then
    // discover — possibly days later, whenever someone finally opens the
    // link — that it was never going to work. Caught here instead, before
    // either token is minted or the email is even sent.
    const existingForEmail = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
    const stillPending = existingForEmail.find(
      (row) => row.acceptedAt === undefined && row.expiresAt >= Date.now(),
    )
    if (stillPending) {
      throw new ConvexError({ code: "INVITATION_ALREADY_PENDING" })
    }

    const existingAccount = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user" as const,
      where: [{ field: "email" as const, operator: "eq" as const, value: email }],
    })
    if (existingAccount) {
      throw new ConvexError({ code: "ACCOUNT_ALREADY_EXISTS" })
    }

    const { token, hash } = await generateToken()
    const invitationId = await ctx.db.insert("invitations", {
      email,
      role: args.role,
      tokenHash: hash,
      expiresAt: Date.now() + SEVEN_DAYS_MS,
      invitedBy: actor._id,
      // I1 (review) : le clair est *temporairement* mis en scène ici, pour
      // que `sendInvitationEmail` puisse construire le lien — jamais
      // stocké comme argument de fonction planifiée (voir plus bas pour
      // pourquoi). `claimPendingToken` l'efface dès que ce job tourne,
      // avant même de tenter l'envoi.
      pendingToken: token,
    })

    // Scheduled, not inline (ruling 4 of the task brief): whatever happens
    // inside the actual send — no RESEND_API_KEY configured, a Resend
    // outage, an invalid `from` address, a missing SITE_URL — must never
    // roll back the invitation this mutation just created. The token is
    // already returned to the caller below regardless of whether the
    // email ever goes out, so an operator can always recover it — via
    // `list` below, though only until `sendInvitationEmail` actually
    // claims and clears `pendingToken`; after that, resending means
    // revoking and re-inviting.
    //
    // Only `invitationId` is passed as an argument — not the plaintext
    // token (review I1). `ctx.scheduler.runAfter` retains its arguments
    // verbatim in the `_scheduled_functions` system table for as long as
    // that job record exists, readable via `ctx.db.system` from any
    // function in the deployment and visible in the Convex dashboard —
    // an unredactable, uncontrolled place for a secret to sit for days.
    // `pendingToken`, staged above in a row *we* control, is what
    // `sendInvitationEmail` reads instead.
    //
    // Round 2 (review, item 3) — the actual bound, not the happy-path one:
    // `claimPendingToken` clears the field before ever attempting to send,
    // and `accept` clears it again defensively on successful acceptance
    // (see there) — so on every path this project actually exercises, the
    // exposure is milliseconds (scheduling to claim) or the time until
    // acceptance, never the job record's full retention. But if the
    // scheduled action fails *before* `claimPendingToken`'s own
    // `ctx.runMutation` call returns (an infrastructure error, not a send
    // failure — a send failure happens *after* the claim, see there), and
    // the invitation is then neither accepted nor revoked, Convex does not
    // retry scheduled functions, so `pendingToken` is never cleared and
    // sits on the row indefinitely — past `expiresAt`, until an operator
    // revokes it (which deletes the whole row) or something else touches
    // it. Narrow, not client-reachable (no query returns this field — see
    // `list`), and not the same shape as the original problem this staging
    // replaced, but a real residual, stated plainly rather than papered
    // over.
    const scheduledEmailId = await ctx.scheduler.runAfter(
      0,
      internal.invitations.sendInvitationEmail,
      { invitationId },
    )
    await ctx.db.patch(invitationId, { scheduledEmailId })

    // Relecture finale, correctif 2 : c'est le seul chemin par lequel un
    // compte peut naître dans ce système (commentaire d'en-tête de ce
    // fichier), y compris un second compte `admin` fabriqué par un
    // `owner`/`admin` qui s'invite lui-même — un geste que `users.setRole`
    // aurait journalisé, mais que ce chemin-ci laissait passer sans trace.
    // `/confidentialite` promet de pouvoir dire qui a changé un rôle ; une
    // invitation acceptée EN accorde un, au même titre qu'un `setRole`.
    // L'email plutôt que l'id de l'invitation : c'est ce que l'écran des
    // invitations affiche déjà, et ce sous quoi l'opérateur relira le
    // geste — le rôle proposé est le `detail`, pas la `cible`, comme
    // `role.change` le fait déjà pour `users.setRole`.
    await journaliser(ctx, {
      acteur: actor,
      action: "invitation.create",
      cible: email,
      detail: args.role,
    })

    return { token } // renvoyé une seule fois, pour l'email ; jamais relisible ensuite
  },
})

// Étape 1 du chemin d'envoi : réclame (lit puis efface) le token en clair,
// dans sa propre transaction — commitée indépendamment de ce que
// `sendInvitationEmail` fait ensuite. C'est ce qui rend l'effacement
// définitif même si l'envoi lui-même échoue juste après (pas de
// RESEND_API_KEY, panne Resend, …) : une mutation Convex est tout-ou-rien,
// donc si la réclamation et l'envoi étaient la même transaction, un envoi
// qui lève ferait aussi annuler l'effacement.
//
// Renvoie `null` si l'invitation a été révoquée avant que ce job ne
// tourne (`revoke` supprime la ligne — et annule le job via
// `scheduledEmailId`, mais un job déjà en vol au moment du `revoke` peut
// quand même s'exécuter une fois) ou si le token a déjà été réclamé
// (rejeu du scheduler) : dans les deux cas, il n'y a rien à envoyer.
export const claimPendingToken = internalMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId)
    if (!invite || invite.pendingToken === undefined) return null
    const { email, pendingToken: token } = invite
    await ctx.db.patch(args.invitationId, { pendingToken: undefined })
    return { email, token }
  },
})

// Une `action`, pas une `mutation` : `resend.sendEmail` doit pouvoir
// échouer (pas de clé API, panne réseau, …) sans jamais pouvoir annuler
// l'effacement de `pendingToken` fait juste avant — voir le commentaire de
// `claimPendingToken`. Une `internalMutation` qui appellerait
// `ctx.db.patch` puis lèverait sur l'envoi annulerait tout, y compris le
// patch, exactement le problème que ce découpage évite.
export const sendInvitationEmail = internalAction({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.invitations.claimPendingToken, {
      invitationId: args.invitationId,
    })
    if (!claimed) return

    // `SITE_URL` is the admin dashboard's own public origin (see
    // `.env.example`'s comment on it, and `docs/superpowers/specs/
    // 2026-08-27-astrotan-design.md` §"Accès au dashboard": the invite
    // link is `/accept-invite?token=…`, on the app that owns the Better
    // Auth session — `apps/admin`, never `apps/web`).
    //
    // Throws rather than returning silently (review I3): a missing
    // `SITE_URL` used to produce no email, no error and no log — the
    // exact "early return on uninterpreted input" shape this project has
    // been bitten by three times before (see `CLAUDE.md`). Scheduling
    // already isolates this failure from `create` (see there), so a
    // failed job — visible in the dashboard, the same as any other
    // scheduled-function failure — is the right signal here, not silence.
    const siteUrl = process.env.SITE_URL
    if (!siteUrl) throw new Error("SITE_URL is not set on this Convex deployment")
    const link = `${siteUrl}/accept-invite?token=${encodeURIComponent(claimed.token)}`

    // Le texte vient de l'écran « envoi des emails », ou du catalogue quand
    // personne n'y a touché — `gabaritPour` décide, et il est le SEUL à
    // décider (voir l'en-tête d'`emails.ts`). Il revalide déjà la ligne
    // enregistrée avant de la rendre, si bien qu'un gabarit devenu invalide
    // (le catalogue a gagné une variable obligatoire depuis) fait retomber
    // l'envoi sur le littéral du code au lieu de l'arrêter — même forme que
    // `choisirExpediteur`. Revalider une seconde fois ici serait recopier
    // cette règle à un endroit où elle finirait par diverger.
    //
    // Aucune lecture d'`actif` : l'invitation n'est pas désactivable, et
    // c'est le seul chemin de création de compte du dépôt (voir
    // `lib/catalogueEmails.ts`). Un interrupteur consulté ici — même un qui
    // ne devrait jamais valoir faux — fermerait cette porte sans recours le
    // jour où une ligne arriverait par une restauration de sauvegarde.
    const gabarit = await ctx.runQuery(internal.emails.gabarit, { cle: "invitation" })
    const valeurs = { lien: link }

    const resend = await makeResend(ctx)
    await resend.sendEmail(ctx, {
      from: await resoudreExpediteur(ctx),
      to: claimed.email,
      // `singleLine` APRÈS le rendu, pas avant : `validerGabarit` garantit
      // que le GABARIT de l'objet tient sur une ligne, jamais ce que les
      // valeurs y injectent. Ici elles sont construites par le serveur,
      // mais la protection appartient au site de rendu, pas à la
      // provenance du jour — c'est `leads.ts` qui reçoit d'Internet, et les
      // deux envois doivent se lire pareil.
      subject: singleLine(rendreTexte(gabarit.objet, valeurs)),
      // Le corps est du texte brut, y compris celui du catalogue : un
      // gabarit réécrit peut déplacer, renommer ou retirer le lien, si
      // bien qu'aucune ancre `<a>` ne peut être reconstruite autour de lui
      // sans deviner. `white-space:pre-wrap` rend les sauts de ligne du
      // texte, et les clients de messagerie transforment l'URL en lien.
      html: `<p style="white-space:pre-wrap">${rendreHtml(gabarit.corps, valeurs)}</p>`,
      text: rendreTexte(gabarit.corps, valeurs),
    })
  },
})

export const accept = mutation({
  // `name` is required, not optional: every account this template creates
  // gets a display name its owner chose. Enforced here and not only in the
  // form, because "the UI asks for it" is not an invariant — a caller that
  // skips the form would otherwise create an account whose display name is
  // its own email address, which is exactly what the old default did.
  args: { token: v.string(), password: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const hash = await hashToken(args.token)
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .unique()
    if (!invite) throw new ConvexError({ code: "INVALID" })
    // Ordre imposé par le brief (ruling 2) : ALREADY_ACCEPTED avant
    // EXPIRED. Une invitation consommée puis expirée doit rester
    // ALREADY_ACCEPTED, jamais EXPIRED — sinon le test d'idempotence
    // devient instable selon le moment où il tourne.
    if (invite.acceptedAt) throw new ConvexError({ code: "ALREADY_ACCEPTED" })
    if (invite.expiresAt < Date.now()) throw new ConvexError({ code: "EXPIRED" })

    // I2 (review) : l'invariant du brief dit "un rôle que son émetteur
    // pouvait accorder" — au présent, pas seulement au moment de
    // l'émission. Sans cette relecture, bannir, rétrograder ou supprimer
    // un admin qui a émis une invitation `role: "admin"` ne l'empêche pas
    // de continuer à fabriquer un compte admin jusqu'à 7 jours plus tard :
    // `create` n'a vérifié l'autorité de l'émetteur qu'une fois, à
    // l'émission. `getAnyUserById` + `decideAccess` sont les deux
    // primitives déjà exportées et pures qui font exactement cette
    // vérification ailleurs dans le code base ; les réutiliser ici évite
    // une troisième implémentation de la même décision. Lève
    // UNAUTHENTICATED (émetteur supprimé), BANNED, ou FORBIDDEN (émetteur
    // rétrogradé en editor) — jamais un succès silencieux.
    // Une invitation émise par l'opérateur (`bootstrap.ts`) n'a pas
    // d'émetteur à relire : elle vient de quelqu'un qui détient les
    // identifiants du déploiement, pas d'un compte. La relecture
    // ci-dessous refuserait toute invitation d'amorçage avec
    // UNAUTHENTICATED — c'est-à-dire exactement le verrouillage que ce
    // chemin existe pour dénouer.
    if (invite.invitedBy !== BOOTSTRAP_ISSUER) {
      const issuer = await authComponent.getAnyUserById(ctx, invite.invitedBy)
      decideAccess(issuer, ["owner", "admin"])
    }

    // C1 (review, critical) : `/admin/create-user` — ce que `createUser`
    // ci-dessous appelle — déclare `password: z.string().optional()` sans
    // aucune borne de longueur, et `minPasswordLength`/`maxPasswordLength`
    // (posés dans `auth.ts`) ne sont vérifiés que par le sign-up, la mise
    // à jour de mot de passe et la réinitialisation — jamais par cette
    // route. Sans ce garde : un mot de passe vide (`""`, falsy) crée un
    // compte au rôle invité mais SANS compte d'identifiants du tout — avec
    // `disableSignUp: true`, pas d'OAuth, pas d'email de réinitialisation
    // et `set-password` réservé à l'owner, cet invité est verrouillé dehors
    // définitivement, et l'email ne peut plus jamais être réinvité
    // (`USER_ALREADY_EXISTS`) — invitation brûlée, compte zombie. Un mot de
    // passe d'un caractère crée un compte admin parfaitement fonctionnel.
    if (
      args.password.length < MIN_PASSWORD_LENGTH ||
      args.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new ConvexError({ code: "WEAK_PASSWORD" })
    }

    // The strength floor, scored by the same function the form's gauge uses
    // (`lib/passwordStrength.ts`) against the same email — so what the
    // visitor was shown while typing is what is applied here, and the gauge
    // is not decoration. Length alone lets "admin1234" and "P@ssw0rd1"
    // through; both fold onto a top-of-the-corpus word and are refused here.
    // Scored against `invite.email` — the address read from the invitation
    // row — never an address the caller supplied.
    if (
      scorePassword(args.password, { email: invite.email }).score <
      MIN_PASSWORD_SCORE
    ) {
      throw new ConvexError({ code: "WEAK_PASSWORD" })
    }

    // M5 (review) : `name` est fourni par l'appelant (celui qui accepte
    // l'invitation, pas l'émetteur) et non borné — il atterrit tel quel
    // dans `profiles.displayName`, que `profiles.updateMine` borne déjà à
    // `MAX_DISPLAY_NAME_LENGTH` (Task 7). Même borne ici, réutilisée
    // plutôt que redéclarée, pour ne pas avoir deux limites qui peuvent
    // diverger.
    const displayName = args.name.trim()
    if (
      displayName.length === 0 ||
      displayName.length > MAX_DISPLAY_NAME_LENGTH
    ) {
      throw new ConvexError({ code: "INVALID_NAME" })
    }

    // Création du compte à travers Better Auth, jamais par un
    // `ctx.db.insert` direct sur une table du composant : c'est ce qui
    // fait traverser au nouveau compte le hook single-owner
    // (`databaseHooks.user.create.before`, Task 6) et le trigger `onCreate`
    // qui crée son profil (Task 7). Appelé sans `headers`/`request` —
    // exactement comme `seedUser` dans les tests — ce qui saute
    // l'échappatoire de permission du plugin admin
    // (`if (!session && (ctx.request || ctx.headers)) throw UNAUTHORIZED`,
    // sautée quand les deux sont absents) : c'est voulu, pas un trou.
    // L'invitation elle-même — déjà vérifiée ci-dessus comme valide, non
    // expirée, non consommée, et émise par quelqu'un qui en a toujours
    // l'autorité — est l'autorisation ; il n'y a par construction aucune
    // session Better Auth pour ce compte avant qu'il n'existe.
    // `create` refuse déjà d'émettre vers un email qui a un compte, mais ce
    // n'est pas suffisant ici : le compte peut naître ENTRE l'émission et
    // l'acceptation, et `bootstrap:createInvitation` — le chemin de
    // l'opérateur, hors interface — n'a pas cette vérification devant lui.
    // Sans ce contrôle, Better Auth remonte son `APIError` brut jusque dans
    // le formulaire (« User already exists. Use another email. ») : en
    // anglais, sans code, donc intraduisible par l'écran qui l'affiche.
    const existingAccount = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user" as const,
      where: [{ field: "email" as const, operator: "eq" as const, value: invite.email }],
    })
    if (existingAccount) {
      throw new ConvexError({ code: "ACCOUNT_ALREADY_EXISTS" })
    }

    const auth = createAuth(ctx)
    await auth.api.createUser({
      body: {
        email: invite.email,
        password: args.password,
        name: displayName,
        role: invite.role,
      },
    })

    // Round 2 (review, item 3): also clear `pendingToken` here, defensively
    // — not only relying on `claimPendingToken` having already done it.
    // Normally it has (the scheduled action runs `runAfter(0)`, long before
    // a human accepts an invitation), but if that action failed *before*
    // `claimPendingToken` ever returned (its own `ctx.runMutation` call
    // throwing, an infrastructure error, …), Convex does not retry
    // scheduled functions, so the field would otherwise sit on the row
    // — past its 7-day `expiresAt` — until something else touches this
    // row. This patch is that something, on the by-far-most-common path
    // out of "invitation exists": it gets accepted.
    await ctx.db.patch(invite._id, { acceptedAt: Date.now(), pendingToken: undefined })
    return { email: invite.email, role: invite.role }
  },
})

export const revoke = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const invite = await ctx.db.get(args.invitationId)
    if (!invite) throw new ConvexError({ code: "NOT_FOUND" })
    // Il n'y a rien à révoquer : le compte existe déjà. Traiter ceci comme
    // un simple nettoyage silencieux effacerait la trace qu'un compte a
    // bien été créé par cette invitation.
    if (invite.acceptedAt) throw new ConvexError({ code: "ALREADY_ACCEPTED" })
    // M8 (review) : annule l'envoi programmé s'il n'a pas encore tourné —
    // sans ça, une invitation révoquée juste avant l'exécution du job
    // laissait quand même partir l'email d'invitation, un lien mort mais
    // trompeur pour qui le reçoit.
    //
    // Round 2 (review) : `ctx.scheduler.cancel` n'est PAS un no-op sûr sur
    // un job déjà terminé — pour une `action` (ce que `sendInvitationEmail`
    // est depuis le round 1), le typedoc de Convex 1.45 dit explicitement
    // l'inverse : "If it had already completed, canceling will throw an
    // error." Un job planifié en `runAfter(0)` a, dans l'immense majorité
    // des cas, déjà fini d'exécuter (avec succès ou en échec) bien avant
    // qu'un opérateur ne songe à révoquer l'invitation — c'est le cas
    // *normal*, pas un cas limite. Lire l'état du job avant d'annuler,
    // et n'annuler que s'il est encore `pending`/`inProgress`, est ce qui
    // rend `revoke` utilisable sur le chemin de récupération que I5/M8
    // sont censés fournir, au lieu de le faire lever sur pratiquement
    // toute invitation dont l'email a déjà été envoyé (avec succès ou en
    // échec).
    if (invite.scheduledEmailId) {
      const job = await ctx.db.system.get(invite.scheduledEmailId)
      if (job && (job.state.kind === "pending" || job.state.kind === "inProgress")) {
        await ctx.scheduler.cancel(invite.scheduledEmailId)
      }
    }
    await ctx.db.delete(args.invitationId)
  },
})

// I5 (review) : sans ceci, aucune query ne renvoie un id d'invitation — un
// opérateur ne peut ni voir les invitations en attente, ni en révoquer
// une, ni récupérer un token après un envoi raté (I3). `_id` est ce que
// `revoke` prend en argument ; ni `tokenHash` ni `pendingToken` ne sont
// jamais renvoyés — la liste explicite des champs ci-dessous (pas un
// spread) est ce qui garantit ça mécaniquement plutôt que par discipline.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const rows = await ctx.db.query("invitations").collect()
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      role: r.role,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      invitedBy: r.invitedBy,
    }))
  },
})

// Unauthenticated, exactly like `accept` below: this is what `/accept-invite`
// (`apps/admin/src/routes/accept-invite.tsx`) calls to show the invited
// email and role *before* the visitor types a password, per the task's
// requirement that those come "from the invitation, not from anything the
// visitor supplies" — a URL could otherwise carry an arbitrary email/role
// query param the page displayed uncritically. Deliberately narrower than
// `accept`: no issuer re-check here (that answer can go stale between page
// load and submission regardless, and `accept` re-verifies it for real at
// the point that matters — creating the account), and no session/role gate
// (the whole point of an invite link is that the person holding it has no
// account yet). Same three early codes as `accept`, same order (ruling 2:
// ALREADY_ACCEPTED before EXPIRED, so a consumed-then-expired invitation
// reports consistently either way) — reusing them here rather than a
// fourth representation of "is this token still good" that could drift
// from `accept`'s own. Returns only `email`/`role`: never `tokenHash`,
// `pendingToken`, or the token argument itself.
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const hash = await hashToken(args.token)
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .unique()
    if (!invite) throw new ConvexError({ code: "INVALID" })
    if (invite.acceptedAt) throw new ConvexError({ code: "ALREADY_ACCEPTED" })
    if (invite.expiresAt < Date.now()) throw new ConvexError({ code: "EXPIRED" })
    return { email: invite.email, role: invite.role }
  },
})

// Requis par le test d'exhaustivité de `_registry.test.ts` (voir
// `profiles.ts` pour le même mécanisme) : toute mutation publique doit être
// déclarée ici, sans quoi ce test échoue. `list` (query) n'y figure pas :
// le registre ne suit que les mutations, comme `profiles.me` (query) ne
// l'est pas non plus.
MUTATION_REGISTRY.push(
  {
    name: "invitations.create",
    allowedRoles: ["owner", "admin"],
    invoke: (t) =>
      t.mutation(api.invitations.create, {
        email: "registry-check@example.com",
        role: "editor",
      }),
  },
  {
    name: "invitations.revoke",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const invitationId = await t.run((ctx: any) =>
        ctx.db.insert("invitations", {
          email: "registry-revoke@example.com",
          role: "editor",
          tokenHash: `registry-revoke-${Date.now()}-${Math.random()}`,
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          invitedBy: "registry-check",
        }),
      )
      return t.mutation(api.invitations.revoke, { invitationId })
    },
  },
  {
    // `accept` is not gated by role at all, on purpose: it's how a brand
    // new account — with no session yet — comes into existence, so its
    // authorization is possession of a valid token, never the caller's own
    // role. Listing all three roles here records that honestly: none of
    // them are ever refused (the matrix never generates a "refusé" case
    // for this entry), because none of them is what `accept` checks. The
    // genuinely unauthenticated call — the real shape `accept` is used
    // in — is covered directly in `invitations.test.ts`, which the matrix
    // itself never exercises.
    //
    // Seeds a *real* admin as the invitation's issuer (review I2 made this
    // necessary — `accept` now re-verifies `invitedBy` at acceptance time,
    // so a placeholder string like the old `"registry-check"` would make
    // every one of these three matrix cases fail with UNAUTHENTICATED
    // instead of succeeding as declared).
    name: "invitations.accept",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const issuerEmail = `registry-accept-issuer-${Date.now()}-${Math.random()}@example.com`
      const issuer = await t.run((ctx: any) =>
        createAuth(ctx).api.createUser({
          body: {
            email: issuerEmail,
            password: "correct horse battery staple issuer",
            name: "Registry Issuer",
            role: "admin",
          },
        }),
      )
      const issuerId = (issuer as { user: { id: string } }).user.id

      const { token, hash } = await generateToken()
      await t.run((ctx: any) =>
        ctx.db.insert("invitations", {
          email: `registry-accept-${Date.now()}-${Math.random()}@example.com`,
          role: "editor",
          tokenHash: hash,
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          invitedBy: issuerId,
        }),
      )
      return t.mutation(api.invitations.accept, {
        token,
        password: "correct horse battery staple registry",
        name: "Registry Invitee",
      })
    },
  },
)
