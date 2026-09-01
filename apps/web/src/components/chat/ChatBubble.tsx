import { useCallback, useEffect, useState } from "react"
import { ChatGate } from "./ChatGate"
import { ChatThread } from "./ChatThread"
import {
  browserSessionStorage,
  clearSessionToken,
  nextScreen,
  readSessionToken,
  writeSessionToken,
} from "./chatWidgetState"

export default function ChatBubble() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const screen = nextScreen({ token, agentEnabled: true })

  useEffect(() => {
    setToken(readSessionToken(browserSessionStorage()))
  }, [])

  const onStarted = useCallback((next: string) => {
    writeSessionToken(browserSessionStorage(), next)
    setToken(next)
  }, [])

  const onSessionLost = useCallback(() => {
    clearSessionToken(browserSessionStorage())
    setToken(null)
  }, [])

  if (screen === "hidden") return null

  return (
    <div className="chat-widget">
      {open ? (
        <section className="chat-widget__panel" aria-labelledby="chat-widget-title">
          <header className="chat-widget__head">
            <h2 id="chat-widget-title">Aide</h2>
            <button type="button" className="chat-widget__close" onClick={() => setOpen(false)}>
              Fermer
            </button>
          </header>
          {screen === "gate" ? (
            <ChatGate onStarted={onStarted} />
          ) : (
            <ChatThread token={token ?? ""} onSessionLost={onSessionLost} />
          )}
        </section>
      ) : null}
      <button
        type="button"
        className="chat-widget__toggle"
        aria-expanded={open}
        aria-controls={open ? "chat-widget-title" : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        Aide
      </button>
    </div>
  )
}
