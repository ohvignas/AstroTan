import { v } from "convex/values"
export const roleValidator = v.union(
  v.literal("owner"), v.literal("admin"), v.literal("editor"),
)
export type Role = "owner" | "admin" | "editor"
