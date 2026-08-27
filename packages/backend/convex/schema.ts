import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { roleValidator } from "./validators"

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
})
