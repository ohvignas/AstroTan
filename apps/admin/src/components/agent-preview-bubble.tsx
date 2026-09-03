import { api } from "@astrotan/backend/convex/_generated/api"
import { resolveAgentAvatarUrl } from "@astrotan/backend/convex/lib/agentAvatar"
import { useConvex, useMutation } from "convex/react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { ChatWidget } from "../../../web/src/components/chat/ChatWidget"
import {
  bannerForCode,
  fallbackIfReplyTimedOut,
  initialPollState,
  pollBannerAfterFailures,
  reducePoll,
  STREAM_FALLBACK_ID,
  STREAM_TEXT_TIMEOUT_MS,
  type DisplayedMessage,
} from "../../../web/src/components/chat/chatWidgetState"

export function AgentPreviewBubble({
  avatarUrl,
  color,
  teaser,
  agentName,
  open,
  onOpenChange,
}: {
  avatarUrl: string | null
  color?: string | null
  teaser?: string | null
  agentName?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const convex = useConvex()
  const previewStart = useMutation(api.chat.previewStart)
  const previewSend = useMutation(api.chat.previewSend)
  const previewReset = useMutation(api.chat.previewReset)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [poll, setPoll] = useState(initialPollState)
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<DisplayedMessage[]>([])
  const pollRef = useRef(poll)
  pollRef.current = poll
  const optimisticRef = useRef(optimistic)
  optimisticRef.current = optimistic
  const failuresRef = useRef(0)
  const sendGen = useRef(0)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const src = resolveAgentAvatarUrl(avatarUrl)

  function clearFallbackTimer() {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    fallbackTimer.current = undefined
  }

  function armFallback(gen: number, sentAt: number) {
    clearFallbackTimer()
    fallbackTimer.current = setTimeout(() => {
      if (sendGen.current !== gen) return
      const extra = fallbackIfReplyTimedOut({
        messages: [...pollRef.current.messages, ...optimisticRef.current].filter(
          (message) => message.id !== STREAM_FALLBACK_ID,
        ),
        sentAt,
        now: Date.now(),
      })
      if (extra) {
        setOptimistic((current) =>
          current.some((message) => message.id === extra.id) ? current : [...current, extra],
        )
      }
    }, STREAM_TEXT_TIMEOUT_MS)
  }

  useEffect(() => {
    void previewStart({}).then((started) => setThreadId(started.threadId))
  }, [previewStart])

  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      const current = pollRef.current
      try {
        const data = await convex.query(api.chat.previewListMessages, {
          threadId: threadId!,
          paginationOpts: { numItems: 50, cursor: null },
          streamArgs: current.streamArgs,
        })
        if (cancelled) return
        failuresRef.current = 0
        setBanner(null)
        const next = reducePoll(current, data)
        pollRef.current = next
        setPoll(next)
        const hasAssistantReply = next.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.streaming !== true &&
            message.text.trim().length > 0,
        )
        if (hasAssistantReply) clearFallbackTimer()
        setOptimistic((local) =>
          local.filter((item) => {
            if (item.id === STREAM_FALLBACK_ID && hasAssistantReply) return false
            return !next.messages.some(
              (message) => message.role === item.role && message.text === item.text,
            )
          }),
        )
        timer = setTimeout(() => void tick(), next.intervalMs)
      } catch {
        if (cancelled) return
        failuresRef.current += 1
        setBanner(pollBannerAfterFailures("indisponible", failuresRef.current))
        timer = setTimeout(() => void tick(), current.intervalMs)
      }
    }

    timer = setTimeout(() => void tick(), 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [convex, threadId])

  useEffect(() => () => clearFallbackTimer(), [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!threadId) return
    const text = body.trim()
    if (text.length === 0) return
    sendGen.current += 1
    const gen = sendGen.current
    clearFallbackTimer()
    setPending(true)
    setBanner(null)
    const localId = `local-${Date.now()}`
    setOptimistic((current) => [
      ...current.filter((message) => message.id !== STREAM_FALLBACK_ID),
      { id: localId, role: "user", text },
    ])
    setBody("")
    try {
      await previewSend({ threadId, body: text })
      if (sendGen.current === gen) armFallback(gen, Date.now())
    } catch {
      if (sendGen.current === gen) {
        setOptimistic((current) => current.filter((message) => message.id !== localId))
        setBanner(bannerForCode("indisponible"))
      }
    } finally {
      if (sendGen.current === gen) setPending(false)
    }
  }

  const messages = optimistic.length > 0 ? [...poll.messages, ...optimistic] : poll.messages

  return (
    <ChatWidget
      open={open}
      onOpenChange={onOpenChange}
      avatarUrl={src}
      placement="preview"
      showFab={true}
      color={color}
      teaser={teaser}
      agentName={agentName}
      banner={banner}
      isEmpty={messages.length === 0 && !pending}
      resetDisabled={pending}
      onReset={() => {
        sendGen.current += 1
        clearFallbackTimer()
        void previewReset({}).then((started) => {
          setThreadId(started.threadId)
          setPoll(initialPollState())
          setOptimistic([])
          setBody("")
          setBanner(null)
          failuresRef.current = 0
        })
      }}
      messages={messages}
      pending={pending}
      body={body}
      bodyError={null}
      composerDisabled={!threadId}
      onBodyChange={setBody}
      onSubmit={(event) => void onSubmit(event)}
    />
  )
}
