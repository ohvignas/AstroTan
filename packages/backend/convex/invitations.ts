import { ConvexError, v } from "convex/values"
import { Resend } from "@convex-dev/resend"
import { internalMutation, mutation } from "./_generated/server"
import { api, components, internal } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { createAuth } from "./auth"
import { generateToken, hashToken } from "./lib/token"
import { roleValidator } from "./validators"
import { MUTATION_REGISTRY } from "./_registry"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Module-level client, exactly as `@convex-dev/resend`'s own README sets
// it up. `testMode` defaults to `true` (the component's own default,
// unset here) on purpose: production going-live is a deliberate,
// out-of-scope decision (setting `testMode: false` and a real
// `RESEND_API_KEY`), not something this task should silently flip.
const resend: Resend = new Resend(components.resend, {})

// Le seul chemin par lequel un compte peut naître dans ce système : une
// invitation valide, jamais expirée, jamais déjà consommée, pour l'email et
// le rôle exacts qu'elle porte. `create` fabrique cette invitation ; `accept`
// (plus bas) est ce qui la consomme pour fabriquer le compte.
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
    // ce chemin — les deux barrières sont indépendantes, voir
    // `invitations.test.ts`.
    if (args.role === "owner") throw new ConvexError({ code: "FORBIDDEN" })

    const { token, hash } = await generateToken()
    await ctx.db.insert("invitations", {
      email: args.email,
      role: args.role,
      tokenHash: hash,
      expiresAt: Date.now() + SEVEN_DAYS_MS,
      invitedBy: actor._id,
    })

    // Scheduled, not inline (ruling 4 of the task brief): whatever happens
    // inside the actual send — no RESEND_API_KEY configured, a Resend
    // outage, an invalid `from` address — must never roll back the
    // invitation this mutation just created. Scheduling it as a separate
    // function is what isolates that failure from this one; calling
    // `resend.sendEmail` inline here would let it abort this entire
    // transaction, including the `ctx.db.insert` above, on any send
    // failure. The token is already returned to the caller below
    // regardless of whether the email ever goes out, so the admin UI can
    // always recover and hand it over manually — this task doesn't build
    // that UI, but it's what makes a failed send not a dead end.
    await ctx.scheduler.runAfter(0, internal.invitations.sendInvitationEmail, {
      email: args.email,
      token,
    })

    return { token } // renvoyé une seule fois, pour l'email ; jamais relisible ensuite
  },
})

export const sendInvitationEmail = internalMutation({
  args: { email: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    // `SITE_URL` is the admin dashboard's own public origin (see
    // `.env.example`'s comment on it, and `docs/superpowers/specs/
    // 2026-08-27-astrotan-design.md` §"Accès au dashboard": the invite
    // link is `/accept-invite?token=…`, on the app that owns the Better
    // Auth session — `apps/admin`, never `apps/web`). Unset in some
    // dev/test setups; skip rather than send a broken link with no host.
    const siteUrl = process.env.SITE_URL
    if (!siteUrl) return
    const link = `${siteUrl}/accept-invite?token=${encodeURIComponent(args.token)}`

    await resend.sendEmail(ctx, {
      from: "AstroTan <onboarding@resend.dev>",
      to: args.email,
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
    // expirée et non consommée — est l'autorisation ; il n'y a par
    // construction aucune session Better Auth pour ce compte avant qu'il
    // n'existe.
    const auth = createAuth(ctx)
    await auth.api.createUser({
      body: {
        email: invite.email,
        password: args.password,
        name: args.name ?? invite.email,
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
    await ctx.db.delete(args.invitationId)
  },
})

// Requis par le test d'exhaustivité de `_registry.test.ts` (voir
// `profiles.ts` pour le même mécanisme) : toute mutation publique doit être
// déclarée ici, sans quoi ce test échoue.
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
    // itself never exercises (it always calls through an authenticated
    // identity).
    name: "invitations.accept",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const { token, hash } = await generateToken()
      await t.run((ctx: any) =>
        ctx.db.insert("invitations", {
          email: `registry-accept-${Date.now()}-${Math.random()}@example.com`,
          role: "editor",
          tokenHash: hash,
          expiresAt: Date.now() + SEVEN_DAYS_MS,
          invitedBy: "registry-check",
        }),
      )
      return t.mutation(api.invitations.accept, {
        token,
        password: "correct horse battery staple registry",
      })
    },
  },
)
