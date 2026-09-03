import "@fontsource-variable/geist"
import type { CSSProperties, FormEvent, ReactNode } from "react"
import {
  chatAccentForeground,
  resolveAgentChatColor,
  visibleChatTeaser,
} from "@astrotan/backend/convex/lib/agentChatAppearance"
import { ChatComposer } from "./ChatComposer"
import { ChatPanel } from "./ChatPanel"
import { ChatTranscript } from "./ChatTranscript"
import { unreadNotice, unreadPastille, unreadSrLabel } from "./chatUnread"
import { shouldShowIdentityTeaser, type DisplayedMessage } from "./chatWidgetState"
import { usePreviewDrag } from "./usePreviewDrag"
import "./chat-widget-chrome.css"

export type ChatWidgetPlacement = "site" | "preview"

const SHELL: Record<ChatWidgetPlacement, string> = {
  site: "pointer-events-none fixed right-4 bottom-4 z-[45] flex w-full max-w-sm flex-col items-end gap-3",
  preview:
    "pointer-events-none fixed right-4 bottom-20 z-10 flex w-full max-w-sm flex-col items-end gap-3",
}

export function ChatWidget({
  open,
  onOpenChange,
  avatarUrl,
  placement = "site",
  showFab = true,
  color,
  teaser,
  hasOpened = false,
  unreadCount = 0,
  banner,
  staffOnline,
  agentName,
  isEmpty,
  onReset,
  resetDisabled,
  messages,
  pending = false,
  overlay,
  body,
  bodyError,
  onBodyChange,
  onSubmit,
  composerDisabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  avatarUrl: string
  placement?: ChatWidgetPlacement
  showFab?: boolean
  color?: string | null
  teaser?: string | null
  hasOpened?: boolean
  unreadCount?: number
  banner?: string | null
  staffOnline?: boolean
  agentName?: string | null
  isEmpty?: boolean
  onReset: () => void
  resetDisabled?: boolean
  messages: DisplayedMessage[]
  pending?: boolean
  overlay?: ReactNode
  body: string
  bodyError: string | null
  onBodyChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  composerDisabled?: boolean
}) {
  const drag = usePreviewDrag(placement === "preview")
  if (placement === "preview" && !open) return null
  if (!open && !showFab) return null

  const accent = resolveAgentChatColor(color)
  const unread = !open && unreadCount > 0
  const teaserText = unread
    ? unreadNotice(unreadCount)
    : shouldShowIdentityTeaser({ messages, hasOpened })
      ? visibleChatTeaser(teaser, open)
      : null
  const pastille = unread ? unreadPastille(unreadCount) : null
  const chrome = {
    "--chat-accent": accent,
    "--chat-accent-foreground": chatAccentForeground(accent),
    "--primary": accent,
    "--primary-foreground": chatAccentForeground(accent),
    "--color-primary": accent,
    "--color-primary-foreground": chatAccentForeground(accent),
  } as CSSProperties

  return (
    <div
      ref={drag.shellRef}
      data-slot="chat-widget"
      className={SHELL[placement]}
      style={{ ...chrome, ...drag.style }}
    >
      {open ? (
        <div className="pointer-events-auto w-full max-w-sm">
          <ChatPanel
            banner={banner}
            staffOnline={staffOnline}
            agentName={agentName}
            isEmpty={isEmpty}
            resetDisabled={resetDisabled}
            onReset={onReset}
            dragging={drag.dragging}
            dragHandle={drag.handleProps}
            onClose={() => onOpenChange(false)}
            overlay={overlay}
            footer={
              <ChatComposer
                body={body}
                bodyError={bodyError}
                pending={pending}
                disabled={composerDisabled}
                onBodyChange={onBodyChange}
                onSubmit={onSubmit}
              />
            }
          >
            <ChatTranscript
              messages={messages}
              avatarUrl={avatarUrl}
              pending={pending}
            />
          </ChatPanel>
        </div>
      ) : null}
      {showFab ? (
        <div className="relative">
          {teaserText ? (
            <button
              type="button"
              data-slot="chat-teaser"
              data-unread={unread ? "" : undefined}
              className="pointer-events-auto"
              onClick={() => onOpenChange(true)}
            >
              {teaserText}
            </button>
          ) : null}
          <button
            type="button"
            data-slot="chat-fab"
            className="pointer-events-auto size-16 overflow-hidden rounded-full border-0 bg-primary shadow-md"
            aria-expanded={open}
            aria-controls={open ? "chat-widget-title" : undefined}
            onClick={() => onOpenChange(!open)}
          >
            <img src={avatarUrl} alt="" className="size-full object-cover" width={56} height={56} />
            <span className="sr-only">{unreadSrLabel(unread ? unreadCount : 0)}</span>
          </button>
          {pastille ? (
            <span data-slot="chat-unread" aria-hidden="true">
              {pastille}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
