import { marked } from "marked"
import sanitizeHtml from "sanitize-html"

// A page's body is Markdown written through the dashboard — by an operator
// or, increasingly, by an agent editing the page's copy. It is never taken
// from an anonymous visitor, and it is still sanitised here, at the last
// point before output, for the same reason the retired richText block was:
//
//   - Markdown permits raw HTML by design. `<script>alert(1)</script>` in
//     the body is passed through by every Markdown parser, faithfully. So
//     "it's only Markdown" is not a safety property.
//   - A single compromised editor session, or a block of markup pasted in
//     from an untrusted page, would otherwise become stored XSS against
//     every visitor — reached through a boundary that has nothing to do
//     with authentication.
//   - Stripping all markup instead would defeat the field's purpose: it
//     exists to carry real formatted copy.
//
// Order is load-bearing: render first, sanitise second. Sanitising the
// Markdown *source* would leave the parser free to emit whatever the
// source's raw-HTML passthrough contained afterwards.

const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li",
  "a", "img",
  "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td",
  "span", "div",
]

/**
 * Render a page body to HTML that is safe to inject with `set:html`.
 *
 * `sanitize-html` runs an allowlist: ordinary prose tags and attributes
 * pass, while `<script>`, inline event handlers (`onclick`, …), `style`
 * attributes, `javascript:`/`data:` URLs, iframes, and anything else not
 * listed are dropped silently, by design.
 */
export function renderMarkdown(body: string): string {
  // `async: false` pins the synchronous overload — `marked.parse` returns
  // `string | Promise<string>` otherwise, and an accidentally-awaited
  // `[object Promise]` would land in the page as text.
  const html = marked.parse(body, { async: false })

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading"],
      // Markdown fenced code blocks carry the language as a class
      // (`language-ts`), which is what a highlighter keys off.
      code: ["class"],
      "*": ["class"],
    },
    // Blocks `javascript:`/`data:`/`vbscript:` hrefs and srcs — an allowed
    // `<a>`/`<img>` with a disallowed scheme is the same attack through a
    // different door.
    // Same set the navigation links accept (`assertSafeHref`), so a phone
    // or mail link behaves identically whether it sits in a page's body or
    // in the site header.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
  })
}

/**
 * A plain-text excerpt of a Markdown body, for meta descriptions and the
 * GEO summary's fallback. Renders then strips every tag rather than
 * regex-ing the Markdown source — that way link text survives and link
 * URLs don't, which is what a description wants.
 */
export function markdownToPlainText(body: string, maxLength = 200): string {
  const text = sanitizeHtml(marked.parse(body, { async: false }), {
    allowedTags: [],
    allowedAttributes: {},
  })
    // Collapse the whitespace the tag-stripping leaves behind, and decode
    // the entities `sanitize-html` emits for bare `&` and quotes.
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

  if (text.length <= maxLength) return text
  // Cut on a word boundary rather than mid-word, then add the ellipsis.
  const cut = text.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Render a declared "rich" content field: inline markup only.
 *
 * `marked.parseInline` never emits block elements, so a stray `# ` or a
 * blank line in the field cannot break out of the heading or the button it
 * sits inside — which is the whole reason this is a separate function from
 * `renderMarkdown` rather than the same one with a narrower allowlist. The
 * sanitiser then keeps only the four tags that make sense mid-sentence.
 */
export function renderInline(text: string): string {
  return sanitizeHtml(marked.parseInline(text, { async: false }), {
    allowedTags: ["strong", "b", "em", "i", "a", "br"],
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
  })
}
