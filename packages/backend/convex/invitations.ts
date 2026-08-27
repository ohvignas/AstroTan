import { ConvexError, v } from "convex/values"
import { Resend } from "@convex-dev/resend"
import { internalAction, internalMutation, mutation, query } from "./_generated/server"
import { api, components, internal } from "./_generated/api"
import { decideAccess, requireRole } from "./lib/authz"
import { authComponent, createAuth, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth"
import { generateToken, hashToken } from "./lib/token"
import { roleValidator } from "./validators"
import { MAX_DISPLAY_NAME_LENGTH } from "./profiles"
import { MUTATION_REGISTRY } from "./_registry"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Module-level client, exactly as `@convex-dev/resend`'s own README sets
// it up. `testMode` is read from the environment (review I3) rather than
// hard-coded, so going live in production is a configuration change
// (`RESEND_TEST_MODE=false` + a verified sending domain), not a code
// change — `!== "false"` keeps the component's own safe default (`true`)
// for every value except the literal string `"false"`, including unset.
const resend: Resend = new Resend(components.resend, {
  testMode: process.env.RESEND_TEST_MODE !== "false",
})

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

    // M1 (review): normalise avant stockage — `createUser` (dans `accept`)
    // fait de toute façon `email.toLowerCase()` et valide le format avec
    // zod, mais seulement au moment de l'acceptation. Sans cette
    // normalisation ici, une adresse mal capitalisée ou avec des espaces
    // superflus produit une invitation dont le hash de token est valide
    // mais dont l'email ne correspondra jamais exactement au compte que
    // `createUser` finira par créer avec l'email normalisé.
    const email = args.email.trim().toLowerCase()

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
    // `sendInvitationEmail` reads instead — and it clears that field
    // before ever attempting to send, bounding the exposure to the time
    // between scheduling and that claim (milliseconds, normally) rather
    // than the job record's full retention.
    const scheduledEmailId = await ctx.scheduler.runAfter(
      0,
      internal.invitations.sendInvitationEmail,
      { invitationId },
    )
    await ctx.db.patch(invitationId, { scheduledEmailId })

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

    await resend.sendEmail(ctx, {
      from: "AstroTan <onboarding@resend.dev>",
      to: claimed.email,
      subject: "Invitation à rejoindre AstroTan",
      html: `<p>Vous avez été invité·e à rejoindre AstroTan.</p><p><a href="${link}">Créer votre compte</a></p>`,
      text: `Vous avez été invité·e à rejoindre AstroTan : ${link}`,
    })
  },
})

export const accept = mutation({
  args: { token: v.string(), password: v.string(), name: v.optional(v.string()) },
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
    const issuer = await authComponent.getAnyUserById(ctx, invite.invitedBy)
    decideAccess(issuer, ["owner", "admin"])

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

    // M5 (review) : `name` est fourni par l'appelant (celui qui accepte
    // l'invitation, pas l'émetteur) et non borné — il atterrit tel quel
    // dans `profiles.displayName`, que `profiles.updateMine` borne déjà à
    // `MAX_DISPLAY_NAME_LENGTH` (Task 7). Même borne ici, réutilisée
    // plutôt que redéclarée, pour ne pas avoir deux limites qui peuvent
    // diverger.
    let displayName = invite.email
    if (args.name !== undefined) {
      const trimmed = args.name.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new ConvexError({ code: "INVALID_NAME" })
      }
      displayName = trimmed
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
    const auth = createAuth(ctx)
    await auth.api.createUser({
      body: {
        email: invite.email,
        password: args.password,
        name: displayName,
        role: invite.role,
      },
    })

    await ctx.db.patch(invite._id, { acceptedAt: Date.now() })
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
    // trompeur pour qui le reçoit. `ctx.scheduler.cancel` est un no-op sûr
    // si le job a déjà tourné ou n'existe plus.
    if (invite.scheduledEmailId) {
      await ctx.scheduler.cancel(invite.scheduledEmailId)
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
      })
    },
  },
)
