/**
 * Which identity image becomes the dashboard favicon, and which href to
 * put on `<link rel="icon">` before / after Convex answers.
 *
 * The public `settings.get` already exposes `iconId` / `logoId` without
 * secrets. The dashboard only uses the square icon. The wide logo is
 * never a favicon here — an empty `iconId` keeps the bundled mark so
 * the first paint, and a clone that never set an icon, still have one.
 */

export function pickIdentityStorageId(
  settings:
    | { iconId?: string | null; logoId?: string | null }
    | null
    | undefined
): string | null {
  return settings?.iconId || null
}

export function identityFaviconHref({
  remoteUrl,
  fallbackHref,
}: {
  remoteUrl: string | null | undefined
  fallbackHref: string
}): string {
  return remoteUrl ?? fallbackHref
}
