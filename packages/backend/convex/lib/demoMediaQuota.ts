import { ConvexError } from "convex/values"
import type { MutationCtx } from "../_generated/server"
import { estCompteDemo } from "./demoSandbox"

export const DEMO_MEDIA_MAX_FILES = 10
export const DEMO_MEDIA_MAX_BYTES = 20 * 1024 * 1024

export async function assertDemoMediaQuota(
  ctx: MutationCtx,
  authUser: { _id: string; email: string },
  incomingSize: number,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (!estCompteDemo(authUser, env)) return
  const existing = await ctx.db
    .query("media")
    .withIndex("by_created_by", (q) => q.eq("createdBy", authUser._id))
    .collect()
  const sum = existing.reduce((n, m) => n + m.size, 0)
  if (existing.length >= DEMO_MEDIA_MAX_FILES || sum + incomingSize > DEMO_MEDIA_MAX_BYTES) {
    throw new ConvexError({ code: "DEMO_QUOTA" })
  }
}
