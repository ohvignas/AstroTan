import { useEffect, useRef, useState, type FormEvent } from "react"
import { pingChatPresence, sendChatWithOptionalFile, startChat } from "./chatApi"
import { chatFileApiError, chatFileClientError, type ChatFileRef } from "./chatFile"
import { ChatEmailCard } from "./ChatEmailCard"
import { ChatWidget } from "./ChatWidget"
import {
  bannerForCode,
  browserSessionStorage,
  fieldMessage,
  isEmptyThread,
  isSessionCode,
  presenceIntervalMs,
  readChatOpened,
  readEmailAttached,
  readEmailDismissed,
  readEmailGateOpened,
  shouldShowEmailCard,
  writeChatOpened,
  writeEmailAttached,
  writeEmailDismissed,
  writeEmailGateOpened,
} from "./chatWidgetState"
import { useStaffUnread } from "./chatUnread"
import { useChatPoll, useDocumentHidden } from "./useChatPoll"

type Props = {
  token: string
  onStarted: (token: string) => void
  onSessionLost: () => void
  avatarUrl: string
  open: boolean
  onOpenChange: (open: boolean) => void
  color?: string | null
  teaser?: string | null
  agentName?: string | null
}

export function ChatThread({
  token,
  onStarted,
  onSessionLost,
  avatarUrl,
  open,
  onOpenChange,
  color,
  teaser,
  agentName,
}: Props) {
  const [pending, setPending] = useState(false)
  const hidden = useDocumentHidden()
  const { messages, banner, setBanner, setOptimistic, staffOnline } =
    useChatPoll(token, onSessionLost, open, pending)
  const unreadCount = useStaffUnread(open, messages, token)
  const [body, setBody] = useState("")
  const [bodyError, setBodyError] = useState<string | null>(null)
  const resetGen = useRef(0)
  const sendingRef = useRef(false)
  const [dismissed, setDismissed] = useState(() =>
    readEmailDismissed(browserSessionStorage(), token),
  )
  const [emailAttached, setEmailAttached] = useState(() =>
    readEmailAttached(browserSessionStorage(), token),
  )
  const [opened, setOpened] = useState(() =>
    readEmailGateOpened(browserSessionStorage(), token),
  )
  const [hasOpened, setHasOpened] = useState(() => readChatOpened(browserSessionStorage()))

  useEffect(() => {
    setDismissed(readEmailDismissed(browserSessionStorage(), token))
    setEmailAttached(token.length === 0 ? false : readEmailAttached(browserSessionStorage(), token))
    // Strictement le jeton courant : `current || stored` recyclait la porte
    // ouverte de l'ancien fil après Réinitialiser.
    setOpened(token.length === 0 ? false : readEmailGateOpened(browserSessionStorage(), token))
    setHasOpened(readChatOpened(browserSessionStorage()))
  }, [token])

  useEffect(() => {
    const interval = presenceIntervalMs({ open, hidden })
    if (interval == null || token.length === 0) return
    let cancelled = false
    async function beat() {
      const result = await pingChatPresence(token)
      if (cancelled) return
      if (!result.ok && isSessionCode(result.code)) onSessionLost()
    }
    void beat()
    const id = window.setInterval(() => void beat(), interval)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token, onSessionLost, open, hidden])

  const showEmail = shouldShowEmailCard({
    hasUserMessage: messages.some((message) => message.role === "user"),
    emailAttached,
    dismissed,
    opened,
  })

  useEffect(() => {
    if (!showEmail || token.length === 0) return
    if (messages.every((message) => message.role !== "user")) return
    if (!opened) setOpened(true)
    writeEmailGateOpened(browserSessionStorage(), token)
  }, [showEmail, opened, token, messages])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingRef.current) return
    setBanner(null)
    setBodyError(null)
    const text = body.trim()
    const media = (event.currentTarget.elements.namedItem("media") as HTMLInputElement | null)
      ?.files?.[0]
    if (media) {
      const fileError = chatFileClientError(media)
      if (fileError) {
        setBodyError(fileError)
        return
      }
    }
    if (text.length === 0 && !media) {
      setBodyError("Écrivez un message ou ajoutez une image.")
      return
    }
    sendingRef.current = true
    const siteWeb = String(new FormData(event.currentTarget).get("site_web") ?? "")
    const localId = `local-${Date.now()}`
    const gen = resetGen.current
    const localFile: ChatFileRef | undefined = media
      ? { url: URL.createObjectURL(media), filename: media.name, mime: media.type }
      : undefined
    setOptimistic((current) => [
      ...current,
      { id: localId, role: "user", text, ...(localFile ? { file: localFile } : {}) },
    ])
    setPending(true)
    setBody("")
    try {
      let session = token
      if (session.length === 0) {
        const started = await startChat({ site_web: siteWeb })
        if (gen !== resetGen.current) return
        if (!started.ok) {
          setOptimistic((current) => current.filter((message) => message.id !== localId))
          setBanner(bannerForCode(started.code) ?? "L'assistant est indisponible.")
          return
        }
        const next = started.data.token
        if (typeof next !== "string" || next.length === 0) {
          setOptimistic((current) => current.filter((message) => message.id !== localId))
          setBanner("L'assistant est indisponible.")
          return
        }
        session = next
        onStarted(session)
      }
      const result = await sendChatWithOptionalFile(session, text, media)
      if (gen !== resetGen.current) return
      if (!result.ok) {
        setOptimistic((current) => current.filter((message) => message.id !== localId))
        if (isSessionCode(result.code)) {
          onSessionLost()
          return
        }
        const fileMsg = chatFileApiError(result.code)
        if (fileMsg) {
          setBodyError(fileMsg)
          return
        }
        const field = fieldMessage(result.code, "thread")
        if (field) {
          setBodyError(field.message)
          return
        }
        setBanner(bannerForCode(result.code) ?? "L'assistant est indisponible.")
      }
    } catch {
      setOptimistic((current) => current.filter((message) => message.id !== localId))
      setBanner("L'assistant est indisponible.")
    } finally {
      if (gen === resetGen.current) {
        sendingRef.current = false
        setPending(false)
      }
    }
  }

  function onReset() {
    resetGen.current += 1
    sendingRef.current = false
    setBody("")
    setBodyError(null)
    setPending(false)
    setBanner(null)
    setOptimistic([])
    setDismissed(false)
    setEmailAttached(false)
    setOpened(false)
    setHasOpened(false)
    onSessionLost()
  }

  return (
    <ChatWidget
      open={open}
      onOpenChange={(next) => {
        if (next) {
          writeChatOpened(browserSessionStorage())
          setHasOpened(true)
        }
        onOpenChange(next)
      }}
      hasOpened={hasOpened}
      avatarUrl={avatarUrl}
      placement="site"
      color={color}
      teaser={teaser}
      unreadCount={unreadCount}
      agentName={agentName}
      banner={banner}
      staffOnline={staffOnline}
      isEmpty={isEmptyThread({ messages, pending })}
      onReset={onReset}
      messages={messages}
      pending={pending}
      body={body}
      bodyError={bodyError}
      onBodyChange={setBody}
      onSubmit={(event) => void onSubmit(event)}
      composerDisabled={showEmail}
      overlay={
        showEmail ? (
          <ChatEmailCard
            token={token}
            onAttached={() => {
              writeEmailAttached(browserSessionStorage(), token)
              setEmailAttached(true)
            }}
            onIgnore={() => {
              writeEmailDismissed(browserSessionStorage(), token)
              setDismissed(true)
            }}
          />
        ) : null
      }
    />
  )
}
