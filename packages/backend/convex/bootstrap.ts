import { ConvexError, v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { roleValidator } from "./validators"
import { generateToken } from "./lib/token"

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
//     npx convex run bootstrap:createInvitation '{"email":"…","role":"admin"}'
//
// It returns a link. The account is then created through the ordinary
// accept-invite page, by a human choosing their own password — so no
// password ever passes through a shell, a history file, or a log.

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
