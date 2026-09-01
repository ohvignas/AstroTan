// @ts-check
import eslintPluginAstro from "eslint-plugin-astro"
import tseslint from "typescript-eslint"

// Lot 2, Tasks 5/6: `apps/web` had no `eslint.config.js` and no `lint`
// script at all — the one workspace `pnpm lint` (and therefore CI) never
// covered. `eslint-plugin-astro`'s own `flat/recommended` config (spread
// below) handles `.astro`-specific correctness — unused CSS selectors,
// invalid directives, duplicate `set:html`/children, etc. — via its own
// `astro-eslint-parser` wiring for `*.astro` files.
//
// The second config block below adds the same two type-aware rules
// `packages/backend/eslint.config.js` carries, for the same reason
// documented there (I7, Lot 1 final review): a missing `await` fails
// *open*, silently — here that means `getConvexClient().query(...)` in
// `src/lib/blockRegistry.ts`/route code returning an unawaited Promise
// instead of the page data it looks like. Deliberately scoped to plain
// `.ts` files only, not `.astro` frontmatter: `eslint-plugin-astro`'s own
// `astro/base/typescript` config (which lints the frontmatter as a virtual
// `*.astro/*.ts` file) ships with `parserOptions.project: null` —
// type-aware linting turned off by design for that virtual file, because
// wiring a real `tsconfig` project through `astro-eslint-parser`'s virtual
// files is a separate, more involved setup than this task's scope covers.
// `astro check` (the `typecheck` script) still catches most *type* errors
// in `.astro` frontmatter; it does not catch an unawaited Promise the way
// `no-floating-promises` does — a gap worth closing in a follow-up, not
// silently pretended away here.
// M7 (whole-lot review): CLAUDE.md invariant #1 ("`apps/web` n'a ni clé
// admin Convex ni session") and this task's own header comment on
// `previewToken.ts`/`loadPreviewPage.ts` ("apps/web carries no session
// and no admin key at all") were, until this rule, enforced by nothing
// but those comments. `packages/backend/package.json` has no `exports`
// map, so `import { createAuth } from "@astrotan/backend/convex/auth"`
// resolves from `apps/web` today exactly as if it were a documented
// public entry point — nothing stops a future route handler from pulling
// in Better Auth's server instance (and, through it, everything needed to
// mint or read a real admin session) directly into the one app this
// codebase's whole security model depends on staying session-less.
//
// Two independent surfaces, both blocked: the `better-auth`/
// `@convex-dev/better-auth` packages themselves (nothing in `apps/web`'s
// own `package.json` dependencies needs them — the deep-import path is
// the only way they'd ever reach this app), and the backend's own auth
// modules by path (`convex/auth*`, `convex/betterAuth/*`) — the specific
// files those packages are wired into. Deliberately *not* blocking
// `@astrotan/backend/convex/lib/previewToken` or `@astrotan/backend/convex/blocks`
// et al.: those are the legitimate, session-free surface `apps/web`
// already depends on (`loadPreviewPage.ts`, `blockRegistry.ts`) — this
// rule's whole point is narrowing what's reachable, not cutting the
// workspace dependency off entirely.
const NO_SESSION_MESSAGE =
  "apps/web carries no Better Auth session (CLAUDE.md invariant #1) — this belongs in apps/admin or packages/backend only."

const NO_AUTH_IMPORT_PATHS = [
  { name: "better-auth", message: NO_SESSION_MESSAGE },
  { name: "@convex-dev/better-auth", message: NO_SESSION_MESSAGE },
]

const NO_AUTH_IMPORT_PATTERNS = [
  {
    group: [
      "better-auth/*",
      "@convex-dev/better-auth/*",
      "@astrotan/backend/convex/auth",
      "@astrotan/backend/convex/auth.*",
      "@astrotan/backend/convex/betterAuth/*",
    ],
    message: NO_SESSION_MESSAGE,
  },
]

// The `["error", { paths, patterns }]` tuple itself is written directly
// inside each `rules: {}` object below, not factored into one shared
// `const` spread into both — under `// @ts-check`, a standalone const
// widens to a plain (mutable-incompatible or over-widened) array type
// that no longer satisfies ESLint's `RuleEntry` once spread into `rules`,
// which `astro check` (this app's own `typecheck` script) caught. Only
// the two option objects above (`paths`/`patterns`, which aren't
// positional tuple elements) are safe to share.

export default tseslint.config(
  {
    ignores: [".astro/**", "dist/**"],
  },
  ...eslintPluginAstro.configs["flat/recommended"],
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-restricted-imports": ["error", { paths: NO_AUTH_IMPORT_PATHS, patterns: NO_AUTH_IMPORT_PATTERNS }],
    },
  },
  {
    files: ["src/**/*.astro"],
    rules: {
      "no-restricted-imports": ["error", { paths: NO_AUTH_IMPORT_PATHS, patterns: NO_AUTH_IMPORT_PATTERNS }],
    },
  },
)
