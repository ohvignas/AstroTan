import { describe, expect, test } from "vitest"
import {
  EMPTY_THREAD_PROMPT,
  POLL_IDLE_MS,
  POLL_STREAMING_MS,
  PRESENCE_INTERVAL_MS,
  presenceIntervalMs,
  SESSION_STORAGE_KEY,
  OPEN_STORAGE_KEY,
  OPENED_STORAGE_KEY,
  EMAIL_DISMISS_KEY,
  EMAIL_ATTACHED_KEY,
  EMAIL_GATE_KEY,
  SEEN_STAFF_KEY,
  applyVisitorSnapshot,
  attachDrafts,
  bannerForCode,
  fallbackIfReplyTimedOut,
  STREAM_FALLBACK_ID,
  STREAM_FALLBACK_TEXT,
  emailCardMessage,
  resetPollClient,
  displayedVisitorMessages,
  isEmptyThread,
  pollBannerAfterFailures,
  clearSessionToken,
  fieldMessage,
  hasOpenStream,
  initialPollState,
  mergeDeltaText,
  messagesFromPage,
  nextScreen,
  pollIntervalMs,
  readChatOpened,
  readEmailAttached,
  readSessionToken,
  readWidgetOpen,
  reducePoll,
  streamingBusyLabel,
  shouldShowEmailCard,
  shouldShowIdentityTeaser,
  tokenBecameEmpty,
  writeChatOpened,
  writeEmailAttached,
  writeSessionToken,
  writeWidgetOpen,
} from "./chatWidgetState"

describe("nextScreen", () => {
  test("sans token, l'écran est le fil", () => {
    expect(nextScreen({ token: null, agentEnabled: true })).toBe("thread")
  })

  test("agentEnabled false : widget caché", () => {
    expect(nextScreen({ token: "x", agentEnabled: false })).toBe("hidden")
  })

  test("token présent et agent allumé : fil", () => {
    expect(nextScreen({ token: "x", agentEnabled: true })).toBe("thread")
  })

  test("aperçu admin : fil, même sans token", () => {
    expect(nextScreen({ token: null, agentEnabled: true, preview: true })).toBe("thread")
    expect(nextScreen({ token: null, agentEnabled: false, preview: true })).toBe("thread")
  })
})

describe("shouldShowEmailCard", () => {
  test("après le premier message, sans e-mail attaché et sans ignore", () => {
    expect(
      shouldShowEmailCard({ hasUserMessage: true, emailAttached: false, dismissed: false }),
    ).toBe(true)
  })

  test("une fiche lead (IP au start) ne ferme pas la carte — seul l'e-mail attaché ou Ignorer", () => {
    expect(
      shouldShowEmailCard({
        hasUserMessage: true,
        emailAttached: false,
        dismissed: false,
        opened: true,
      }),
    ).toBe(true)
  })

  test("masquée si pas encore de message, e-mail déjà donné, ou ignorée", () => {
    expect(
      shouldShowEmailCard({ hasUserMessage: false, emailAttached: false, dismissed: false }),
    ).toBe(false)
    expect(
      shouldShowEmailCard({ hasUserMessage: true, emailAttached: true, dismissed: false }),
    ).toBe(false)
    expect(
      shouldShowEmailCard({ hasUserMessage: true, emailAttached: false, dismissed: true }),
    ).toBe(false)
  })

  test("une fois ouverte, reste après un message assistant — pas selon le fil", () => {
    expect(
      shouldShowEmailCard({
        hasUserMessage: true,
        emailAttached: false,
        dismissed: false,
        opened: true,
      }),
    ).toBe(true)
    expect(
      shouldShowEmailCard({
        hasUserMessage: false,
        emailAttached: false,
        dismissed: false,
        opened: true,
      }),
    ).toBe(true)
  })

  test("un nouveau jeton après reset n'hérite pas de la porte ouverte", () => {
    expect(
      shouldShowEmailCard({
        hasUserMessage: false,
        emailAttached: false,
        dismissed: false,
        opened: false,
      }),
    ).toBe(false)
  })

  test("Ignorer ou un e-mail validé ferme la porte même si elle était ouverte", () => {
    expect(
      shouldShowEmailCard({
        hasUserMessage: true,
        emailAttached: false,
        dismissed: true,
        opened: true,
      }),
    ).toBe(false)
    expect(
      shouldShowEmailCard({
        hasUserMessage: true,
        emailAttached: true,
        dismissed: false,
        opened: true,
      }),
    ).toBe(false)
  })
})

