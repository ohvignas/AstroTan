import { useEffect, useState } from "react"
import {
  browserSessionStorage,
  SEEN_STAFF_KEY,
  type DisplayedMessage,
  type StorageLike,
} from "./chatWidgetState"

function sameIds(left: readonly string[] | null, right: readonly string[]): boolean {
  if (left == null || left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

export function staffMessageIds(messages: readonly DisplayedMessage[]): string[] {
  return messages
    .filter(
      (message) =>
        message.role === "assistant" &&
        message.streaming !== true &&
        message.text.trim().length > 0,
    )
    .map((message) => message.id)
}

export function staffUnreadCount(
  messages: readonly DisplayedMessage[],
  seenIds: readonly string[] | null,
  open: boolean,
): number {
  if (open || seenIds == null) return 0
  const seen = new Set(seenIds)
  return staffMessageIds(messages).filter((id) => !seen.has(id)).length
}

export function unreadNotice(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? "Nouveau message !" : "Nouveaux messages !"
}

export function unreadPastille(count: number): string | null {
  if (count <= 0) return null
  return count > 9 ? "9+" : String(count)
}

export function unreadSrLabel(count: number): string {
  if (count <= 0) return "Aide"
  if (count === 1) return "1 message non lu"
  if (count > 9) return "9+ messages non lus"
  return `${count} messages non lus`
}

export function readSeenStaffIds(
  storage: StorageLike | null,
  token: string,
): string[] | null {
  if (!storage || token.length === 0) return null
  try {
    const raw = storage.getItem(SEEN_STAFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { token?: unknown; ids?: unknown }
    if (parsed.token !== token || !Array.isArray(parsed.ids)) return null
    return parsed.ids.filter((id): id is string => typeof id === "string")
  } catch {
    return null
  }
}

export function writeSeenStaffIds(
  storage: StorageLike | null,
  token: string,
  ids: readonly string[],
): void {
  if (!storage || token.length === 0) return
  try {
    storage.setItem(SEEN_STAFF_KEY, JSON.stringify({ token, ids }))
  } catch {
    // sessionStorage peut être bloqué
  }
}

function remember(token: string, ids: string[], setSeenIds: (next: string[]) => void) {
  setSeenIds(ids)
  writeSeenStaffIds(browserSessionStorage(), token, ids)
}

/** Compteur = messages assistant arrivés depuis la dernière ouverture. */
export function useStaffUnread(
  open: boolean,
  messages: readonly DisplayedMessage[],
  token: string,
): number {
  const [seenIds, setSeenIds] = useState<string[] | null>(() =>
    readSeenStaffIds(browserSessionStorage(), token),
  )

  useEffect(() => {
    setSeenIds(readSeenStaffIds(browserSessionStorage(), token))
  }, [token])

  useEffect(() => {
    const ids = staffMessageIds(messages)
    if (open) {
      if (!sameIds(seenIds, ids)) remember(token, ids, setSeenIds)
      return
    }
    if (seenIds == null && ids.length > 0) remember(token, ids, setSeenIds)
  }, [open, messages, token, seenIds])

  return staffUnreadCount(messages, seenIds, open)
}
