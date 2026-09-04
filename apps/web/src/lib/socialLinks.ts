import {
  hydrateSocials,
  isSocialHttpUrl,
  socialLabel,
} from "@astrotan/backend/convex/lib/socialNetworks"

export function visibleSocials(
  rows: readonly { label: string; url: string }[],
) {
  return hydrateSocials(rows)
    .filter((row) => isSocialHttpUrl(row.url))
    .map((row) => ({
      id: row.id,
      label: socialLabel(row.id),
      url: row.url.trim(),
      icon: `social:${row.id}` as const,
    }))
}