describe("shouldShowIdentityTeaser", () => {
  test("jamais ouvert ni écrit : teaser Identité, même avec un jeton de session neuve", () => {
    expect(shouldShowIdentityTeaser({ messages: [] })).toBe(true)
    expect(shouldShowIdentityTeaser({ token: "abc", messages: [], hasOpened: false })).toBe(true)
  })

  test("premier ouvert : plus de teaser, même sans avoir écrit", () => {
    expect(shouldShowIdentityTeaser({ messages: [], hasOpened: true })).toBe(false)
  })

  test("jeton + message visiteur, ou fil non vide : pas de teaser marketing", () => {
    expect(
      shouldShowIdentityTeaser({
        token: "abc",
        messages: [{ role: "user" }],
      }),
    ).toBe(false)
    expect(shouldShowIdentityTeaser({ messages: [{ role: "user" }] })).toBe(false)
    expect(shouldShowIdentityTeaser({ messages: [{ role: "assistant" }] })).toBe(false)
  })

  test("après reset, fil vide et pas rouvert : le teaser peut revenir", () => {
    expect(shouldShowIdentityTeaser({ token: "nouveau", messages: [], hasOpened: false })).toBe(
      true,
    )
  })
})

describe("pollIntervalMs", () => {
  test("bulle fermée sans session → pas de poll", () => {
    expect(pollIntervalMs({ open: false, pending: false, streaming: false, hidden: false })).toBeNull()
    expect(pollIntervalMs({ open: false, pending: true, streaming: true, hidden: false })).toBeNull()
  })

  test("bulle fermée avec session → idle, pour les non-lus", () => {
    expect(
      pollIntervalMs({
        open: false,
        pending: false,
        streaming: false,
        hidden: false,
        hasSession: true,
      }),
    ).toBe(POLL_IDLE_MS)
  })

  test("onglet caché → pause", () => {
    expect(pollIntervalMs({ open: true, pending: false, streaming: false, hidden: true })).toBeNull()
    expect(pollIntervalMs({ open: true, pending: true, streaming: true, hidden: true })).toBeNull()
  })

  test("ouvert + streaming ou pending → 1–2 s", () => {
    expect(pollIntervalMs({ open: true, pending: true, streaming: false, hidden: false })).toBe(
      POLL_STREAMING_MS,
    )
    expect(pollIntervalMs({ open: true, pending: false, streaming: true, hidden: false })).toBe(
      POLL_STREAMING_MS,
    )
    expect(POLL_STREAMING_MS).toBeGreaterThanOrEqual(1_000)
    expect(POLL_STREAMING_MS).toBeLessThanOrEqual(2_000)
  })

  test("ouvert + idle → 12–15 s", () => {
    expect(pollIntervalMs({ open: true, pending: false, streaming: false, hidden: false })).toBe(
      POLL_IDLE_MS,
    )
    expect(POLL_IDLE_MS).toBeGreaterThanOrEqual(12_000)
    expect(POLL_IDLE_MS).toBeLessThanOrEqual(15_000)
  })
})

describe("presenceIntervalMs", () => {
  test("onglet caché → pause, widget ouvert ou fermé", () => {
    expect(presenceIntervalMs({ open: true, hidden: true })).toBeNull()
    expect(presenceIntervalMs({ open: false, hidden: true })).toBeNull()
  })

  test("page visible → heartbeat, même widget fermé, sous la fenêtre 45 s", () => {
    expect(presenceIntervalMs({ open: true, hidden: false })).toBe(PRESENCE_INTERVAL_MS)
    expect(presenceIntervalMs({ open: false, hidden: false })).toBe(PRESENCE_INTERVAL_MS)
    expect(PRESENCE_INTERVAL_MS).toBeGreaterThanOrEqual(20_000)
    expect(PRESENCE_INTERVAL_MS).toBeLessThanOrEqual(30_000)
    expect(PRESENCE_INTERVAL_MS).toBeLessThan(45_000)
  })
})

describe("hasOpenStream", () => {
  test("seul un flux en status streaming compte", () => {
    expect(hasOpenStream([{ streamId: "s1", status: "streaming" }])).toBe(true)
    expect(hasOpenStream([{ streamId: "s1" }])).toBe(false)
    expect(hasOpenStream([{ streamId: "s1", status: "done" }])).toBe(false)
    expect(hasOpenStream([])).toBe(false)
    expect(hasOpenStream({ kind: "deltas", deltas: [{ streamId: "s1" }] })).toBe(false)
  })
})

