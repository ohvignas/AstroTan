import { expect, test } from "vitest"
import source from "./api-token-card.tsx?raw"
import { maskApiToken } from "./api-token-card"

test("lien Swagger et snippet MCP, sans secret commité", () => {
  expect(source).toMatch(/api\/v1\/docs/)
  expect(source).toMatch(/ASTROTAN_API_TOKEN/)
  expect(source).toMatch(/mcpSnippet/)
  expect(source).not.toMatch(/[0-9a-f]{64}/)
})

test("le HMAC du webhook n'est pas ici", () => {
  expect(source).not.toMatch(/x-astrotan-signature/)
})

test("après départ, masque + 3 derniers, plus seulement l'empreinte", () => {
  expect(maskApiToken("599")).toBe(`${"*".repeat(61)}599`)
  expect(maskApiToken(null)).toBe("*".repeat(64))
  expect(source).toMatch(/tabular-nums/)
  expect(source).toMatch(/3 derniers/)
  expect(source).not.toMatch(/seulement son empreinte/)
})

test("snippet MCP sans Cursor, copie à l'intérieur du bloc", () => {
  expect(source).toMatch(/Snippet MCP/)
  expect(source).not.toMatch(/Cursor/)
  expect(source).toMatch(/Claude, ChatGPT/)
  expect(source).toMatch(/CopyButton/)
  expect(source).toMatch(/absolute top-1\.5 right-1\.5/)
  expect(source).toMatch(/className="relative"/)
  expect(source).toMatch(/jamais commité/)
})
