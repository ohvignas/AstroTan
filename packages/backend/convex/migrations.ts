import { internalMutation } from "./_generated/server"

// The retired block shapes, declared here and nowhere else: the module
// that used to own them is gone, and this is the only code left that has
// to understand them. Narrow rather than exhaustive — every field this
// migration actually reads, nothing more.
type RetiredBlock =
  | { type: "hero"; title: string; subtitle?: string; mediaId?: string; cta?: { label: string; href: string } }
  | { type: "richText"; html: string }
  | { type: "features"; items: { title: string; body: string }[] }
  | { type: "gallery"; mediaIds: string[] }
  | { type: "faq"; items: { question: string; answer: string }[] }
  | { type: "cta"; title: string; cta: { label: string; href: string } }

// One-shot data migrations. Every function here is an `internalMutation` —
// never callable from a client — and every one is expected to be safe to
// run twice: a migration that has to be run exactly once is a migration
// that will eventually be run zero times or three times.

/**
 * Turn a retired block into the Markdown that replaces it.
 *
 * Lossy by construction, and deliberately so: blocks carried layout intent
 * (a hero, a gallery grid) that Markdown has no way to express, and this
 * template's pivot is precisely that layout belongs in the codebase rather
 * than in the database. What must NOT be lost is the *text* an operator
 * typed, so every text-bearing field lands somewhere a human can see it —
 * including gallery images, which become an explicit note rather than
 * disappearing silently.
 */
function blockToMarkdown(block: RetiredBlock): string {
  switch (block.type) {
    case "hero": {
      const parts = [`# ${block.title}`]
      if (block.subtitle) parts.push(block.subtitle)
      if (block.cta) parts.push(`[${block.cta.label}](${block.cta.href})`)
      if (block.mediaId) parts.push(`<!-- image de couverture : ${block.mediaId} -->`)
      return parts.join("\n\n")
    }
    case "richText":
      // Markdown permits inline HTML, so this passes through untouched.
      // It is still sanitised at render time, exactly as it was before.
      return block.html
    case "features":
      return block.items
        .map((item) => `## ${item.title}\n\n${item.body}`)
        .join("\n\n")
    case "gallery":
      // No URL to point at — `_storage` ids are not addresses. A visible
      // note beats a silent deletion: whoever reads this page in the
      // editor can see that images were attached and re-add them.
      return block.mediaIds.length > 0
        ? `<!-- galerie (images à replacer) : ${block.mediaIds.join(", ")} -->`
        : ""
    case "faq":
      return block.items
        .map((item) => `## ${item.question}\n\n${item.answer}`)
        .join("\n\n")
    case "cta":
      return `## ${block.title}\n\n[${block.cta.label}](${block.cta.href})`
  }
}

/**
 * Fill `pages.body` from the retired `pages.blocks`, then clear `blocks`.
 *
 * Idempotent: a page that already has a `body` is left alone, so re-running
 * this cannot overwrite text someone has edited since. Returns counts
 * rather than logging, so the operator running it sees what happened.
 */
export const blocksToMarkdown = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db.query("pages").collect()
    let migrated = 0
    let skipped = 0

    for (const page of pages) {
      if (page.body !== undefined) {
        skipped++
        continue
      }
      const body = ((page.blocks ?? []) as RetiredBlock[])
        .map(blockToMarkdown)
        .filter((chunk) => chunk.length > 0)
        .join("\n\n")
      await ctx.db.patch(page._id, { body, blocks: undefined })
      migrated++
    }

    return { migrated, skipped, total: pages.length }
  },
})