describe("erreurs API", () => {
  test("indisponible et unconfigured", () => {
    expect(bannerForCode("indisponible")).toBe("L'assistant est indisponible.")
    expect(bannerForCode("unconfigured")).toBe("L'assistant est indisponible.")
  })

  test("disabled", () => {
    expect(bannerForCode("disabled")).toBe("L'assistant est désactivé.")
  })

  test("rate", () => {
    expect(bannerForCode("rate")).toBe("Trop de messages, réessayez dans un moment.")
  })

  test("la carte e-mail ne recycle pas « trop de messages »", () => {
    expect(emailCardMessage("rate")).toBe("Trop de tentatives, réessayez dans un moment.")
    expect(emailCardMessage("rate")).not.toContain("messages")
    expect(emailCardMessage("invalid_email")).toBe("Adresse e-mail invalide.")
    expect(emailCardMessage("empty")).toBe("Indiquez votre e-mail.")
    expect(emailCardMessage("too_long")).toBe("Ce texte est trop long.")
    expect(emailCardMessage("indisponible")).toBe("L'assistant est indisponible.")
    expect(emailCardMessage("session")).toBe("Session expirée. Rouvrez la conversation.")
  })

  test("session n'a pas de bannière — on réinitialise le fil", () => {
    expect(bannerForCode("session")).toBeNull()
  })

  test("un timeout de poll isolé ne peint pas la bannière", () => {
    expect(pollBannerAfterFailures("indisponible", 1)).toBeNull()
    expect(pollBannerAfterFailures("indisponible", 2)).toBeNull()
    expect(pollBannerAfterFailures("indisponible", 3)).toBe("L'assistant est indisponible.")
  })

  test("disabled / unconfigured / rate : dès le premier échec", () => {
    expect(pollBannerAfterFailures("disabled", 1)).toBe("L'assistant est désactivé.")
    expect(pollBannerAfterFailures("unconfigured", 1)).toBe("L'assistant est indisponible.")
    expect(pollBannerAfterFailures("rate", 1)).toBe("Trop de messages, réessayez dans un moment.")
    expect(pollBannerAfterFailures("session", 5)).toBeNull()
  })

  test("invalid_email / empty / too_long → messages de champ", () => {
    expect(fieldMessage("invalid_email", "gate")).toEqual({
      field: "email",
      message: "Adresse e-mail invalide.",
    })
    expect(fieldMessage("empty", "gate")).toEqual({
      field: "email",
      message: "Indiquez votre e-mail.",
    })
    expect(fieldMessage("empty", "thread")).toEqual({
      field: "body",
      message: "Écrivez un message ou ajoutez une image.",
    })
    expect(fieldMessage("too_long", "gate")).toEqual({
      field: "email",
      message: "Ce texte est trop long.",
    })
    expect(fieldMessage("too_long", "thread")).toEqual({
      field: "body",
      message: "Ce texte est trop long.",
    })
  })
})

