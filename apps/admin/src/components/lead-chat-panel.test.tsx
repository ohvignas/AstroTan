import { describe, expect, test } from "vitest"
import source from "./lead-chat-panel.tsx?raw"

describe("panneau de chat d'une fiche", () => {
  test("s'abonne au fil staff et au handover", () => {
    expect(source).toContain("useUIMessages")
    expect(source).toContain("api.chatStaff.listStaffMessages")
    expect(source).toContain("api.chatStaff.takeOver")
    expect(source).toContain("api.chatStaff.releaseToAi")
    expect(source).toContain("api.chatStaff.staffReply")
    expect(source).toContain("api.chatStaff.generateUploadUrl")
    expect(source).toContain("LeadChatComposer")
    expect(source).toContain("api.chatStaff.staffHeartbeat")
    expect(source).toContain("api.chatStaff.presence")
    expect(source).not.toMatch(/@tanstack\/react-query/)
    expect(source).not.toMatch(/\buseQuery\b.*from ["']@tanstack/)
  })

  test("libellés français de présence et de relais", () => {
    expect(source).toContain("Prendre la main")
    expect(source).toContain("Rendre à l'assistant")
    expect(source).toContain("visitorPresenceLabel")
    expect(source).toContain("staffChatBubbles")
    expect(source).toContain("LeadChatMedia")
    expect(source).not.toContain("Visiteur en ligne")
    expect(source).not.toContain("Conseiller en ligne")
    expect(source).toContain("LeadChatComposer")
  })

  test("chaque bulle porte son SmoothText, pas le parent", () => {
    expect(source).toContain("function StaffMessageBubble")
    expect(source).toContain("<SmoothText")
    expect(source).toContain("<StaffMessageBubble")
    expect(source).not.toContain("SmoothText(")
    expect(source).not.toContain("useSmoothText")
  })

  test("le fil scrolle en bas à l'envoi, sur le même <ol>", () => {
    expect(source).toContain("scrollElementToEnd")
    expect(source).toContain("listRef")
    expect(source).toContain("requestAnimationFrame")
    expect(source).toContain("setOptimistic")
    expect(source).not.toContain("scrollIntoView")
  })
})
