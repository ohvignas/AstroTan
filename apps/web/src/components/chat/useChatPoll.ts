import { api } from "@astrotan/backend/convex/_generated/api"
import { useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { listChatMessages } from "./chatApi"
import {
  POLL_STREAMING_MS,
  applyVisitorSnapshot,
  displayedVisitorMessages,
  initialPollState,
  isSessionCode,
  pollBannerAfterFailures,
  pollIntervalMs,
  reducePoll,
  resetPollClient,
  tokenBecameEmpty,
  type DisplayedMessage,
} from "./chatWidgetState"

export function useDocumentHidden() {
  const [hidden, setHidden] = useState(() =>
    typeof document === "undefined" ? false : document.hidden,
  )
  useEffect(() => {
    const sync = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])
  return hidden
}

export function useChatPoll(
  token: string,
  onSessionLost: () => void,
  enabled = true,
  pending = false,
) {
  const [poll, setPoll] = useState(initialPollState)
  const [banner, setBanner] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<DisplayedMessage[]>([])
  const [hasLead, setHasLead] = useState(false)
  const [staffOnline, setStaffOnline] = useState(false)
  const pollRef = useRef(poll)
  pollRef.current = poll
  const failuresRef = useRef(0)
  const tokenRef = useRef(token)
  const hidden = useDocumentHidden()
  const live = useQuery(
    api.chat.watchVisitorMessages,
    typeof window !== "undefined" && token.length > 0 ? { token } : "skip",
  )

  useEffect(() => {
    if (live === undefined) return
    const applied = applyVisitorSnapshot(pollRef.current, live)
    pollRef.current = applied.poll
    setPoll(applied.poll)
    setHasLead(applied.hasLead)
    setStaffOnline(applied.staffOnline)
    setOptimistic((locals) =>
      locals.filter(
        (local) =>
          !applied.poll.messages.some(
            (message) => message.role === local.role && message.text === local.text,
          ),
      ),
    )
  }, [live])

  useEffect(() => {
    const previous = tokenRef.current
    tokenRef.current = token
    if (token.length === 0) {
      if (!tokenBecameEmpty(previous, token)) return
      const cleared = resetPollClient()
      pollRef.current = cleared.poll
      setPoll(cleared.poll)
      setOptimistic(cleared.optimistic)
      setHasLead(cleared.hasLead)
      setStaffOnline(cleared.staffOnline)
      setBanner(cleared.banner)
      failuresRef.current = 0
      return
    }
    if (hidden) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function delayMs(streaming: boolean) {
      return pollIntervalMs({
        open: enabled,
        pending,
        streaming,
        hidden,
        hasSession: true,
      })
    }

    async function tick() {
      const current = pollRef.current
      const streaming =
        current.intervalMs === POLL_STREAMING_MS ||
        current.streamArgs.kind === "deltas" ||
        current.messages.some((message) => message.streaming === true)
      try {
        const result = await listChatMessages(token, current.streamArgs)
        if (cancelled) return
        if (!result.ok) {
          if (isSessionCode(result.code)) {
            onSessionLost()
            return
          }
          failuresRef.current += 1
          setBanner(pollBannerAfterFailures(result.code, failuresRef.current))
          const wait = delayMs(streaming)
          if (wait != null) timer = setTimeout(() => void tick(), wait)
          return
        }
        failuresRef.current = 0
        setBanner(null)
        setHasLead(result.data.hasLead === true)
        setStaffOnline(result.data.staffOnline === true)
        const next = reducePoll(current, result.data)
        pollRef.current = next
        setPoll(next)
        setOptimistic((locals) =>
          locals.filter(
            (local) =>
              !next.messages.some(
                (message) => message.role === local.role && message.text === local.text,
              ),
          ),
        )
        const wait = delayMs(
          next.intervalMs === POLL_STREAMING_MS ||
            next.streamArgs.kind === "deltas" ||
            next.messages.some((message) => message.streaming === true),
        )
        if (wait != null) timer = setTimeout(() => void tick(), wait)
      } catch {
        if (cancelled) return
        failuresRef.current += 1
        setBanner(pollBannerAfterFailures("indisponible", failuresRef.current))
        const wait = delayMs(streaming)
        if (wait != null) timer = setTimeout(() => void tick(), wait)
      }
    }

    timer = setTimeout(() => void tick(), 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token, onSessionLost, enabled, pending, hidden])

  const messages = displayedVisitorMessages(token, poll.messages, optimistic)
  return { messages, banner, setBanner, setOptimistic, hasLead, setHasLead, staffOnline }
}
