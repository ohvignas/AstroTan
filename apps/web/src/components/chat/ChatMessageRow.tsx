import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import { renderMarkdown } from "../../lib/markdown"
import type { DisplayedMessage } from "./chatWidgetState"

const ASSISTANT_MD =
  "[&_:is(p,ul,ol,pre)]:m-0 [&_:is(p,ul,ol)+_:is(p,ul,ol)]:mt-2 [&_ul]:list-disc [&_ol]:list-decimal [&_:is(ul,ol)]:ps-4 [&_a]:underline [&_a]:underline-offset-2"

function MessageBody({
  isUser,
  text,
}: {
  isUser: boolean
  text: string
}) {
  return isUser ? text : <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
}

export function ChatMessageRow({
  message,
  avatarUrl,
}: {
  message: DisplayedMessage
  avatarUrl?: string
}) {
  const isUser = message.role === "user"
  const file = message.file
  const hasImage = file?.mime.startsWith("image/") === true
  const bodyClass = isUser ? "whitespace-pre-wrap" : ASSISTANT_MD
  return (
    <Message align={isUser ? "end" : "start"}>
      {isUser ? null : (
        <MessageAvatar className="size-8 aspect-square overflow-hidden rounded-full bg-[var(--chat-accent)] ring-0 outline-none after:hidden">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="size-full object-cover"
              width={32}
              height={32}
            />
          ) : null}
        </MessageAvatar>
      )}
      <MessageContent>
        <Bubble variant={isUser ? "default" : "secondary"} align={isUser ? "end" : "start"}>
          <BubbleContent
            className={hasImage ? `${bodyClass} p-0` : bodyClass}
            {...(message.streaming ? { "aria-live": "polite" as const } : {})}
          >
            {hasImage && file ? (
              <img
                src={file.url}
                alt={file.filename}
                className="block max-h-48 w-full object-cover"
              />
            ) : file ? (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 block underline underline-offset-2"
              >
                {file.filename}
              </a>
            ) : null}
            {hasImage ? (
              message.text ? (
                <div className="px-3 py-2">
                  <MessageBody isUser={isUser} text={message.text} />
                </div>
              ) : null
            ) : (
              <MessageBody isUser={isUser} text={message.text} />
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
