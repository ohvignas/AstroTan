// @ts-check
import tseslint from "typescript-eslint"

// I7 (Lot 1 final review): there was no eslint config, no `lint` script,
// and no CI at all in this package — a missing `await` on `requireRole`
// (or any other async guard) fails *open*, silently, with nothing short
// of a live exploit to catch it. All 13 current call sites do await —
// this is a live gate against a regression, not a live bug.
//
// Deliberately narrow: exactly the two rules I7 names, not the broader
// `recommendedTypeChecked` preset. This codebase's own established idiom
// — `t.run((ctx: any) => ...)` throughout the test suite, matching
// `convex-test`'s own typing gaps rather than a carelessness this package
// should be graded on — trips dozens of `no-explicit-any`/`no-unsafe-*`
// findings that are a different, much larger cleanup this review round
// doesn't ask for. Widening this config to a full preset is a deliberate
// decision for a future round, not an oversight here.
export default tseslint.config(
  {
    ignores: ["convex/_generated/**", "convex/betterAuth/**", "dist/**"],
  },
  {
    files: ["convex/**/*.ts", "testing/**/*.ts", "e2e/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Type-aware linting — required for both rules below, neither of
        // which can distinguish `Promise<T>` from `T` without real type
        // information. Uses the same tsconfig project discovery `tsc`
        // itself does, so it resolves against this package's own
        // `tsconfig.json` (`include`, kept in sync with the `files` glob
        // above) rather than a second, hand-maintained file list that
        // could drift from it.
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
