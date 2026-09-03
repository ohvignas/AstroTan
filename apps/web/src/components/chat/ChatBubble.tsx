import { resolveAgentAvatarUrl } from "@astrotan/backend/convex/lib/agentAvatar"
import { ConvexProvider } from "convex/react"
import { Component, useCallback, useEffect, useState, type ReactNode } from "react"
import { getConvexReactClient } from "../../lib/convexClient"
import { ChatThread } from "./ChatThread"
import {
  browserSessionStorage,
  clearSessionToken,
  nextScreen,
  readSessionToken,
  readWidgetOpen,
  writeSessionToken,
  writeWidgetOpen,
} from "./chatWidgetState"

class ChatQueryBoundary extends Component<
  { onSessionLost: () => void; sessionKey: string; children: ReactNode },
  { hasError: boolean; sessionKey: string }
> {
  state = { hasError: false, sessionKey: this.props.sessionKey }

  static getDerivedStateFromProps(
    props: { sessionKey: string },
    state: { hasError: boolean; sessionKey: string },
  ) {
    if (props.sessionKey !== state.sessionKey) {
      return { hasError: false, sessionKey: props.sessionKey }
    }
    return null
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: unknown) {
    const data =
      error && typeof error === "object" && "data" in error
        ? (error as { data?: { code?: string } }).data
        : undefined
    if (data?.code === "INVALID_SESSION") this.props.onSessionLost()
  }
  render() {
    return this.state.hasError ? null : this.props.children
  }
}

export default function ChatBubble(props: {
  avatarUrl?: string
  preview?: boolean
  color?: string | null
  teaser?: string | null
  agentName?: string | null
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <ConvexProvider client={getConvexReactClient()}>
      <ChatBubbleInner {...props} />
    </ConvexProvider>
  )
}

function ChatBubbleInner({
  avatarUrl,
  preview = false,
  color,
  teaser,
  agentName,
}: {
  avatarUrl?: string
  preview?: boolean
  color?: string | null
  teaser?: string | null
  agentName?: string | null
}) {
  const [open, setOpen] = useState(preview)
  const [token, setToken] = useState<string | null>(null)
  const screen = nextScreen({ token, agentEnabled: true, preview })
  const src = resolveAgentAvatarUrl(avatarUrl)

  useEffect(() => {
    setToken(readSessionToken(browserSessionStorage()))
    if (!preview) setOpen(readWidgetOpen(browserSessionStorage()))
  }, [preview])

  const onStarted = useCallback((next: string) => {
    writeSessionToken(browserSessionStorage(), next)
    setToken(next)
  }, [])

  const onSessionLost = useCallback(() => {
    clearSessionToken(browserSessionStorage())
    setToken(null)
  }, [])

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    writeWidgetOpen(browserSessionStorage(), next)
  }, [])

  if (screen === "hidden") return null

  return (
    <ChatQueryBoundary sessionKey={token ?? ""} onSessionLost={onSessionLost}>
      <ChatThread
        token={token ?? ""}
        onStarted={onStarted}
        onSessionLost={onSessionLost}
        avatarUrl={src}
        open={open}
        onOpenChange={onOpenChange}
        color={color}
        teaser={teaser}
        agentName={agentName}
      />
    </ChatQueryBoundary>
  )
}
