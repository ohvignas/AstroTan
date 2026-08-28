import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Whole-lot review, the status-badge finding: "no test infrastructure in
// apps/admin" was a description, not a reason to leave the DoD line
// "propagation failure is visible in the interface" uncovered —
// `PublicationStatusBadge` (`src/components/PublicationStatusBadge.tsx`)
// is a pure five-branch function and its *entire* implementation. This is
// the minimum that unblocks testing it: a dedicated `vitest.config.ts`
// (not the app's own `vite.config.ts`, which pulls in the TanStack Start
// plugin and its own dev-server wiring — none of that is needed to render
// one component function) with just React's Vite plugin (for JSX) and the
// same `@/*` alias `tsconfig.json` already declares, so a test can import
// through it exactly like app code does.
//
// `environment: "node"`, not `jsdom`: `PublicationStatusBadge.test.tsx`
// renders with `react-dom/server`'s `renderToStaticMarkup` and asserts on
// the resulting HTML string — no DOM APIs, no `@testing-library/react`,
// no extra dependency beyond `vitest` and the React plugin this app
// already has. If a future test genuinely needs interaction (clicks,
// state updates across renders) rather than a one-shot render assertion,
// that's the point to add `jsdom` + Testing Library — not before.
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: { "@": path.resolve(dirname, "./src") },
  },
  test: {
    environment: "node",
  },
})
