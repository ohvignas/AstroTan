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
    // send job actually runs — present only in the brief window between
    // `create` and that claim, never for the invitation's whole life.
    // Review round 1, I1: the token used to be a scheduled-function
    // *argument* instead, which Convex retains verbatim in the
    // `_scheduled_functions` system table (readable via `ctx.db.system`
    // from any function in the deployment, and visible in the dashboard)
    // for as long as that job record exists — contradicting `lib/token.ts`'s
    // own claim that the plaintext is "never persisted anywhere". Staging
    // it in a field we control and clearing it first, before ever
    // attempting to send, bounds the exposure to milliseconds instead.
    pendingToken: v.optional(v.string()),
    // The scheduled `sendInvitationEmail` job's own id, so `revoke` can
    // cancel it (M8) rather than letting an already-revoked invitation's
    // email go out after the fact.
    scheduledEmailId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"]),
})
