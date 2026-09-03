import type { PointerEvent as ReactPointerEvent } from "react"
import type { StorageLike } from "./chatWidgetState"

export const PREVIEW_POSITION_KEY = "astrotan.agentPreviewPosition"

export type PreviewPosition = { x: number; y: number }

export type PreviewDragHandle = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function clampPreviewPosition(
  position: PreviewPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PreviewPosition {
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(0, viewport.height - size.height)
  return {
    x: Math.min(maxX, Math.max(0, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function readPreviewPosition(storage: StorageLike | null): PreviewPosition | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(PREVIEW_POSITION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !isFiniteNumber((parsed as PreviewPosition).x) ||
      !isFiniteNumber((parsed as PreviewPosition).y)
    ) {
      return null
    }
    return { x: (parsed as PreviewPosition).x, y: (parsed as PreviewPosition).y }
  } catch {
    return null
  }
}

export function writePreviewPosition(
  storage: StorageLike | null,
  position: PreviewPosition,
): void {
  if (!storage) return
  try {
    storage.setItem(PREVIEW_POSITION_KEY, JSON.stringify(position))
  } catch {
    // sessionStorage peut être bloqué ; la position vit le temps de l'onglet en mémoire.
  }
}
