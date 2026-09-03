import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { LeadSourceIcon } from "./lead-source-icon"
import source from "./lead-source-icon.tsx?raw"

describe("LeadSourceIcon", () => {
  test("Bot pour le chat, Mail pour le formulaire, libellés français visibles", () => {
    expect(source).toContain("BotIcon")
    expect(source).toContain("MailIcon")
    expect(source).toContain("Vient du chatbot")
    expect(source).toContain("Vient du formulaire")
    expect(source).not.toContain("text-muted-foreground")
    expect(source).toContain("size-4")
    expect(source).toContain("size-6")
    expect(source).toContain("stroke-[2]")
  })

  test("le HTML de la carte porte l'icône et le aria-label", () => {
    const chat = renderToStaticMarkup(LeadSourceIcon({ source: "chat" }))
    const form = renderToStaticMarkup(LeadSourceIcon({ source: "contact" }))
    expect(chat).toContain('aria-label="Vient du chatbot"')
    expect(form).toContain('aria-label="Vient du formulaire"')
    expect(chat).toMatch(/<svg/)
    expect(form).toMatch(/<svg/)
  })
})
