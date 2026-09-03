import { useEffect, useRef, useState, type FormEvent } from "react"
import { SmoothText, useUIMessages } from "@convex-dev/agent/react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { ALLOWED_MIME_TYPES, MAX_CHAT_FILE_BYTES } from "@astrotan/backend/convex/content"
import { isOnline } from "@astrotan/backend/convex/lib/presenceWindow"
import { Button } from "@/components/ui/button"
import { LeadChatComposer, uploadLeadChatFile } from "@/components/lead-chat-composer"
import { LeadChatMedia } from "@/components/lead-chat-media"
import { visitorPresenceLabel } from "@/lib/leadPresenceLabel"
import { scrollElementToEnd } from "@/lib/scrollElementToEnd"
import { staffChatBubbles, type StaffChatBubble } from "@/lib/staffChatBubbles"

function StaffMessageBubble({ bubble }: { bubble: StaffChatBubble }) {
  return (
    <li
      className={
        bubble.role === "user"
          ? "self-end rounded-lg bg-muted px-3 py-2 text-sm"
          : "self-start rounded-lg border px-3 py-2 text-sm"
      }
    >
      {bubble.file ? <LeadChatMedia file={bubble.file} /> : null}
      {bubble.text || bubble.streaming ? (
        <p className="whitespace-pre-wrap">
          <SmoothText text={bubble.text} startStreaming={bubble.streaming} />
        </p>
      ) : null}
    </li>
  )
}

export function LeadChatPanel({
  leadId,
  threadId,
}: {
  leadId: Id<"leads">
  threadId: string
}) {
  const presence = useQuery(api.chatStaff.presence, { threadId })
  const takeOver = useMutation(api.chatStaff.takeOver)
  const releaseToAi = useMutation(api.chatStaff.releaseToAi)
  const staffReply = useMutation(api.chatStaff.staffReply)
  const generateUploadUrl = useMutation(api.chatStaff.generateUploadUrl)
  const staffHeartbeat = useMutation(api.chatStaff.staffHeartbeat)
  const { results, status, loadMore } = useUIMessages(
    api.chatStaff.listStaffMessages,
    { threadId },
    { initialNumItems: 32, stream: true },
  )
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [optimistic, setOptimistic] = useState<StaffChatBubble | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const tick = () => {
      void staffHeartbeat({ threadId }).catch(() => undefined)
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [staffHeartbeat, threadId])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(id)
  }, [])

  const controller = presence?.controller ?? "ai"
  const visitorOnline = isOnline(presence?.visitorLastSeenAt, now)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    const file = (event.currentTarget.elements.namedItem("media") as HTMLInputElement | null)
      ?.files?.[0]
    if (file && file.size > MAX_CHAT_FILE_BYTES) {
      setErreur(`Ce fichier dépasse ${MAX_CHAT_FILE_BYTES / (1024 * 1024)} Mo.`)
      return
    }
    if (file && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setErreur("Ce type de fichier n'est pas accepté.")
      return
    }
    if (text.length === 0 && !file) return
    const local: StaffChatBubble = {
      key: `local-${Date.now()}`,
      role: "assistant",
      text,
      streaming: false,
      ...(file
        ? { file: { url: URL.createObjectURL(file), filename: file.name, mime: file.type } }
        : {}),
    }
    setOptimistic(local)
    setBody("")
    setPending(true)
    setErreur(null)
    scrollElementToEnd(listRef.current)
    try {
      const storageId = file
        ? await uploadLeadChatFile(() => generateUploadUrl({}), file)
        : undefined
      await staffReply({
        leadId,
        body: text,
        ...(storageId ? { storageId, filename: file!.name, mime: file!.type } : {}),
      })
    } catch {
      setOptimistic(null)
      setBody(text)
      setErreur("Le message n'a pas pu être envoyé.")
    } finally {
      setPending(false)
    }
  }

  const bubbles = staffChatBubbles(results)
  const shown =
    optimistic && !bubbles.some((bubble) => bubble.role === "assistant" && bubble.text === optimistic.text)
      ? [...bubbles, optimistic]
      : bubbles

  useEffect(() => {
    const id = window.requestAnimationFrame(() => scrollElementToEnd(listRef.current))
    return () => window.cancelAnimationFrame(id)
  }, [shown.length, shown.at(-1)?.key, shown.at(-1)?.text])

  return (
    <section className="flex min-h-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Conversation</h2>
        <p className="text-xs text-muted-foreground">{visitorPresenceLabel(visitorOnline)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {controller === "ai" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void takeOver({ leadId }).catch(() => undefined)}
          >
            Prendre la main
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void releaseToAi({ leadId }).catch(() => undefined)}
          >
            Rendre à l'assistant
          </Button>
        )}
        <p className="self-center text-xs text-muted-foreground">
          {controller === "staff" ? "Vous répondez." : "L'assistant répond."}
        </p>
      </div>

      <ol
        ref={listRef}
        className="flex max-h-72 min-h-40 flex-col gap-2 overflow-y-auto"
      >
        {status === "CanLoadMore" ? (
          <li>
            <Button type="button" size="sm" variant="ghost" onClick={() => loadMore(32)}>
              Messages plus anciens
            </Button>
          </li>
        ) : null}
        {shown.map((bubble) => (
          <StaffMessageBubble key={bubble.key} bubble={bubble} />
        ))}
      </ol>

      <LeadChatComposer
        body={body}
        pending={pending}
        erreur={erreur}
        onBodyChange={setBody}
        onSubmit={(event) => void onSubmit(event)}
      />
    </section>
  )
}
