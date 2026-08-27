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
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"]),
})
