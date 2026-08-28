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
export default tseslint.config(
  {
    ignores: [".astro/**", "dist/**"],
  },
  ...eslintPluginAstro.configs["flat/recommended"],
  {
    files: ["src/**/*.ts"],
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
    },
  },
)
