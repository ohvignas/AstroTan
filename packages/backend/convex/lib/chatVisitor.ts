import { createThread, saveMessage } from "@convex-dev/agent"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { ConvexError } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { MAX_LEAD_BODY_LENGTH } from "../content"
import {
  assertChatFilename,
  buildChatUserContent,
  chatUserSaveArgs,
  persistChatFile,
  readStoredChatFile,
} from "./chatMedia"
import { assertChatEmail, createOrLinkChatLead, normalizeChatEmail } from "./chatLead"
import { leadGeoPatch, type LeadGeo } from "./leadGeo"
import {
  assertChatAttachEmailBudget,
  assertChatMessageBudget,
  assertChatStartBudget,
} from "./chatRateLimit"
import { issueChatSession, renewChatSessionTtl, requireChatSession } from "./chatSession"
import {
  LEAD_EMAIL_LIMIT_CONFIG,
  LEAD_EMAIL_LIMIT_NAME,
  LEAD_ORIGIN_LIMIT_CONFIG,
  LEAD_ORIGIN_LIMIT_NAME,
} from "./leadRateLimit"
import { origineDeComptage } from "./originFingerprint"
import { assertSharedSecret } from "./sharedSecret"

const limiteur = new RateLimiter(components.rateLimiter, {
  [LEAD_ORIGIN_LIMIT_NAME]: LEAD_ORIGIN_LIMIT_CONFIG,
  [LEAD_EMAIL_LIMIT_NAME]: LEAD_EMAIL_LIMIT_CONFIG,
})

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

async function assertLeadOriginBudget(ctx: MutationCtx, origin: string | undefined): Promise<void> {
  const parOrigine = await limiteur.limit(ctx, LEAD_ORIGIN_LIMIT_NAME, {
    key: origineDeComptage(origin),
  })
  if (!parOrigine.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
  }
}

async function assertLeadEmailBudget(ctx: MutationCtx, email: string): Promise<void> {
  const parEmail = await limiteur.limit(ctx, LEAD_EMAIL_LIMIT_NAME, { key: email })
  if (!parEmail.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parEmail.retryAfter })
  }
}

export async function startVisitorChat(
  ctx: MutationCtx,
  args: { secret: string; origin?: string; email?: string; name?: string } & LeadGeo,
): Promise<{ token: string; leadId?: Id<"leads">; threadId: string; expiresAt: number }> {
  await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)

  const email = normalizeChatEmail(args.email)
  const geo = leadGeoPatch(args)
  // Sans e-mail ni IP, on ne peut pas identifier : session seule, pas de fiche.
  // Dès qu'on a l'IP (route Astro), la fiche existe — c'est le plus tôt fiable.
  if (email.length === 0 && !geo.ip) {
    await assertChatStartBudget(ctx, args.origin)
    const threadId = await createThread(ctx, components.agent, {
      userId: "anon",
      title: "Conversation",
    })
    const { token, expiresAt } = await issueChatSession(ctx, null, threadId)
    return { token, threadId, expiresAt }
  }

  if (email.length === 0) {
    await assertChatStartBudget(ctx, args.origin)
  } else {
    await assertLeadOriginBudget(ctx, args.origin)
    await assertLeadEmailBudget(ctx, email)
    assertChatEmail(email)
  }

  const { leadId, threadId: existingThread } = await createOrLinkChatLead(ctx, {
    ...(email.length > 0 ? { email } : {}),
    name: args.name,
    ...geo,
  })
  let threadId = existingThread
  if (!threadId) {
    threadId = await createThread(ctx, components.agent, {
      userId: String(leadId),
      title: email.length > 0 ? email : "Conversation",
    })
    await ctx.db.patch(leadId, { threadId })
    await ctx.db.insert("leadEvents", { leadId, type: "chat_started" })
  }

  const { token, expiresAt } = await issueChatSession(ctx, leadId, threadId)
  return { token, leadId, threadId, expiresAt }
}

