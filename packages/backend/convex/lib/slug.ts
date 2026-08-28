// Everything that turns text into a URL segment, in one module.
//
// There are two jobs here, and conflating them is the bug this file exists
// to prevent:
//
//   `normalizeSlug` cleans a path an operator *typed*. They chose
//   `mon-offre`; it only strips the surrounding slashes and whitespace, and
//   deliberately preserves case and everything else — a page's slug is the
//   operator's decision, not ours to rewrite.
//
//   `slugify` *derives* a URL segment from a display name nobody typed as
//   a path. A tag named "Astro" and a tag named "astro" have to collide,
//   so this one lowercases, folds accents, and collapses everything else
//   to hyphens.
//
// They lived apart at first, which is how "Astro" and "astro" could have
// become two tags pointing at two different URLs listing the same posts.

/**
 * Clean a path an operator typed. Preserves case: `pages.slug` is chosen,
 * not derived.
 */
export function normalizeSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").replace(/\/+$/, "")
}

/**
 * Derive a URL segment from a display name.
 *
 * Accent folding runs through `normalize("NFD")`, which splits a letter
 * into its base plus a combining mark, so stripping the marks leaves the
 * base letter — "Référencement" becomes "referencement" rather than losing
 * the character entirely.
 *
 * Returns `""` for input with nothing usable in it (only punctuation, only
 * emoji). Callers must treat that as invalid rather than storing it: an
 * empty slug is a URL that collides with every other empty slug.
 */
export function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    // Anything that is not a letter, a digit or a hyphen becomes a hyphen,
    // then runs of hyphens collapse and the edges are trimmed — so
    // "  L'IA & le No-Code !  " lands on "l-ia-le-no-code".
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
