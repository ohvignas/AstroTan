export const PRESENCE_ONLINE_MS = 45_000

export function isOnline(lastSeenAt: number | undefined, now: number): boolean {
  return lastSeenAt !== undefined && now - lastSeenAt < PRESENCE_ONLINE_MS
}
