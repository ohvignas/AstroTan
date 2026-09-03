import { useEffect } from "react"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { ChatMessageRow } from "./ChatMessageRow"
import { streamingBusyLabel, type DisplayedMessage } from "./chatWidgetState"

function isHiddenUntilComplete(message: DisplayedMessage): boolean {
  if (message.streaming === true) return true
  return message.role === "assistant" && message.text.trim().length === 0
}

function StickTranscriptToEnd({ stickKey }: { stickKey: string }) {
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      scrollToEnd({ behavior: "instant" })
    })
    return () => window.cancelAnimationFrame(id)
  }, [stickKey, scrollToEnd])
  return null
}

export function ChatTranscript({
  messages,
  avatarUrl,
  pending = false,
}: {
  messages: DisplayedMessage[]
  avatarUrl?: string
  pending?: boolean
}) {
  const last = messages.at(-1)
  const isBusy =
    pending || messages.some(isHiddenUntilComplete) || last?.role === "user"
  const visible = messages.filter((message) => !isHiddenUntilComplete(message))
  const lastVisibleId = visible.at(-1)?.id
  const stickKey = `${visible.length}:${lastVisibleId ?? ""}:${isBusy ? "1" : "0"}`

  return (
    <MessageScroller className="h-full min-h-0">
      <StickTranscriptToEnd stickKey={stickKey} />
      <MessageScrollerViewport className="h-full min-h-0 overflow-y-auto">
        <MessageScrollerContent aria-busy={isBusy} className="p-(--card-spacing)">
          {visible.map((message) => (
            <MessageScrollerItem
              key={message.id}
              messageId={message.id}
              scrollAnchor={!isBusy && message.id === lastVisibleId}
            >
              <ChatMessageRow message={message} avatarUrl={avatarUrl} />
            </MessageScrollerItem>
          ))}
          {isBusy ? (
            <MessageScrollerItem messageId="thinking" scrollAnchor>
              <p className="shimmer text-sm text-muted-foreground">
                {streamingBusyLabel(messages)}
              </p>
            </MessageScrollerItem>
          ) : null}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton aria-label="Derniers messages" />
    </MessageScroller>
  )
}