describe("sessionStorage", () => {
  test("clé et jeton seul", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
    expect(SESSION_STORAGE_KEY).toBe("astrotan.chatSession")
    expect(readSessionToken(storage)).toBeNull()
    writeSessionToken(storage, "jeton")
    storage.setItem(EMAIL_DISMISS_KEY, "jeton")
    storage.setItem(EMAIL_ATTACHED_KEY, "jeton")
    storage.setItem(EMAIL_GATE_KEY, "jeton")
    storage.setItem(SEEN_STAFF_KEY, JSON.stringify({ token: "jeton", ids: ["a1"] }))
    writeChatOpened(storage)
    expect(store.get(SESSION_STORAGE_KEY)).toBe("jeton")
    expect(readSessionToken(storage)).toBe("jeton")
    expect(OPENED_STORAGE_KEY).toBe("astrotan.chatOpened")
    expect(readChatOpened(storage)).toBe(true)
    clearSessionToken(storage)
    expect(readSessionToken(storage)).toBeNull()
    expect(store.get(EMAIL_DISMISS_KEY)).toBeUndefined()
    expect(store.get(EMAIL_ATTACHED_KEY)).toBeUndefined()
    expect(store.get(EMAIL_GATE_KEY)).toBeUndefined()
    expect(store.get(SEEN_STAFF_KEY)).toBeUndefined()
    expect(readChatOpened(storage)).toBe(false)
  })

  test("e-mail attaché est lié au jeton, pas au poll", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
    expect(EMAIL_ATTACHED_KEY).toBe("astrotan.chatEmailAttached")
    expect(readEmailAttached(storage, "jeton")).toBe(false)
    writeEmailAttached(storage, "jeton")
    expect(readEmailAttached(storage, "jeton")).toBe(true)
    expect(readEmailAttached(storage, "autre")).toBe(false)
    expect(readEmailAttached(storage, "")).toBe(false)
  })

  test("ouvert persisté, indépendant du jeton", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
    expect(OPEN_STORAGE_KEY).toBe("astrotan.chatOpen")
    expect(readWidgetOpen(storage)).toBe(false)
    writeWidgetOpen(storage, true)
    expect(store.get(OPEN_STORAGE_KEY)).toBe("1")
    expect(readWidgetOpen(storage)).toBe(true)
    writeSessionToken(storage, "jeton")
    clearSessionToken(storage)
    expect(readWidgetOpen(storage)).toBe(true)
    writeWidgetOpen(storage, false)
    expect(readWidgetOpen(storage)).toBe(false)
  })
})

describe("tokenBecameEmpty", () => {
  test("vrai seulement au passage d'un jeton vers le vide — pas à chaque pending", () => {
    expect(tokenBecameEmpty("abc", "")).toBe(true)
    expect(tokenBecameEmpty("", "")).toBe(false)
    expect(tokenBecameEmpty("", "abc")).toBe(false)
    expect(tokenBecameEmpty("abc", "def")).toBe(false)
  })
})

describe("resetPollClient", () => {
  test("vide le fil, les brouillons et le lead — état « Bonjour ! »", () => {
    const cleared = resetPollClient()
    expect(cleared.poll.messages).toEqual([])
    expect(cleared.poll.streamArgs).toEqual({ kind: "list" })
    expect(cleared.optimistic).toEqual([])
    expect(cleared.hasLead).toBe(false)
    expect(cleared.staffOnline).toBe(false)
    expect(cleared.banner).toBeNull()
  })
})

describe("isEmptyThread", () => {
  test("fil vide, même avec une session neuve", () => {
    expect(isEmptyThread({ messages: [], pending: false })).toBe(true)
  })

  test("envoi en cours ou messages : pas le greeting", () => {
    expect(isEmptyThread({ messages: [], pending: true })).toBe(false)
    expect(
      isEmptyThread({ messages: [{ id: "u1", role: "user", text: "Hey" }], pending: false }),
    ).toBe(false)
  })
})

describe("displayedVisitorMessages", () => {
  const stale = [{ id: "old", role: "user" as const, text: "ancien" }]
  const draft = [{ id: "local-1", role: "user" as const, text: "nouveau" }]

  test("sans jeton : ignore le poll stale, garde l'optimiste", () => {
    expect(displayedVisitorMessages("", stale, [])).toEqual([])
    expect(displayedVisitorMessages("", stale, draft)).toEqual(draft)
  })

  test("avec jeton : poll + optimiste", () => {
    expect(displayedVisitorMessages("tok", stale, [])).toEqual(stale)
    expect(displayedVisitorMessages("tok", stale, draft)).toEqual([...stale, ...draft])
  })
})

