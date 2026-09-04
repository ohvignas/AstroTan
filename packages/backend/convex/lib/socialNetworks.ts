import { ConvexError } from "convex/values"
import {
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
} from "../content"

export const SOCIAL_NETWORKS = [
  { id: "instagram", label: "Instagram", aliases: ["ig", "insta"] },
  { id: "facebook", label: "Facebook", aliases: ["fb"] },
  { id: "linkedin", label: "LinkedIn", aliases: [] },
  { id: "x", label: "X", aliases: ["twitter"] },
  { id: "youtube", label: "YouTube", aliases: ["yt"] },
  { id: "tiktok", label: "TikTok", aliases: [] },
  { id: "whatsapp", label: "WhatsApp", aliases: ["wa"] },
  { id: "telegram", label: "Telegram", aliases: [] },
  { id: "pinterest", label: "Pinterest", aliases: [] },
  { id: "github", label: "GitHub", aliases: ["gh"] },
  { id: "threads", label: "Threads", aliases: [] },
  { id: "bluesky", label: "Bluesky", aliases: ["bsky"] },
  { id: "discord", label: "Discord", aliases: [] },
  { id: "mastodon", label: "Mastodon", aliases: [] },
] as const

export type SocialNetworkId = (typeof SOCIAL_NETWORKS)[number]["id"]
export type SocialRow = { label: string; url: string }

const BY_KEY = new Map<string, SocialNetworkId>()
for (const network of SOCIAL_NETWORKS) {
  BY_KEY.set(network.id, network.id)
  BY_KEY.set(network.label.toLowerCase(), network.id)
  for (const alias of network.aliases) {
    BY_KEY.set(alias.toLowerCase(), network.id)
  }
}

export function resolveSocialNetwork(value: string): SocialNetworkId | null {
  return BY_KEY.get(value.trim().toLowerCase()) ?? null
}

export function socialLabel(id: SocialNetworkId): string {
  const network = SOCIAL_NETWORKS.find((item) => item.id === id)
  return network?.label ?? id
}

export function isSocialHttpUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function availableNetworks(used: readonly string[]) {
  const taken = new Set(
    used
      .map((value) => resolveSocialNetwork(value))
      .filter((id): id is SocialNetworkId => id !== null),
  )
  return SOCIAL_NETWORKS.filter((network) => !taken.has(network.id))
}

export function hydrateSocials(
  rows: readonly SocialRow[],
): { id: SocialNetworkId; url: string }[] {
  const seen = new Set<SocialNetworkId>()
  const out: { id: SocialNetworkId; url: string }[] = []
  for (const row of rows) {
    const id = resolveSocialNetwork(row.label)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    out.push({ id, url: row.url })
  }
  return out
}

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
}

export function assertSocials(socials: SocialRow[]): SocialRow[] {
  if (socials.length > MAX_SOCIALS) {
    throw new ConvexError({
      code: "FIELD_TOO_MANY",
      field: "socials",
      max: MAX_SOCIALS,
    })
  }
  const seen = new Set<SocialNetworkId>()
  const out: SocialRow[] = []
  for (const [index, social] of socials.entries()) {
    assertLength(social.label, MAX_SOCIAL_LABEL_LENGTH, `socials[${index}].label`)
    assertLength(social.url, MAX_SOCIAL_URL_LENGTH, `socials[${index}].url`)
    const id = resolveSocialNetwork(social.label)
    if (id === null) {
      throw new ConvexError({
        code: "INVALID_SOCIAL_NETWORK",
        field: `socials[${index}].label`,
      })
    }
    if (seen.has(id)) {
      throw new ConvexError({
        code: "DUPLICATE_SOCIAL",
        field: `socials[${index}].label`,
      })
    }
    seen.add(id)
    const url = social.url.trim()
    if (!isSocialHttpUrl(url)) {
      throw new ConvexError({
        code: "INVALID_SOCIAL_URL",
        field: `socials[${index}].url`,
      })
    }
    out.push({ label: id, url })
  }
  return out
}
