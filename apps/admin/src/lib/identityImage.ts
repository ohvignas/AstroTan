/**
 * Which media row Identité should show — and, when the template preview
 * is already a library file, which storageId to persist as `iconId`.
 *
 * `settings.iconId` / `logoId` point at `_storage`, not at a `media` row.
 * The bundled preview (`icon_astrotan.png`) can look assigned while the
 * field is still empty: the same file sits in the library, captions and
 * `MEDIA_IS_IDENTITY` never attach. Resolving that row — never creating a
 * second file — is what closes the gap.
 */

export const TEMPLATE_ICON_FILENAME = "icon_astrotan.png"
export const TEMPLATE_LOGO_FILENAME = "logo_astrotan.png"

export type IdentityMediaRow = {
  storageId: string
  filename: string
  alt: string
}

export function resolveIdentityMedia({
  assignedId,
  media,
  templateFilename,
}: {
  assignedId: string | null | undefined
  media: readonly IdentityMediaRow[] | null | undefined
  templateFilename: string
}): IdentityMediaRow | null {
  if (!media) return null
  if (assignedId) {
    return media.find((row) => row.storageId === assignedId) ?? null
  }
  return media.find((row) => row.filename === templateFilename) ?? null
}

/**
 * storageId to write when Identité already shows the template image and
 * that exact file is in the library. Null if something is already assigned
 * or the template is not in the library — keep the bundled preview then.
 */
export function templateIdentityToAssign({
  assignedId,
  media,
  templateFilename,
}: {
  assignedId: string | null | undefined
  media: readonly IdentityMediaRow[] | null | undefined
  templateFilename: string
}): string | null {
  if (assignedId) return null
  return (
    resolveIdentityMedia({ assignedId: null, media, templateFilename })
      ?.storageId ?? null
  )
}
