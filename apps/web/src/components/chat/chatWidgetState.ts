export const SESSION_STORAGE_KEY = "astrotan.chatSession"
export const FIRST_STREAM_ARGS = { kind: "list" } as const
export const EMPTY_THREAD_PROMPT =
  "Écrivez-nous, une personne ou l'assistant vous répond."

export type WidgetScreen = "hidden" | "gate" | "thread"
export type FieldKey = "email" | "name" | "body"
export type Surface = "gate" | "thread"

export type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export {
  POLL_IDLE_MS,
  POLL_STREAMING_MS,
  attachDrafts,
  hasOpenStream,
  initialPollState,
  mergeDeltaText,
  messagesFromPage,
  pollIntervalMs,
  reducePoll,
} from "./chatStreamMerge"
export type { DisplayedMessage, PollState, StreamArgsState, StreamCursor } from "./chatStreamMerge"

export function nextScreen(input: { token: string | null; agentEnabled: boolean }): WidgetScreen {
  if (!input.agentEnabled) return "hidden"
  return input.token ? "thread" : "gate"
}

export function bannerForCode(code: string): string | null {
  if (code === "indisponible" || code === "unconfigured") {
    return "L'assistant est indisponible."
  }
  if (code === "disabled") return "L'assistant est désactivé."
  if (code === "rate") return "Trop de messages, réessayez dans un moment."
  return null
}

export function fieldMessage(
  code: string,
  surface: Surface,
): { field: FieldKey; message: string } | null {
  if (code === "invalid_email") {
    return { field: "email", message: "Adresse e-mail invalide." }
  }
  if (code === "empty") {
    return surface === "thread"
      ? { field: "body", message: "Écrivez un message." }
      : { field: "email", message: "Indiquez votre e-mail." }
  }
  if (code === "too_long") {
    return surface === "thread"
      ? { field: "body", message: "Ce texte est trop long." }
      : { field: "email", message: "Ce texte est trop long." }
  }
  return null
}

export function isSessionCode(code: string): boolean {
  return code === "session"
}

export function readSessionToken(storage: StorageLike | null): string | null {
  if (!storage) return null
  try {
    const value = storage.getItem(SESSION_STORAGE_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function writeSessionToken(storage: StorageLike | null, token: string): void {
  if (!storage) return
  try {
    storage.setItem(SESSION_STORAGE_KEY, token)
  } catch {
    // sessionStorage peut être bloqué ; le fil vit le temps de l'onglet en mémoire.
  }
}

export function clearSessionToken(storage: StorageLike | null): void {
  if (!storage) return
  try {
    storage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // idem
  }
}

export function browserSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}
