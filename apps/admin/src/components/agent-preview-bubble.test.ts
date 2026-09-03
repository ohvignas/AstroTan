import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-preview-bubble.tsx"),
  "utf8",
)
const chatDir = join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/components/chat")
const widget = readFileSync(join(chatDir, "ChatWidget.tsx"), "utf8")
const panel = readFileSync(join(chatDir, "ChatPanel.tsx"), "utf8")

describe("aperçu admin — chrome shadcn", () => {
  test("importe le ChatWidget unique, sans useChat démo", () => {
    expect(source).toContain("ChatWidget")
    expect(source).toContain('placement="preview"')
    expect(source).toContain("previewStart")
    expect(source).toContain("previewSend")
    expect(source).not.toContain("ChatPanel")
    expect(source).not.toContain("useChat")
    expect(source).not.toContain("createChat")
    expect(source).not.toContain("Deep Research")
  })

  test("reste un aperçu sans lead ni pastille, FAB pour prévisualiser le teaser", () => {
    expect(source).toContain("previewStart")
    expect(source).toContain("previewSend")
    expect(source).toContain("showFab={true}")
    expect(source).toContain("color={")
    expect(source).toContain("teaser={")
    expect(source).toContain("agentName={")
    expect(source).not.toContain("badge")
    expect(source).not.toContain("Aperçu")
    expect(source).not.toContain("aucun lead")
    expect(source).not.toContain("startChat")
    expect(source).not.toContain("/api/chat")
    expect(source).not.toContain("ChatEmailCard")
    expect(source).not.toContain("attachChatEmail")
    expect(source).toContain("pending={pending}")
    expect(source).toContain("STREAM_TEXT_TIMEOUT_MS")
    expect(source).toContain("STREAM_FALLBACK_ID")
    expect(source).toContain("fallbackIfReplyTimedOut")
    expect(source).toContain("sendGen")
    expect(source).toContain("armFallback")
  })

  test("l'ouverture est contrôlée par la page, pas un état interne", () => {
    expect(source).toContain("open,")
    expect(source).toContain("onOpenChange")
    expect(source).toContain("open={open}")
    expect(source).toContain("onOpenChange={onOpenChange}")
    expect(source).not.toContain("useState(true)")
    expect(source).not.toMatch(/const \[open,\s*setOpen\]/)
  })

  test("placement aperçu hors de la SaveBar, chrome dans ChatWidget", () => {
    expect(source).toContain('placement="preview"')
    expect(source).not.toContain("bottom-4")
    expect(source).not.toContain("z-50")
    expect(widget).toContain("bottom-20")
    expect(widget).toContain("z-10")
    expect(widget).toContain("max-w-sm")
    expect(panel).toContain("h-140")
    expect(panel).toContain("border border-border")
    expect(panel).toContain('aria-label="Fermer"')
    expect(panel).toContain("Déplacer l'aperçu")
  })
})