describe("fusion des deltas", () => {
  test("extrait le texte des messages paginés", () => {
    expect(
      messagesFromPage([
        { id: "u1", role: "user", text: "Bonjour" },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Oui ?" }] },
      ]),
    ).toEqual([
      { id: "u1", role: "user", text: "Bonjour" },
      { id: "a1", role: "assistant", text: "Oui ?" },
    ])
  })

  test("conserve le média attaché à une bulle", () => {
    expect(
      messagesFromPage([
        {
          id: "u1",
          role: "user",
          text: "photo.png",
          chatFile: { url: "https://cdn.example/p.png", filename: "photo.png", mime: "image/png" },
        },
      ]),
    ).toEqual([
      {
        id: "u1",
        role: "user",
        text: "photo.png",
        file: { url: "https://cdn.example/p.png", filename: "photo.png", mime: "image/png" },
      },
    ])
  })

  test("un UIMessage tool-call expose toolCalls pour le shimmer", () => {
    expect(
      messagesFromPage([
        { id: "u1", role: "user", text: "Q" },
        {
          id: "a1",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "tool-call", toolName: "Make__scenarios_list" }],
        },
      ]),
    ).toEqual([
      { id: "u1", role: "user", text: "Q" },
      {
        id: "a1",
        role: "assistant",
        text: "",
        streaming: true,
        tool: "Make__scenarios_list",
        toolCalls: ["Make__scenarios_list"],
      },
    ])
  })

  test("streamingBusyLabel : outil, outils, ou nom court", () => {
    expect(streamingBusyLabel([{ id: "u1", role: "user", text: "Q" }])).toBe(
      "Réponse en cours…",
    )
    expect(
      streamingBusyLabel([
        {
          id: "a1",
          role: "assistant",
          text: "",
          streaming: true,
          toolCalls: ["Make__scenarios_list"],
        },
      ]),
    ).toBe("scenarios_list")
    expect(
      streamingBusyLabel([
        {
          id: "a1",
          role: "assistant",
          text: "",
          streaming: true,
          toolCalls: ["outil"],
        },
      ]),
    ).toBe("Utilisation d'un outil…")
    expect(
      streamingBusyLabel([
        {
          id: "a1",
          role: "assistant",
          text: "",
          streaming: true,
          toolCalls: ["a", "b"],
        },
      ]),
    ).toBe("Utilisation d'outils…")
  })

  test("un UIMessage status streaming reste flaggé, sans le peindre comme fini", () => {
    expect(
      messagesFromPage([
        { id: "u1", role: "user", text: "Q" },
        {
          id: "a1",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "He" }],
        },
      ]),
    ).toEqual([
      { id: "u1", role: "user", text: "Q" },
      { id: "a1", role: "assistant", text: "He", streaming: true },
    ])
  })

  test("concatène les text-delta dans le brouillon assistant", () => {
    expect(mergeDeltaText("Bon", [{ type: "text-delta", delta: "jour" }])).toBe("Bonjour")
    expect(mergeDeltaText("", [{ type: "text-delta", text: "Hi" }])).toBe("Hi")
  })

  test("attache le brouillon au fil affiché", () => {
    expect(EMPTY_THREAD_PROMPT).toBe(
      "Écrivez-nous, une personne ou l'assistant vous répond.",
    )
    expect(
      attachDrafts([{ id: "u1", role: "user", text: "Hey" }], { s1: "En cours" }),
    ).toEqual([
      { id: "u1", role: "user", text: "Hey" },
      { id: "streaming", role: "assistant", text: "En cours", streaming: true },
    ])
  })

  test("reducePoll : list ouvert → deltas + 400 ms", () => {
    const next = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    expect(next.intervalMs).toBe(POLL_STREAMING_MS)
    expect(next.streamArgs).toEqual({ kind: "deltas", cursors: [{ streamId: "s1", cursor: 0 }] })
    expect(next.messages).toEqual([{ id: "u1", role: "user", text: "Q" }])
  })

  test("reducePoll pose toolCalls dès un tool-input-start, sans texte", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const tooled = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [
          {
            streamId: "s1",
            start: 0,
            end: 1,
            parts: [{ type: "tool-input-start", toolName: "Make__scenarios_list" }],
          },
        ],
      },
    })
    expect(tooled.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "",
      streaming: true,
      tool: "Make__scenarios_list",
      toolCalls: ["Make__scenarios_list"],
    })
  })

  test("reducePoll fusionne les deltas dans le texte assistant", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const streamed = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 2, parts: [{ type: "text-delta", delta: "Ré" }] }],
      },
    })
    expect(streamed.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Ré",
      streaming: true,
    })
    const more = reducePoll(streamed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 2, end: 4, parts: [{ type: "text-delta", delta: "ponse" }] }],
      },
    })
    expect(more.messages.at(-1)).toMatchObject({ text: "Réponse", streaming: true })
  })

  test("reducePoll : un delta start déjà consommé revient à list", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const started = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 1, parts: [{ type: "start" }] }],
      },
    })
    expect(started.streamArgs.kind).toBe("deltas")
    const replayed = reducePoll(started, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 1, parts: [{ type: "start" }] }],
      },
    })
    expect(replayed.streamArgs).toEqual({ kind: "list" })
    expect(replayed.intervalMs).toBe(POLL_STREAMING_MS)
  })

  test("reducePoll : premier deltas vide (TTFT) garde 400 ms", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const quiet = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "deltas", deltas: [] },
    })
    expect(quiet.intervalMs).toBe(POLL_STREAMING_MS)
    expect(quiet.streamArgs).toEqual({ kind: "list" })
  })

  test("reducePoll : deltas vides gardent 400 ms et reviennent à list", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const streamed = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 2, parts: [{ type: "text-delta", delta: "Ré" }] }],
      },
    })
    const quiet = reducePoll(streamed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "deltas", deltas: [] },
    })
    expect(quiet.intervalMs).toBe(POLL_STREAMING_MS)
    expect(quiet.streamArgs).toEqual({ kind: "list" })
    expect(quiet.messages.at(-1)).toMatchObject({ text: "Ré", streaming: true })
  })

  test("reducePoll : list sans flux ouvert revient à l'idle et jette les brouillons", () => {
    const listed = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const streamed = reducePoll(listed, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 2, parts: [{ type: "text-delta", delta: "Ré" }] }],
      },
    })
    const done = reducePoll(streamed, {
      page: [
        { id: "u1", role: "user", text: "Q" },
        { id: "a1", role: "assistant", text: "Réponse" },
      ],
      streams: { kind: "list", messages: [] },
    })
    expect(done.intervalMs).toBe(POLL_IDLE_MS)
    expect(done.streamArgs).toEqual({ kind: "list" })
    expect(done.messages).toEqual([
      { id: "u1", role: "user", text: "Q" },
      { id: "a1", role: "assistant", text: "Réponse" },
    ])
  })
})

