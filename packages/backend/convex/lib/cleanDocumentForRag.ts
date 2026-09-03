export const MIN_RAG_PAGE_CHARS = 40

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g
const PAGE_NUMBER_LINE =
  /^\s*(?:page\s+\d+(?:\s*(?:sur|of|\/)\s*\d+)?|\d+\s*\/\s*\d+)\s*$/i
const CHROME_TAGS = "script|style|nav|footer|header|noscript|template|dialog|svg"

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function innerOf(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"))
  return match?.[1] ?? null
}

function stripChrome(html: string): string {
  return html.replace(
    new RegExp(`<(${CHROME_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, "gi"),
    "\n",
  )
}

function plainInner(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function majorityRepeat(values: string[]): string | null {
  if (values.length < 2) return null
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value.length < 2 || value.length > 80) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  for (const [key, n] of counts) {
    if (n >= 2) return key
  }
  return null
}

function dropRepeatedPdfChrome(text: string): string {
  if (!text.includes("\f")) return text
  const pages = text.split("\f")
  if (pages.length < 2) return text
  const firsts: string[] = []
  const lasts: string[] = []
  for (const page of pages) {
    const lines = page.split("\n").map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) continue
    firsts.push(lines[0]!)
    if (lines.length > 1) lasts.push(lines[lines.length - 1]!)
  }
  const drop = new Set<string>()
  const header = majorityRepeat(firsts)
  const footer = majorityRepeat(lasts)
  if (header) drop.add(header)
  if (footer) drop.add(footer)
  return pages
    .map((page) =>
      page
        .split("\n")
        .filter((line) => !drop.has(line.trim()))
        .join("\n"),
    )
    .join("\n")
}

export function cleanDocumentForRag(text: string): string {
  let cleaned = dropRepeatedPdfChrome(text).replace(/\r\n|\r/g, "\n").replace(/\f/g, "\n")
  cleaned = cleaned.replace(CONTROL_CHARS, "")
  cleaned = cleaned
    .split("\n")
    .filter((line) => !PAGE_NUMBER_LINE.test(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
  return cleaned.trim()
}

export function htmlToMainMarkdown(html: string): string {
  let region = innerOf(html, "main") ?? innerOf(html, "article") ?? innerOf(html, "body") ?? html
  region = stripChrome(region.replace(/<!--[\s\S]*?-->/g, " "))
  region = region.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const title = plainInner(inner)
    return title ? `\n\n${"#".repeat(Number(level))} ${title}\n\n` : "\n\n"
  })
  region = region.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    const item = plainInner(inner)
    return item ? `\n- ${item}` : ""
  })
  region = region.replace(/<br\s*\/?>/gi, "\n")
  region = region.replace(/<\/(?:p|div|section|blockquote|tr|ul|ol)>/gi, "\n\n")
  region = region.replace(/<[^>]+>/g, " ")
  region = decodeEntities(region)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
  return cleanDocumentForRag(region)
}

export function isTooShortForRag(text: string, min = MIN_RAG_PAGE_CHARS): boolean {
  return text.trim().length < min
}

export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text)
}

export function prepareRagText(raw: string, kind: "markdown" | "html" | "auto" = "auto"): string {
  if (kind === "html" || (kind === "auto" && looksLikeHtml(raw))) {
    return htmlToMainMarkdown(raw)
  }
  return cleanDocumentForRag(raw)
}
