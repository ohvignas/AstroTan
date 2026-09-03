import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { browserSessionStorage } from "./chatWidgetState"
import {
  clampPreviewPosition,
  readPreviewPosition,
  writePreviewPosition,
  type PreviewDragHandle,
  type PreviewPosition,
} from "./previewDrag"

export function usePreviewDrag(enabled: boolean) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PreviewPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const positionRef = useRef<PreviewPosition | null>(null)
  positionRef.current = position

  useEffect(() => {
    if (!enabled) return
    const stored = readPreviewPosition(browserSessionStorage())
    if (!stored) return
    const el = shellRef.current
    const rect = el?.getBoundingClientRect()
    setPosition(
      clampPreviewPosition(
        stored,
        { width: rect?.width ?? 384, height: rect?.height ?? 560 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    function onResize() {
      const current = positionRef.current
      const el = shellRef.current
      if (!current || !el) return
      const rect = el.getBoundingClientRect()
      const next = clampPreviewPosition(current, rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      positionRef.current = next
      setPosition(next)
      writePreviewPosition(browserSessionStorage(), next)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [enabled])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return
      if ((event.target as HTMLElement).closest("button, [data-slot=card-action]")) return
      const el = shellRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      offsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const start = { x: rect.left, y: rect.top }
      positionRef.current = start
      setPosition(start)
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [enabled],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      const el = shellRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = clampPreviewPosition(
        {
          x: event.clientX - offsetRef.current.x,
          y: event.clientY - offsetRef.current.y,
        },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      positionRef.current = next
      setPosition(next)
    },
    [enabled],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setDragging(false)
      const current = positionRef.current
      if (current) writePreviewPosition(browserSessionStorage(), current)
    },
    [enabled],
  )

  const style: CSSProperties | undefined =
    enabled && position
      ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
      : undefined

  const handleProps: PreviewDragHandle | undefined = enabled
    ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
    : undefined

  return { shellRef, style, dragging, handleProps }
}