describe("fallbackIfReplyTimedOut", () => {
  test("avant 60 s : rien ; après, le repli si pas de bulle assistant", () => {
    const waiting = [{ id: "u1", role: "user" as const, text: "Q" }]
    expect(
      fallbackIfReplyTimedOut({ messages: waiting, sentAt: 0, now: 59_000 }),
    ).toBeNull()
    expect(fallbackIfReplyTimedOut({ messages: waiting, sentAt: 0, now: 60_000 })).toEqual({
      id: STREAM_FALLBACK_ID,
      role: "assistant",
      text: STREAM_FALLBACK_TEXT,
    })
  })

  test("une réponse assistant déjà là n'ajoute pas de repli", () => {
    expect(
      fallbackIfReplyTimedOut({
        messages: [
          { id: "u1", role: "user", text: "Q" },
          { id: "a1", role: "assistant", text: "Oui" },
        ],
        sentAt: 0,
        now: 90_000,
      }),
    ).toBeNull()
  })

  test("un nouveau message après une vieille réponse déclenche le repli", () => {
    expect(
      fallbackIfReplyTimedOut({
        messages: [
          { id: "u1", role: "user", text: "Q" },
          { id: "a1", role: "assistant", text: "Oui" },
          { id: "u2", role: "user", text: "Encore" },
        ],
        sentAt: 0,
        now: 60_000,
      }),
    ).toEqual({
      id: STREAM_FALLBACK_ID,
      role: "assistant",
      text: STREAM_FALLBACK_TEXT,
    })
  })
})

describe("applyVisitorSnapshot", () => {
  test("un message staff remplace la page sans casser un brouillon de stream", () => {
    const streaming = reducePoll(initialPollState(), {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: { kind: "list", messages: [{ streamId: "s1", status: "streaming" }] },
    })
    const withDraft = reducePoll(streaming, {
      page: [{ id: "u1", role: "user", text: "Q" }],
      streams: {
        kind: "deltas",
        deltas: [{ streamId: "s1", start: 0, end: 2, parts: [{ type: "text-delta", delta: "Ré" }] }],
      },
    })
    const applied = applyVisitorSnapshot(withDraft, {
      page: [
        { id: "u1", role: "user", text: "Q" },
        { id: "staff", role: "assistant", text: "Je prends le relais." },
      ],
      hasLead: true,
      staffOnline: true,
    })
    expect(applied.hasLead).toBe(true)
    expect(applied.staffOnline).toBe(true)
    expect(applied.poll.streamArgs).toEqual(withDraft.streamArgs)
    expect(applied.poll.draftByStream).toEqual(withDraft.draftByStream)
    expect(applied.poll.messages.some((message) => message.text === "Je prends le relais.")).toBe(
      true,
    )
  })
})
