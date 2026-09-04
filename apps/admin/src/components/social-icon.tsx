import { SOCIAL_ICONS } from "@astrotan/backend/convex/lib/socialIcons"
import type { SocialNetworkId } from "@astrotan/backend/convex/lib/socialNetworks"
import { cn } from "@/lib/utils"

export function SocialIcon({
  id,
  className,
}: {
  id: SocialNetworkId
  className?: string
}) {
  const icon = SOCIAL_ICONS[id]
  const filled = icon.variant === "fill"
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      className={cn("size-4 shrink-0", className)}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : 2}
      strokeLinecap={filled ? undefined : "round"}
      strokeLinejoin={filled ? undefined : "round"}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.paths }}
    />
  )
}
