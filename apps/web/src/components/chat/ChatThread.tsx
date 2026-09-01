import { MAX_LEAD_BODY_LENGTH } from "@astrotan/backend/convex/content"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { listChatMessages, sendChatMessage } from "./chatApi"
import {
  EMPTY_THREAD_PROMPT,
  bannerForCode,
  fieldMessage,
  initialPollState,
  isSessionCode,
  reducePoll,
  type DisplayedMessage,
} from "./chatWidgetState"

type Props = {
  token: string
  onSessionLost: () => void
}

export function ChatThread({ token, onSessionLost }: Props) {
  const [poll, setPoll] = useState(initialPollState)
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<DisplayedMessage[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef(poll)
  pollRef.current = poll

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      const current = pollRef.current
      const result = await listChatMessages(token, current.streamArgs)
      if (cancelled) return
      if (!result.ok) {
        if (isSessionCode(result.code)) {
          onSessionLost()
          return
        }
        setBanner(bannerForCode(result.code) ?? "L'assistant est indisponible.")
        timer = setTimeout(() => void tick(), current.intervalMs)
        return
      }
      const next = reducePoll(current, result.data)
      pollRef.current = next
      setPoll(next)
      setOptimistic((pending) =>
        pending.filter(
          (local) =>
            !next.messages.some((message) => message.role === local.role && message.text === local.text),
        ),
      )
      timer = setTimeout(() => void tick(), next.intervalMs)
    }

    timer = setTimeout(() => void tick(), 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token, onSessionLost])

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" })
  }, [poll.messages, optimistic])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBanner(null)
    setBodyError(null)
    const text = body.trim()
    if (text.length === 0) {
      setBodyError("Écrivez un message.")
      return
    }
    setPending(true)
    try {
      const result = await sendChatMessage(token, text)
      if (!result.ok) {
        if (isSessionCode(result.code)) {
          onSessionLost()
          return
        }
        const field = fieldMessage(result.code, "thread")
        if (field) {
          setBodyError(field.message)
          return
        }
        setBanner(bannerForCode(result.code) ?? "L'assistant est indisponible.")
        return
      }
      setOptimistic((current) => [
        ...current,
        { id: `local-${Date.now()}`, role: "user", text },
      ])
      setBody("")
    } catch {
      setBanner("L'assistant est indisponible.")
    } finally {
      setPending(false)
    }
  }

  const messages = optimistic.length > 0 ? [...poll.messages, ...optimistic] : poll.messages

  return (
    <div className="chat-widget__thread">
      {banner ? (
        <p className="chat-widget__banner" role="alert">
          {banner}
        </p>
      ) : null}
      <div className="chat-widget__log" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-widget__empty">{EMPTY_THREAD_PROMPT}</p>
        ) : (
          messages.map((message) => (
            <p
              key={message.id}
              className={
                message.role === "user" ? "chat-widget__bubble chat-widget__bubble--me" : "chat-widget__bubble"
              }
              data-streaming={message.streaming ? "true" : undefined}
            >
              {message.text}
            </p>
          ))
        )}
      </div>
      <form className="chat-widget__composer" onSubmit={(event) => void onSubmit(event)}>
        <label className="chat-widget__sr" htmlFor="chat-widget-body">
          Votre message
        </label>
        <textarea
          id="chat-widget-body"
          name="body"
          rows={2}
          maxLength={MAX_LEAD_BODY_LENGTH}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Votre message"
        />
        {bodyError ? <span className="chat-widget__error">{bodyError}</span> : null}
        <button type="submit" className="chat-widget__submit" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer"}
        </button>
      </form>
    </div>
  )
}
