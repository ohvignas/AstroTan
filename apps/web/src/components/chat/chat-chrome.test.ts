import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { MessageScrollerProvider } from "@/components/ui/message-scroller"
import { ChatPanel } from "./ChatPanel"
import { ChatTranscript } from "./ChatTranscript"
import type { DisplayedMessage } from "./chatWidgetState"

const here = dirname(fileURLToPath(import.meta.url))

function read(name: string) {
  return readFileSync(join(here, name), "utf8")
}

function renderTranscript(messages: DisplayedMessage[], pending = false) {
  return renderToStaticMarkup(
    createElement(
      MessageScrollerProvider,
      { autoScroll: true },
      createElement(ChatTranscript, { messages, pending }),
    ),
  )
}

describe("chrome chat shadcn", () => {
  test("le panel clone la Card de MessageScrollerDemo", () => {
    const source = read("ChatPanel.tsx")
    expect(source).toContain("MessageScrollerProvider")
    expect(source).toContain("h-140")
    expect(source).toContain("max-h-140")
    expect(source).toContain("min-h-0")
    expect(source).toContain("overflow-hidden")
    expect(source).toContain("flex-col")
    expect(source).toContain("gap-1 border-b")
    expect(source).toContain("flex min-h-0 flex-1 flex-col overflow-hidden p-0")
    expect(source).toContain("Nouvelle conversation")
    expect(source).toContain("Un conseiller est en ligne")
    expect(source).toContain("est en ligne")
    expect(source).toContain("presenceSubtitle")
    expect(source).toContain("OnlineDot")
    expect(source).toContain("animate-ping")
    expect(source).toContain("bg-emerald-500")
    expect(source).toContain("motion-reduce:hidden")
    expect(source).toContain("agentName")
    expect(source).not.toContain("est là")
    expect(source).toContain("RotateCwIcon")
    expect(source).toContain('variant="outline"')
    expect(source).toContain('size="icon"')
    expect(source).toContain("MessageCircleDashedIcon")
    expect(source).toContain("EmptyMedia")
    expect(source).toContain("border border-border")
    expect(source).toContain("shadow-md")
    expect(source).toContain("ring-1 ring-foreground/10")
    expect(source).not.toContain("useChat")
    expect(source).not.toContain("createChat")
  })

  test("le sous-titre porte le nom de l'agent, sinon le repli", () => {
    const named = renderToStaticMarkup(
      createElement(ChatPanel, {
        onReset: () => undefined,
        agentName: "Léa",
        children: "x",
      }),
    )
    expect(named).toContain("Léa est en ligne")
    expect(named).not.toContain("Un conseiller est en ligne")
    expect(named).not.toContain("est là")
    expect(named).toContain("animate-ping")
    expect(named).toContain("bg-emerald-500")

    const blank = renderToStaticMarkup(
      createElement(ChatPanel, {
        onReset: () => undefined,
        agentName: "   ",
        children: "x",
      }),
    )
    expect(blank).toContain("Un conseiller est en ligne")
    expect(blank).not.toContain("  est en ligne")
    expect(blank).toContain("animate-ping")
  })

  test("la croix et le reset coexistent, aria-label Fermer", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        onReset: () => undefined,
        onClose: () => undefined,
        children: "x",
      }),
    )
    expect(html).toContain('aria-label="Fermer"')
    expect(html).toContain('aria-label="Réinitialiser la conversation"')
    expect(html).not.toContain("Fermer l'aperçu")
  })

  test("un seul ChatWidget porte le chrome, les deux surfaces l'importent", () => {
    const widget = read("ChatWidget.tsx")
    const thread = read("ChatThread.tsx")
    const preview = readFileSync(
      join(here, "../../../../admin/src/components/agent-preview-bubble.tsx"),
      "utf8",
    )
    expect(widget).toContain("chat-widget-chrome.css")
    expect(widget).toContain("@fontsource-variable/geist")
    expect(widget).toContain("ChatPanel")
    expect(widget).toContain("ChatComposer")
    expect(widget).toContain("ChatTranscript")
    expect(widget).toContain('placement = "site"')
    expect(widget).toContain("bottom-4")
    expect(widget).toContain("z-[45]")
    expect(widget).toContain("bottom-20")
    expect(widget).toContain("z-10")
    expect(widget).toContain("max-w-sm")
    expect(widget).toContain("size-16")
    expect(thread).toContain("ChatWidget")
    expect(thread).toContain('placement="site"')
    expect(thread).toContain("color={")
    expect(thread).toContain("teaser={")
    expect(thread).toContain("unreadCount={unreadCount}")
    expect(thread).toContain("useStaffUnread")
    expect(thread).toContain("agentName={")
    expect(thread).not.toContain("ChatPanel")
    expect(read("ChatBubble.astro")).toContain("chatAppearance")
    expect(read("ChatBubble.astro")).toContain("agentChatColor")
    expect(read("ChatBubble.astro")).toContain("agentTeaser")
    expect(read("ChatBubble.astro")).toContain("agentDisplayName")
    expect(read("ChatBubble.astro")).toContain("agentName")
    expect(read("ChatBubble.astro")).toContain("catch")
    expect(read("ChatBubble.astro")).not.toContain("api.settings.get")
    expect(read("ChatBubble.tsx")).toContain("color={")
    expect(read("ChatBubble.tsx")).toContain("teaser={")
    expect(read("ChatBubble.tsx")).toContain("agentName={")
    expect(preview).toContain("ChatWidget")
    expect(preview).toContain('placement="preview"')
    expect(preview).toContain("showFab={true}")
    expect(preview).toContain("color={")
    expect(preview).toContain("teaser={")
    expect(preview).toContain("agentName={")
    expect(preview).not.toContain("badge")
    expect(preview).not.toContain("ChatPanel")
    expect(preview).not.toContain("ChatComposer")
    expect(preview).not.toContain("ChatTranscript")
    expect(widget).toContain("showFab = true")
    expect(widget).toContain("--chat-accent")
    expect(widget).toContain("visibleChatTeaser")
    expect(widget).toContain("data-slot=\"chat-teaser\"")
    expect(widget).toContain("data-unread")
    expect(widget).toContain("unreadCount")
    expect(widget).toContain("unreadNotice")
    expect(widget).toContain("data-slot=\"chat-unread\"")
    expect(widget).not.toContain("badge")
    expect(read("ChatPanel.tsx")).toContain("onClose")
    expect(read("ChatPanel.tsx")).toContain('aria-label="Fermer"')
    expect(read("ChatPanel.tsx")).toContain("XIcon")
    expect(widget).toContain("onClose={() => onOpenChange(false)}")
    expect(widget).toContain("agentName={agentName}")
  })

  test("l'aperçu admin se déplace et se ferme, le site reste fixé", () => {
    const widget = read("ChatWidget.tsx")
    const panel = read("ChatPanel.tsx")
    expect(widget).toContain("usePreviewDrag")
    expect(widget).toContain('placement === "preview"')
    expect(widget).toMatch(/placement === "preview"[\s\S]*!open/)
    expect(widget).toContain("bottom-20")
    expect(widget).toContain("z-10")
    expect(widget).toContain("bottom-4")
    expect(widget).toContain("z-[45]")
    expect(panel).toContain("Déplacer l'aperçu")
    expect(panel).toContain('aria-label="Fermer"')
    expect(panel).not.toContain("Fermer l'aperçu")
    expect(panel).toContain("cursor-grab")
    expect(panel).toContain("cursor-grabbing")
    expect(panel).toContain("stopPropagation")
    expect(panel).toContain("XIcon")
    expect(widget).not.toContain("cursor-grab")
  })

  test("le fil utilise MessageScroller, pas un overflow maison", () => {
    const source = read("ChatTranscript.tsx")
    expect(source).toContain("MessageScroller")
    expect(source).toContain("MessageScrollerButton")
    expect(source).toContain("h-full min-h-0")
    expect(source).toContain("overflow-y-auto")
    expect(source).toContain("Derniers messages")
    expect(source).toContain("streamingBusyLabel")
    expect(source).toContain("shimmer text-sm text-muted-foreground")
    expect(source).toContain("lastVisibleId")
    expect(source).toContain("scrollToEnd")
    expect(source).toContain("scrollAnchor={!isBusy && message.id === lastVisibleId}")
    expect(source).not.toContain("useStickToBottom")
    expect(source).not.toContain("scrollIntoView")
    expect(source).not.toContain('message.role === "user" ||')
  })

  test("un tool en cours : shimmer Utilisation d'un outil, pas le stream", () => {
    const named = renderTranscript([
      { id: "u1", role: "user", text: "Make ?" },
      {
        id: "a1",
        role: "assistant",
        text: "",
        streaming: true,
        toolCalls: ["Make__scenarios_list"],
      },
    ])
    expect(named).toContain("shimmer text-sm text-muted-foreground")
    expect(named).toContain("scenarios_list")
    expect(named).not.toContain("Réponse en cours…")
    const unnamed = renderTranscript([
      { id: "u1", role: "user", text: "Make ?" },
      {
        id: "a1",
        role: "assistant",
        text: "",
        streaming: true,
        toolCalls: ["outil"],
      },
    ])
    expect(unnamed).toContain("Utilisation d&#x27;un outil…")
    const many = renderTranscript([
      { id: "u1", role: "user", text: "Make ?" },
      {
        id: "a1",
        role: "assistant",
        text: "",
        streaming: true,
        toolCalls: ["a", "b"],
      },
    ])
    expect(many).toContain("Utilisation d&#x27;outils…")
  })

  test("pendant le stream : shimmer seul, le texte assistant n'est pas dans l'arbre", () => {
    const html = renderTranscript([
      { id: "u1", role: "user", text: "Bonjour" },
      { id: "a1", role: "assistant", text: "Réponse partielle", streaming: true },
    ])
    expect(html).toContain("shimmer text-sm text-muted-foreground")
    expect(html).toContain("Réponse en cours…")
    expect(html).toContain("Bonjour")
    expect(html).not.toContain("Réponse partielle")
  })

  test("pending ou assistant vide : shimmer, pas de bulle incomplète", () => {
    const pending = renderTranscript([{ id: "u1", role: "user", text: "Question" }], true)
    expect(pending).toContain("Réponse en cours…")
    expect(pending).toContain("Question")
    const emptyAssistant = renderTranscript([
      { id: "u1", role: "user", text: "Question" },
      { id: "a1", role: "assistant", text: "   " },
    ])
    expect(emptyAssistant).toContain("Réponse en cours…")
    expect(emptyAssistant).toContain("Question")
    expect(emptyAssistant).not.toContain("data-align=\"start\"")
  })

  test("stream terminé : le message complet apparaît d'un coup, plus de shimmer", () => {
    const html = renderTranscript([
      { id: "u1", role: "user", text: "Bonjour" },
      { id: "a1", role: "assistant", text: "Réponse complète" },
    ])
    expect(html).toContain("Réponse complète")
    expect(html).not.toContain("Réponse en cours…")
    expect(html).not.toContain("shimmer text-sm text-muted-foreground")
  })

  test("un assistant Markdown rend gras et listes, sans astérisques visibles", () => {
    const html = renderTranscript([
      { id: "u1", role: "user", text: "Infos ?" },
      {
        id: "a1",
        role: "assistant",
        text: "**Bootcamp**\n\n- **Durée** : 3 jours\n- item",
      },
    ])
    expect(html).toContain("<strong>Bootcamp</strong>")
    expect(html).toContain("<strong>Durée</strong>")
    expect(html).toContain("<li>")
    expect(html).toContain("item")
    expect(html).not.toContain("**Bootcamp**")
    expect(html).not.toContain("- **Durée**")
    expect(html).not.toContain("**Durée**")
    const visible = html.replace(/<[^>]+>/g, " ")
    expect(visible).toContain("Bootcamp")
    expect(visible).toContain("Durée")
    expect(visible).not.toContain("*")
  })

  test("le message visiteur reste du texte, le Markdown n'est pas interprété", () => {
    const html = renderTranscript([{ id: "u1", role: "user", text: "**pas gras**" }])
    expect(html).toContain("**pas gras**")
    expect(html).not.toContain("<strong>pas gras</strong>")
  })

  test("un assistant en stream : le Markdown partiel n'est pas dans l'arbre", () => {
    const html = renderTranscript([
      { id: "u1", role: "user", text: "Infos ?" },
      {
        id: "a1",
        role: "assistant",
        text: "**Boot",
        streaming: true,
      },
    ])
    expect(html).toContain("Réponse en cours…")
    expect(html).not.toContain("Boot")
    expect(html).not.toContain("<strong>")
  })

  test("garde notre API, refuse le transport démo", () => {
    const thread = read("ChatThread.tsx")
    const api = read("chatApi.ts")
    const bubble = read("ChatBubble.tsx")
    expect(thread).toContain("sendChatWithOptionalFile")
    expect(api).toContain("sendChatMessage")
    expect(thread).toContain("startChat")
    expect(thread).toContain("sendingRef")
    expect(thread).toContain("if (sendingRef.current) return")
    expect(api).toContain("startInFlight")
    expect(thread).toContain("useChatPoll(token, onSessionLost, open, pending)")
    expect(thread).toContain("presenceIntervalMs")
    expect(thread).toContain("useDocumentHidden")
    expect(thread).not.toContain("15_000")
    expect(thread).toContain("ChatEmailCard")
    expect(thread).not.toContain("onReset={onSessionLost}")
    expect(thread).toContain("onReset={onReset}")
    expect(thread).not.toMatch(/function onReset[\s\S]*startChat/)
    expect(thread).toContain("isEmptyThread({ messages, pending })")
    expect(thread).not.toContain("current || readEmailGateOpened")
    expect(read("useChatPoll.ts")).toContain("resetPollClient")
    expect(read("useChatPoll.ts")).toContain("tokenBecameEmpty")
    expect(read("useChatPoll.ts")).toContain("setOptimistic(cleared.optimistic)")
    expect(read("useChatPoll.ts")).toContain("pollIntervalMs")
    expect(read("useChatPoll.ts")).toContain("hasSession: true")
    expect(read("useChatPoll.ts")).toContain("visibilitychange")
    expect(read("useChatPoll.ts")).toContain("useQuery")
    expect(read("useChatPoll.ts")).toContain("watchVisitorMessages")
    expect(read("useChatPoll.ts")).toContain(
      'typeof window !== "undefined" && token.length > 0 ? { token } : "skip"',
    )
    expect(read("useChatPoll.ts")).toContain("applyVisitorSnapshot")
    expect(read("ChatBubble.tsx")).toContain("ConvexProvider")
    expect(read("ChatBubble.tsx")).toContain("if (!mounted) return null")
    expect(read("ChatBubble.tsx")).toContain("getConvexReactClient")
    expect(read("ChatBubble.tsx")).toContain("sessionKey={token ?? \"\"}")
    expect(read("ChatBubble.tsx")).not.toMatch(/<ChatQueryBoundary key=/)
    expect(read("ChatBubble.tsx")).toContain("readWidgetOpen")
    expect(read("ChatBubble.tsx")).toContain("writeWidgetOpen")
    expect(read("ChatThread.tsx")).toContain("isEmpty={isEmptyThread({ messages, pending })}")
    expect(read("useChatPoll.ts")).toContain("displayedVisitorMessages")
    expect(api).toContain("/api/chat")
    expect(api).toContain("/api/chat/email")
    expect(thread).not.toMatch(/\buseChat\b/)
    expect(thread).not.toContain("createChat")
    expect(bubble).not.toMatch(/\buseChat\b/)
    expect(bubble).not.toContain("Deep Research")
    expect(bubble).not.toContain("ChatGate")
  })

  test("la carte e-mail est en français et ignore n'appelle pas attach", () => {
    const card = read("ChatEmailCard.tsx")
    expect(card).toContain("Quelle est votre adresse email ?")
    expect(card).toContain("Entrez votre email pour être informé de nos réponses :")
    expect(card).toContain("Entrez votre adresse email...")
    expect(card).toContain("Définir mon email")
    expect(card).toContain("Ignorer")
    expect(card).toContain("attachChatEmail")
    expect(card).toContain("emailCardMessage")
    expect(card).not.toContain("bannerForCode")
    expect(card).toContain("onIgnore")
    expect(card).toContain("chat-email-card-title")
  })

  test("la porte e-mail est un overlay, pas un item du fil", () => {
    const thread = read("ChatThread.tsx")
    const panel = read("ChatPanel.tsx")
    const transcript = read("ChatTranscript.tsx")
    const widget = read("ChatWidget.tsx")
    expect(thread).toContain("opened")
    expect(thread).toContain("overlay={")
    expect(thread).toContain("composerDisabled={showEmail}")
    expect(thread).toContain("writeEmailAttached")
    expect(thread).toContain("readEmailAttached")
    expect(thread).not.toMatch(/emailAttached:\s*hasLead/)
    expect(thread).not.toContain("afterMessages")
    expect(widget).toContain("overlay")
    expect(widget).not.toContain("afterMessages")
    expect(panel).toContain("backdrop-blur")
    expect(panel).toContain('data-slot="chat-email-overlay"')
    expect(panel).toContain("prefers-reduced-motion")
    expect(transcript).not.toContain("afterMessages")
    expect(transcript).not.toContain("ChatEmailCard")
    expect(read("ChatMessageRow.tsx")).toContain("renderMarkdown")
    expect(read("ChatMessageRow.tsx")).not.toMatch(/streamdown|react-markdown/i)
    expect(read("ChatMessageRow.tsx")).toContain('variant={isUser ? "default" : "secondary"}')
    expect(read("ChatMessageRow.tsx")).not.toContain("tinted")
  })

  test("la bulle visiteur est brand, l'assistant reste secondary", () => {
    const html = renderTranscript([
      { id: "u1", role: "user", text: "Bonjour" },
      { id: "a1", role: "assistant", text: "Salut" },
    ])
    expect(html).toContain('data-variant="default"')
    expect(html).toContain('data-variant="secondary"')
    expect(html).not.toContain('data-variant="tinted"')
  })

  test("l'avatar agent du fil est un disque identité, sans anneau", () => {
    const row = read("ChatMessageRow.tsx")
    expect(row).toContain("rounded-full")
    expect(row).toContain("overflow-hidden")
    expect(row).toContain("aspect-square")
    expect(row).toContain("object-cover")
    expect(row).toContain("--chat-accent")
    expect(row).not.toContain('from "@/components/ui/avatar"')
    expect(row).not.toContain("AvatarImage")
    expect(row).not.toContain("after:border")

    const html = renderToStaticMarkup(
      createElement(
        MessageScrollerProvider,
        { autoScroll: true },
        createElement(ChatTranscript, {
          messages: [{ id: "a1", role: "assistant", text: "Salut" }],
          avatarUrl: "/gina.png",
        }),
      ),
    )
    expect(html).toContain('src="/gina.png"')
    expect(html).toContain("object-cover")
    expect(html).toContain("rounded-full")
    expect(html).not.toContain("data-slot=\"avatar\"")
  })

  test("une photo et sa légende restent dans une seule bulle", () => {
    const row = read("ChatMessageRow.tsx")
    expect(row).toContain("p-0")
    expect(row).toContain("px-3 py-2")
    expect(row).toContain("object-cover")
    expect(row).not.toContain("rounded-md")
    expect(row).not.toContain("mb-2 max-h-48")

    const visitor = renderTranscript([
      {
        id: "u1",
        role: "user",
        text: "Voici la photo",
        file: { url: "https://cdn.example/p.png", filename: "photo.png", mime: "image/png" },
      },
    ])
    expect(visitor).toContain('data-variant="default"')
    expect(visitor).toContain('src="https://cdn.example/p.png"')
    expect(visitor).toContain("Voici la photo")
    expect(visitor.indexOf("<img")).toBeLessThan(visitor.indexOf("Voici la photo"))
    expect(visitor).toContain("p-0")
    expect(visitor).toContain("px-3 py-2")

    const assistant = renderTranscript([
      {
        id: "a1",
        role: "assistant",
        text: "Image reçue",
        file: { url: "https://cdn.example/a.png", filename: "a.png", mime: "image/png" },
      },
    ])
    expect(assistant).toContain('data-variant="secondary"')
    expect(assistant).toContain("Image reçue")
    expect(assistant).not.toContain('data-variant="default"')
  })

  test("un message assistant terminé laisse l'overlay e-mail visible", () => {
    const html = renderToStaticMarkup(
      createElement(
        MessageScrollerProvider,
        { autoScroll: true },
        createElement(
          ChatPanel,
          { onReset: () => undefined, overlay: createElement("p", null, "Quelle est votre adresse email ?") },
          createElement(ChatTranscript, {
            messages: [
              { id: "u1", role: "user", text: "Bonjour" },
              { id: "a1", role: "assistant", text: "Réponse complète" },
            ],
          }),
        ),
      ),
    )
    expect(html).toContain("Quelle est votre adresse email ?")
    expect(html).toContain("Réponse complète")
    expect(html).toContain("data-slot=\"chat-email-overlay\"")
    expect(html).toContain("backdrop-blur")
    expect(html).not.toContain("Réponse en cours…")
  })

  test("empty et composer sont en français", () => {
    expect(read("ChatPanel.tsx")).toContain("Bonjour !")
    expect(read("ChatPanel.tsx")).toContain("EMPTY_THREAD_PROMPT")
    expect(read("ChatComposer.tsx")).toContain("Envoyer")
    expect(read("ChatComposer.tsx")).toContain("<textarea")
    expect(read("ChatComposer.tsx")).toContain("h-14")
    expect(read("ChatComposer.tsx")).toContain('size="icon-sm"')
    expect(read("ChatComposer.tsx")).toContain("PlusIcon")
    expect(read("ChatComposer.tsx")).toContain('accept="image/*"')
    expect(read("ChatComposer.tsx")).toContain('name="media"')
    expect(read("ChatComposer.tsx")).toContain("onChange")
    expect(read("ChatComposer.tsx")).toContain("Ajouter une image")
    expect(read("ChatComposer.tsx")).toContain("disabled")
    expect(read("ChatComposer.tsx")).toContain("rounded-full")
    expect(read("ChatComposer.tsx")).toContain("focus-visible:outline-none")
    expect(read("ChatComposer.tsx")).toContain("data-slot=\"chat-send\"")
    expect(read("ChatComposer.tsx")).not.toContain("bg-neutral-950")
    expect(read("ChatComposer.tsx")).not.toContain("--brand")
    expect(read("ChatComposer.tsx")).not.toContain("DropdownMenu")
    expect(read("ChatComposer.tsx")).not.toContain("Photos et fichiers")
    expect(read("ChatComposer.tsx")).not.toContain("Créer une image")
    expect(read("ChatComposer.tsx")).not.toContain("Recherche approfondie")
    expect(read("ChatComposer.tsx")).not.toContain("Recherche web")
  })

  test("le chrome du widget est isolé du thème hôte", () => {
    const chrome = read("chat-widget-chrome.css")
    expect(chrome).toContain("Geist Variable")
    expect(chrome).toContain("[data-slot=\"chat-widget\"] :focus-visible")
    expect(chrome).toContain("outline: none")
    expect(chrome).not.toMatch(/--color-brand\b/)
    expect(chrome).toContain("--radius: 0.625rem")
    expect(chrome).toContain("--ring: oklch(0.708 0 0)")
    expect(chrome).toContain("--color-border: oklch(0.922 0 0)")
    expect(chrome).toContain("[data-slot=\"chat-widget\"] [data-slot=\"card-header\"]")
    expect(chrome).toContain("border-bottom: 1px solid var(--border)")
    expect(chrome).toContain("--chat-accent")
    expect(chrome).toContain("[data-slot=\"chat-send\"]")
    expect(chrome).toContain("[data-slot=\"chat-fab\"]")
    expect(chrome).toContain("[data-slot=\"message-avatar\"]")
    expect(chrome).toContain("[data-slot=\"chat-teaser\"]")
    expect(chrome).toContain("[data-slot=\"chat-teaser\"][data-unread]")
    expect(chrome).toContain("[data-slot=\"chat-unread\"]")
    expect(chrome).toContain('[data-slot="bubble"][data-variant="default"]')
    expect(chrome).toContain("[data-slot=\"bubble-content\"]")
    expect(chrome).toContain("var(--chat-accent-foreground)")
    expect(chrome).toContain("min-width: 13.75rem")
    expect(chrome).toContain("width: max-content")
    expect(chrome).toContain("max-width: min(20rem, calc(100vw - 6.5rem))")
    expect(chrome).toContain("prefers-reduced-motion")
    expect(chrome).toContain("chat-teaser-nudge")
    expect(chrome).not.toMatch(/--color-brand\b/)
  })

  test("le shimmer officiel vient de shadcn/tailwind.css, déjà importé par les deux hôtes", () => {
    const web = readFileSync(join(here, "../../styles/global.css"), "utf8")
    const admin = readFileSync(join(here, "../../../../admin/src/styles.css"), "utf8")
    expect(web).toContain('shadcn/tailwind.css')
    expect(admin).toContain('shadcn/tailwind.css')
  })
})
