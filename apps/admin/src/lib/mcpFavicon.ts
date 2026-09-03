export function faviconCandidates(url: string): string[] {
  try {
    const parsed = new URL(url)
    const candidates = [`${parsed.origin}/favicon.ico`, `${parsed.origin}/apple-touch-icon.png`]
    if (parsed.hostname === "mcp.make.com") {
      candidates.push("https://www.make.com/favicon.ico")
    }
    return candidates
  } catch {
    return []
  }
}
