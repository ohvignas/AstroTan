import { useEffect } from "react"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  identityFaviconHref,
  pickIdentityStorageId,
} from "@/lib/identityFavicon"

const ICON_RELS = ["icon", "apple-touch-icon"] as const

/**
 * Swap the dashboard favicon onto the site's identity icon once
 * `settings.get` answers. The static fallback stays in `<head>` for
 * the first paint and for a clone that has never set `iconId`. The
 * wide logo is never used as a tab mark.
 *
 * `settings.get` is the public projection — no secrets, so this can
 * run on `/login` as well as behind the session.
 */
export function IdentityFavicon({ fallbackHref }: { fallbackHref: string }) {
  const settings = useQuery(api.settings.get)
  const storageId = pickIdentityStorageId(settings)
  const remoteUrl = useQuery(
    api.media.publicUrl,
    storageId === null ? "skip" : { storageId: storageId as Id<"_storage"> }
  )
  const href = identityFaviconHref({
    remoteUrl: settings === undefined ? undefined : remoteUrl,
    fallbackHref,
  })

  useEffect(() => {
    for (const rel of ICON_RELS) {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
      if (!link) {
        link = document.createElement("link")
        link.rel = rel
        document.head.appendChild(link)
      }
      if (link.getAttribute("href") !== href) {
        link.setAttribute("href", href)
      }
    }
  }, [href])

  return null
}
