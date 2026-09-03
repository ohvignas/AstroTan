import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-identity-fields.tsx"),
  "utf8",
)

describe("identité de l'agent — apparence", () => {
  test("couleur du chat : picker, saisie hex, pastille", () => {
    expect(source).toContain("Couleur du chat")
    expect(source).toContain('type="color"')
    expect(source).toContain("agent-chat-color")
    expect(source).toContain("agentChatColor")
    expect(source).toContain("MAX_AGENT_CHAT_COLOR")
    expect(source).toContain("DEFAULT_AGENT_CHAT_COLOR")
  })

  test("teaser : champ court, hors conversation", () => {
    expect(source).toContain("Message à côté de la bulle")
    expect(source).toContain("agent-teaser")
    expect(source).toContain("agentTeaser")
    expect(source).toContain("MAX_AGENT_TEASER")
    expect(source).toMatch(/à côté du bouton|pas dans la conversation/)
  })
})
