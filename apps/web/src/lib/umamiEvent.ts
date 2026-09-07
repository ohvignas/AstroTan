// Events nommés pour le script Umami déjà chargé sans consentement
// (`analyticsScripts` : pas de cookie, pas d'identifiant). Ce n'est pas
// un nouveau traceur — seulement `window.umami.track` s'il existe.

export type UmamiHost = {
  umami?: { track?: (name: string, data?: Record<string, string | number | boolean>) => void }
}

export function umamiEventForHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  let path: string
  try {
    path = href.startsWith("http://") || href.startsWith("https://")
      ? new URL(href).pathname
      : href.split("?")[0]
  } catch {
    return undefined
  }
  if (path === "/contact") return "cta-contact"
  if (path === "/tarifs") return "cta-tarifs"
  if (path === "/acheter") return "checkout-start"
  if (path === "/OhVignas/AstroTan" || href.includes("github.com/OhVignas/AstroTan")) {
    return "cta-clone"
  }
  return undefined
}

export function trackUmamiEvent(
  name: string,
  data?: Record<string, string | number | boolean>,
  host: UmamiHost = globalThis as UmamiHost,
): void {
  host.umami?.track?.(name, data)
}
