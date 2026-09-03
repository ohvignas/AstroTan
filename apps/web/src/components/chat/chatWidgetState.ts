export const SESSION_STORAGE_KEY = "astrotan.chatSession"
export const OPEN_STORAGE_KEY = "astrotan.chatOpen"
export const OPENED_STORAGE_KEY = "astrotan.chatOpened"
export const EMAIL_DISMISS_KEY = "astrotan.chatEmailDismissed"
export const EMAIL_ATTACHED_KEY = "astrotan.chatEmailAttached"
export const EMAIL_GATE_KEY = "astrotan.chatEmailGate"
export const SEEN_STAFF_KEY = "astrotan.chatSeenStaff"
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

import { initialPollState, type DisplayedMessage } from "./chatStreamMerge"

export {
  POLL_IDLE_MS,
  POLL_STREAMING_MS,
  PRESENCE_INTERVAL_MS,
  applyVisitorSnapshot,
  attachDrafts,
  hasOpenStream,
  initialPollState,
  mergeDeltaText,
  messagesFromPage,
  pollIntervalMs,
  presenceIntervalMs,
  reducePoll,
  streamingBusyLabel,
  fallbackIfReplyTimedOut,
} from "./chatStreamMerge"
export { STREAM_FALLBACK_ID, STREAM_FALLBACK_TEXT, STREAM_TEXT_TIMEOUT_MS } from "./chatStreamMerge"
export type { DisplayedMessage, PollState, StreamArgsState, StreamCursor } from "./chatStreamMerge"

export function nextScreen(input: {
  token: string | null
  agentEnabled: boolean
  preview?: boolean
}): WidgetScreen {
  if (input.preview === true) return "thread"
  if (!input.agentEnabled) return "hidden"
  return "thread"
}

export function shouldShowEmailCard(input: {
  hasUserMessage: boolean
  emailAttached: boolean
  dismissed: boolean
  opened?: boolean
}): boolean {
  if (input.emailAttached || input.dismissed) return false
  return input.hasUserMessage || input.opened === true
}

/** Teaser Identité : jamais ouvert ni écrit. Reset = session neuve, le teaser peut revenir. */
export function shouldShowIdentityTeaser(input: {
  token?: string | null
  messages: readonly Pick<DisplayedMessage, "role">[]
  hasOpened?: boolean
}): boolean {
  if (input.hasOpened) return false
  const hasVisitorMessage = input.messages.some((message) => message.role === "user")
  const started =
    ((input.token?.length ?? 0) > 0 && hasVisitorMessage) || input.messages.length > 0
  return !started
}

export function bannerForCode(code: string): string | null {
  if (code === "indisponible" || code === "unconfigured") {
    return "L'assistant est indisponible."
  }
  if (code === "disabled") return "L'assistant est désactivé."
  if (code === "rate") return "Trop de messages, réessayez dans un moment."
  return null
}

/** Timeouts Convex (1 s) : un seul 503 ne doit pas peindre le fil en rouge. */
export const POLL_TRANSIENT_FAILURES_BEFORE_BANNER = 3

export function pollBannerAfterFailures(code: string, consecutive: number): string | null {
  if (code === "session" || consecutive < 1) return null
  if (code === "disabled" || code === "unconfigured" || code === "rate") {
    return bannerForCode(code)
  }
  if (consecutive < POLL_TRANSIENT_FAILURES_BEFORE_BANNER) return null
  return bannerForCode(code) ?? "L'assistant est indisponible."
}

export function emailCardMessage(code: string): string {
  if (code === "rate") return "Trop de tentatives, réessayez dans un moment."
  if (code === "session") return "Session expirée. Rouvrez la conversation."
  return fieldMessage(code, "gate")?.message ?? bannerForCode(code) ?? "L'assistant est indisponible."
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
      ? { field: "body", message: "Écrivez un message ou ajoutez une image." }
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
    storage.removeItem(EMAIL_DISMISS_KEY)
    storage.removeItem(EMAIL_ATTACHED_KEY)
    storage.removeItem(EMAIL_GATE_KEY)
    storage.removeItem(SEEN_STAFF_KEY)
    storage.removeItem(OPENED_STORAGE_KEY)
  } catch {
    // idem
  }
}

export function readWidgetOpen(storage: StorageLike | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(OPEN_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function writeWidgetOpen(storage: StorageLike | null, open: boolean): void {
  if (!storage) return
  try {
    storage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0")
  } catch {
    // sessionStorage peut être bloqué
  }
}

export function readChatOpened(storage: StorageLike | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(OPENED_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function writeChatOpened(storage: StorageLike | null): void {
  if (!storage) return
  try {
    storage.setItem(OPENED_STORAGE_KEY, "1")
  } catch {
    // sessionStorage peut être bloqué
  }
}

/** Vrai seulement au passage d'un jeton vers le vide — pas à chaque `pending`. */
export function tokenBecameEmpty(previous: string, next: string): boolean {
  return previous.length > 0 && next.length === 0
}

/** État client d'un fil tout juste réinitialisé — empty « Bonjour ! ». */
export function resetPollClient() {
  return {
    poll: initialPollState(),
    optimistic: [] as DisplayedMessage[],
    hasLead: false,
    staffOnline: false,
    banner: null,
  }
}

/**
 * Greeting « Bonjour ! » dès que le fil est vide — y compris une session
 * neuve (jeton déjà posé). `token.length === 0` excluait ce cas après reset.
 */
export function isEmptyThread(input: {
  messages: readonly unknown[]
  pending: boolean
}): boolean {
  return input.messages.length === 0 && !input.pending
}

/**
 * Sans session, le poll de l'ancien fil ne doit plus s'afficher (Réinitialiser
 * vide le jeton avant que l'effet `resetPollClient` ait tourné).
 */
export function displayedVisitorMessages(
  token: string,
  pollMessages: readonly DisplayedMessage[],
  optimistic: readonly DisplayedMessage[],
): DisplayedMessage[] {
  if (token.length === 0) return [...optimistic]
  return optimistic.length > 0 ? [...pollMessages, ...optimistic] : [...pollMessages]
}

export function readEmailDismissed(storage: StorageLike | null, token: string): boolean {
  if (!storage || token.length === 0) return false
  try {
    return storage.getItem(EMAIL_DISMISS_KEY) === token
  } catch {
    return false
  }
}

export function writeEmailDismissed(storage: StorageLike | null, token: string): void {
  if (!storage || token.length === 0) return
  try {
    storage.setItem(EMAIL_DISMISS_KEY, token)
  } catch {
    // sessionStorage peut être bloqué
  }
}

export function readEmailAttached(storage: StorageLike | null, token: string): boolean {
  if (!storage || token.length === 0) return false
  try {
    return storage.getItem(EMAIL_ATTACHED_KEY) === token
  } catch {
    return false
  }
}

export function writeEmailAttached(storage: StorageLike | null, token: string): void {
  if (!storage || token.length === 0) return
  try {
    storage.setItem(EMAIL_ATTACHED_KEY, token)
  } catch {
    // sessionStorage peut être bloqué
  }
}

export function readEmailGateOpened(storage: StorageLike | null, token: string): boolean {
  if (!storage || token.length === 0) return false
  try {
    return storage.getItem(EMAIL_GATE_KEY) === token
  } catch {
    return false
  }
}

export function writeEmailGateOpened(storage: StorageLike | null, token: string): void {
  if (!storage || token.length === 0) return
  try {
    storage.setItem(EMAIL_GATE_KEY, token)
  } catch {
    // sessionStorage peut être bloqué
  }
}

export function browserSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}
