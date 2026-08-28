import { marked } from "marked"
import { internalMutation } from "./_generated/server"

/**
 * Convert every article body from Markdown to HTML, once.
 *
 * `posts.body` used to hold Markdown, on a constraint that turned out to be
 * the wrong one: it was imposed so an agent could read a *page*'s copy, and
 * pages now hold no content at all. For an article a human writes by hand,
 * it bought nothing and cost the WYSIWYG editor — every rich editor loses
 * data converting its own document model back to Markdown.
 *
 * Storing HTML removes the conversion entirely, and changes nothing for
 * search engines: what a crawler reads is the rendered `<h2>`, `<p>`, `<a>`,
 * which are identical either way. The public site sanitises before serving,
 * so this widens nothing.
 *
 * Markdown to HTML is the direction that does not lose: every Markdown
 * construct has an HTML form, which is what Markdown is for.
 *
 * Idempotent by a cheap heuristic — a body already starting with a block
 * tag is left alone — so re-running cannot double-convert. Deleted once it
 * has run, like every migration here.
 */
export const markdownBodiesToHtml = internalMutation({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").collect()
    let converted = 0
    let skipped = 0

    for (const post of posts) {
      if (post.body.trim().length === 0) {
        skipped++
        continue
      }
      // Already HTML: a body whose first non-space character opens a block
      // tag did not come from the Markdown era. Crude, and safe in the
      // direction that matters — a false "already HTML" leaves a body
      // untouched, which the editor fixes on first save; a false
      // "still Markdown" would double-escape real content.
      if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre|figure|div)\b/i.test(post.body)) {
        skipped++
        continue
      }
      await ctx.db.patch(post._id, {
        body: marked.parse(post.body, { async: false }),
      })
      converted++
    }

    return { converted, skipped, total: posts.length }
  },
})
