// Template-wide constants with no Convex-backed source yet. Design spec
// §4 lists a `settings` table (`siteName`, `defaultSeo`, `socials`,
// `logoId`) as the eventual home for this — no task in this lot creates
// it (same gap `blocks.ts` documents for `mediaId`/`mediaIds`: "revisit
// once a `media` table exists"). Until then, this is the one place a
// template adopter changes the organization name that appears in the
// global `Organization` JSON-LD every page renders (design spec §6.5).
export const SITE_NAME = "AstroTan"
