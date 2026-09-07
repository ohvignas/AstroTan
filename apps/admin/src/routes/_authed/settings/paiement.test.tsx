import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

test("l'écran paiement pose la route et n'écrit pas la clé", () => {
  const source = readFileSync(join(import.meta.dirname, "paiement.tsx"), "utf8")
  expect(source).toContain('createFileRoute("/_authed/settings/paiement")')
  expect(source).toContain("SectionPaiementStripe")
  expect(source).not.toContain("sk_live")
  expect(source).not.toContain("whsec")
})
