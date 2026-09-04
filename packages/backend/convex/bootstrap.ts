import { ConvexError, v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import { components } from "./_generated/api"
import { roleValidator } from "./validators"
import { generateToken } from "./lib/token"
import { listUsersWithRole } from "./users"

// The operator's way back in.
//
// Access to this dashboard is invitation-only (`disableSignUp: true`, no
// OAuth), and issuing an invitation requires an authenticated owner or
// admin. That is correct, and it leaves two situations with no way out:
//
//   - a freshly deployed instance has no accounts at all, so nobody can
//     invite the first one;
//   - every owner and admin has lost access, and the invitation flow that
//     would fix it is the flow they can no longer reach.
//
// Both are the same problem, and every invitation-only system needs an
// answer to it. This is that answer: an `internalMutation`, so it is not
// reachable from any client, only from `npx convex run` — which already
// requires the deployment's own credentials. Someone holding those can do
// anything to this deployment regardless; this does not widen that.
//
//     npx convex run bootstrap:createInvitation '{"email":"…","role":"owner"}'
//
// It returns a link. The account is then created through the ordinary
// accept-invite page, by a human choosing their own password — so no
// password ever passes through a shell, a history file, or a log.
//
// `role: "owner"`, and not `"admin"`. This is the one argument worth
// getting right, because the wrong value produces a deployment that
// *looks* fine and is permanently capped:
//
//   - `invitations.create` refuses `role: "owner"` for every actor, so no
//     account created later can ever be an owner;
//   - an `admin` may not invite another `admin` (`invitations.create`), nor
//     promote, demote or remove one (`users.setRole`, `users.remove`).
//
// A deployment whose first account is an `admin` therefore has exactly one
// administrator, forever, with no way out through the interface — the very
// lockout this file exists to end. `scripts/bootstrap.mjs` passes `owner`
// and `convex/bootstrap.test.ts` pins both halves of the reasoning.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export const createInvitation = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()
    if (email.length === 0 || !email.includes("@")) {
      throw new ConvexError({ code: "INVALID_EMAIL" })
    }

    // Refuses a second pending invitation for the same address rather than
    // quietly issuing one: two live links for one account is a question
    // nobody wants to answer later ("which one did they use?").
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
    const pending = existing.find(
      (row) => !row.acceptedAt && row.expiresAt > Date.now()
    )
    if (pending) {
      throw new ConvexError({ code: "ALREADY_INVITED", email })
    }

    const { token, hash } = await generateToken()
    await ctx.db.insert("invitations", {
      email,
      role: args.role,
      tokenHash: hash,
      expiresAt: Date.now() + SEVEN_DAYS_MS,
      // Marks the row as operator-issued rather than invented by a user
      // that does not exist. `invitations.accept` re-checks the issuer's
      // authority at acceptance time and treats an unresolvable id as a
      // refusal — so this sentinel has to be one it recognises.
      invitedBy: BOOTSTRAP_ISSUER,
    })

    return { email, role: args.role, token }
  },
})

/**
 * The `invitedBy` value operator-issued invitations carry.
 *
 * Exported so `invitations.accept` can recognise it: that mutation
 * re-verifies the issuer's authority at acceptance time — deliberately, so
 * demoting or banning an admin also kills the invitations they issued — and
 * an operator-issued row has no issuer to look up. Without this exception
 * every bootstrap link would be refused with UNAUTHENTICATED, which is
 * exactly the lockout this file exists to end.
 */
export const BOOTSTRAP_ISSUER = "bootstrap:operator"

/**
 * Les adresses des comptes `owner`, pour `scripts/bootstrap.mjs`.
 *
 * `pnpm bootstrap` est rejouable, et `createInvitation` ne l'est pas :
 * relancé après qu'un owner a accepté son invitation, il émettrait un
 * SECOND lien, parfaitement valide en apparence, que le garde-fou
 * `owners > 0` d'`auth.ts` refusera au moment de l'acceptation. Le script
 * lit donc cette query d'abord et saute l'étape — plutôt que de distribuer
 * un lien mort à chaque exécution.
 *
 * Rend les adresses et rien d'autre : c'est ce qui permet au script de
 * nommer le compte existant. `internalQuery`, donc inatteignable depuis un
 * client, exactement comme `createInvitation` juste au-dessus.
 */
export const owners = internalQuery({
  args: {},
  handler: async (ctx) => {
    const found = await listUsersWithRole(ctx, "owner")
    return found.map((user) => user.email)
  },
})

/**
 * Lien d'accès local pour un agent (`pnpm admin:dev-link`).
 *
 * Réutilise le seul chemin déjà dans le produit : une invitation Better
 * Auth, acceptée sur `/accept-invite?token=…` avec un mot de passe choisi
 * dans le navigateur. Pas de backdoor, pas de skip auth, pas de second
 * owner. Rejouable : une invitation encore en attente pour cette adresse
 * est remplacée (le jeton n'est pas relisible — seul son hash est stocké).
 *
 * `internalMutation` : inatteignable depuis un client, comme
 * `createInvitation`. Un compte déjà créé pour l'adresse rend
 * `ACCOUNT_ALREADY_EXISTS` — le script se rabat alors sur le
 * `storageState` Playwright gitignoré, s'il existe.
 */
export const devAccessLink = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()
    if (email.length === 0 || !email.includes("@")) {
      throw new ConvexError({ code: "INVALID_EMAIL" })
    }

    const existingAccount = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user" as const,
      where: [{ field: "email" as const, operator: "eq" as const, value: email }],
    })
    if (existingAccount) {
      throw new ConvexError({ code: "ACCOUNT_ALREADY_EXISTS", email })
    }

    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
    for (const row of existing) {
      if (row.acceptedAt) continue
      if (row.scheduledEmailId) {
        const job = await ctx.db.system.get(row.scheduledEmailId)
        if (job && (job.state.kind === "pending" || job.state.kind === "inProgress")) {
          await ctx.scheduler.cancel(row.scheduledEmailId)
        }
      }
      await ctx.db.delete(row._id)
    }

    const ownersFound = await listUsersWithRole(ctx, "owner")
    const role = ownersFound.length === 0 ? "owner" : "editor"

    const { token, hash } = await generateToken()
    await ctx.db.insert("invitations", {
      email,
      role,
      tokenHash: hash,
      expiresAt: Date.now() + SEVEN_DAYS_MS,
      invitedBy: BOOTSTRAP_ISSUER,
    })

    return { kind: "accept-invite" as const, email, role, token }
  },
})