export async function attachVisitorEmail(
  ctx: MutationCtx,
  args: { secret: string; token: string; email: string; name?: string; origin?: string } & LeadGeo,
): Promise<{ leadId: Id<"leads"> }> {
  await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
  const session = await requireChatSession(ctx, args.token)
  const email = normalizeChatEmail(args.email)
  if (email.length === 0) throw new ConvexError({ code: "EMPTY" })
  assertChatEmail(email)

  const already = session.leadId ? await ctx.db.get(session.leadId) : null
  if (already?.email) {
    // Fiche déjà identifiée : on écrit quand même l'IP / le pays, on ne
    // remplace pas l'adresse. C'est le bug « e-mail ⇒ on skip l'IP ».
    const geo = leadGeoPatch(args)
    if (Object.keys(geo).length > 0) await ctx.db.patch(already._id, geo)
    return { leadId: already._id }
  }

  await assertChatAttachEmailBudget(ctx, args.origin, args.token)

  const { leadId, threadId: existingThread } = await createOrLinkChatLead(ctx, {
    email,
    name: args.name,
    // L'IP de la session anonyme relie, même si ce tour n'en renvoie pas.
    ip: args.ip ?? already?.ip,
    country: args.country ?? already?.country,
    city: args.city ?? already?.city,
    latitude: args.latitude ?? already?.latitude,
    longitude: args.longitude ?? already?.longitude,
    timezone: args.timezone ?? already?.timezone,
    pageUrl: args.pageUrl ?? already?.pageUrl,
  })
  await ctx.db.patch(leadId, { threadId: session.threadId })
  if (!existingThread && !session.leadId) {
    await ctx.db.insert("leadEvents", { leadId, type: "chat_started" })
  }
  await ctx.db.patch(session.sessionId, { leadId })
  return { leadId }
}

export async function sendVisitorMessage(
  ctx: MutationCtx,
  args: {
    secret: string
    token: string
    body: string
    origin?: string
    storageId?: Id<"_storage">
    filename?: string
    mime?: string
    pageUrl?: string
  },
): Promise<{ messageId: string }> {
  await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
  const session = await requireChatSession(ctx, args.token)

  const body = args.body.trim()
  const file = args.storageId
    ? await readStoredChatFile(ctx, args.storageId, args.filename, args.mime)
    : null
  const filename = file ? assertChatFilename(args.filename ?? "image") : undefined
  if (body.length === 0 && file === null) throw new ConvexError({ code: "EMPTY" })
  assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")

  let controller: "ai" | "staff" = "ai"
  if (session.leadId) {
    const lead = await ctx.db.get(session.leadId)
    if (lead === null) throw new ConvexError({ code: "INVALID_SESSION" })
    await assertChatMessageBudget(ctx, args.origin, lead.email)
    controller = lead.controller ?? "ai"
    await ctx.db.patch(lead._id, {
      lastMessageAt: Date.now(),
      ...leadGeoPatch({ pageUrl: args.pageUrl }),
    })
  } else {
    await assertChatMessageBudget(ctx, args.origin)
  }

  if (controller === "ai") {
    const settings = await ctx.db.query("settings").first()
    if (settings?.agentEnabled !== true) {
      throw new ConvexError({ code: "AGENT_DISABLED" })
    }
  }

  const imageUrl = file ? await ctx.storage.getUrl(file.storageId) : null
  if (file !== null && (imageUrl === null || imageUrl.length === 0)) {
    throw new ConvexError({ code: "INVALID_FILE" })
  }
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: session.threadId,
    ...chatUserSaveArgs(
      buildChatUserContent({
        body,
        filename,
        imageUrl,
        mime: file?.mime,
      }),
    ),
  })
  if (file && filename) {
    await persistChatFile(ctx, {
      threadId: session.threadId,
      messageId,
      storageId: file.storageId,
      filename,
      mime: file.mime,
      size: file.size,
    })
  }
  await renewChatSessionTtl(ctx, session.sessionId)

  if (controller === "ai") {
    await ctx.scheduler.runAfter(0, internal.chatStream.stream, {
      threadId: session.threadId,
      promptMessageId: messageId,
    })
  }
  return { messageId }
}
