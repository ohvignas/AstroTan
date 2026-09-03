export const OAUTH_POPUP_MESSAGE_TYPE = "astrotan-google-calendar" as const

export type OAuthPopupMessage = { type: typeof OAUTH_POPUP_MESSAGE_TYPE; ok: boolean }

export function isOAuthPopupMessage(data: unknown): data is OAuthPopupMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === OAUTH_POPUP_MESSAGE_TYPE &&
    "ok" in data &&
    typeof data.ok === "boolean"
  )
}

export function openOAuthPopup(url: string): Window | null {
  return window.open(url, "astrotan-google-calendar", "popup=yes,width=480,height=720")
}

export function listenOAuthPopup(onResult: (ok: boolean) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (!isOAuthPopupMessage(event.data)) return
    onResult(event.data.ok)
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}

export function launchGoogleOAuth(
  url: string,
  onResult: (ok: boolean) => void,
): void {
  const popup = openOAuthPopup(url)
  if (popup === null) {
    window.location.assign(url)
    return
  }
  const stop = listenOAuthPopup((ok) => {
    stop()
    onResult(ok)
  })
}
