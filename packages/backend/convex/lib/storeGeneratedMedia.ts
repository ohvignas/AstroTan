import { ConvexError } from "convex/values"
import type { ActionCtx } from "../_generated/server"
import { api } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { MAX_MEDIA_SIZE_BYTES } from "../content"
import { lireSecret } from "../secrets"
import { contexteSite } from "./aiSiteContext"
import {
  coverCaption,
  coverCaptionSystemPrompt,
  coverCaptionUserPrompt,
  parseCoverCaptionDraft,
} from "./coverCaption"
import { completerJson } from "./openrouter"
import { resolveOpenRouterModel } from "./openRouterModels"
import { resolveOpenRouterImageModel } from "./openRouterImageModels"
import { genererImage, type GeneratedImage } from "./openRouterImage"

export type GeneratedMediaMeta = {
  filename: string
  alt: string
  title: string
}

export function generatedMediaMeta(input: {
  prefix: string
  slug: string
  mime: string
  title: string
  excerpt?: string
  targetKeyword?: string
  fallbackAlt: string
}): GeneratedMediaMeta {
  const ext =
    input.mime === "image/jpeg" ? "jpg" : input.mime === "image/webp" ? "webp" : "png"
  const caption = coverCaption({
    title: input.title,
    excerpt: input.excerpt,
    targetKeyword: input.targetKeyword,
  })
  return {
    filename: `${input.prefix}-${input.slug}.${ext}`,
    alt: caption.alt || input.fallbackAlt,
    title: caption.title || caption.alt || input.fallbackAlt,
  }
}

export async function storeGeneratedMedia(
  ctx: ActionCtx,
  image: GeneratedImage,
  meta: GeneratedMediaMeta,
): Promise<Id<"_storage">> {
  if (image.bytes.byteLength > MAX_MEDIA_SIZE_BYTES) {
    throw new ConvexError({ code: "FILE_TOO_LARGE", max: MAX_MEDIA_SIZE_BYTES })
  }
  const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mime })
  const storageId = await ctx.storage.store(blob)
  await ctx.runMutation(api.media.register, {
    storageId,
    filename: meta.filename,
    mime: image.mime,
    size: image.bytes.byteLength,
    alt: meta.alt,
    title: meta.title,
  })
  return storageId
}

async function legendeModele(
  apiKey: string,
  model: string,
  referer: string | undefined,
  input: { title: string; excerpt?: string; targetKeyword?: string },
): Promise<{ alt: string; title: string } | null> {
  try {
    const draft = await completerJson({
      apiKey,
      model,
      referer,
      system: coverCaptionSystemPrompt(),
      user: coverCaptionUserPrompt(input),
    })
    return parseCoverCaptionDraft(draft)
  } catch {
    return null
  }
}

export async function generateAndRegisterCover(
  ctx: ActionCtx,
  input: {
    prompt: string
    slug: string
    title: string
    excerpt?: string
    targetKeyword?: string
    prefix: string
    fallbackAlt: string
  },
): Promise<Id<"_storage">> {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (apiKey === null) {
    throw new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" })
  }
  const site = await contexteSite(ctx)
  const privee = await ctx.runQuery(api.settings.getPrivate, {})
  const image = await genererImage({
    apiKey,
    model: resolveOpenRouterImageModel(privee?.openRouterImageModel),
    prompt: input.prompt,
    referer: site.webOrigin,
  })
  const meta = generatedMediaMeta({
    prefix: input.prefix,
    slug: input.slug,
    mime: image.mime,
    title: input.title,
    excerpt: input.excerpt,
    targetKeyword: input.targetKeyword,
    fallbackAlt: input.fallbackAlt,
  })
  const fromModel = await legendeModele(
    apiKey,
    resolveOpenRouterModel(privee?.openRouterModel),
    site.webOrigin,
    input,
  )
  return storeGeneratedMedia(ctx, image, fromModel ? { ...meta, ...fromModel } : meta)
}
