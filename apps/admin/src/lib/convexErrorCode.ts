/**
 * Code d'une ConvexError, y compris quand le client Convex l'enveloppe
 * dans un Error dont le message contient `{"code":"…"}`.
 */
export function codeErreurConvex(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data
    if (typeof data === "object" && data !== null && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string") return code
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(/"code"\s*:\s*"([A-Z_]+)"/)
    return match?.[1]
  }
  return undefined
}
