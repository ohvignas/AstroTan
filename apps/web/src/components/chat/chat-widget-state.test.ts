import { describe, expect, test } from "vitest"
import {
  EMPTY_THREAD_PROMPT,
  POLL_IDLE_MS,
  POLL_STREAMING_MS,
  SESSION_STORAGE_KEY,
  attachDrafts,
  bannerForCode,
  clearSessionToken,
  fieldMessage,
  hasOpenStream,
  initialPollState,
  mergeDeltaText,
  messagesFromPage,
  nextScreen,
  pollIntervalMs,
  readSessionToken,
  reducePoll,
  writeSessionToken,
} from "./chatWidgetState"

describe("nextScreen", () => {
  test("sans token, l'écran est la gate", () => {
    expect(nextScreen({ token: null, agentEnabled: true })).toBe("gate")
  })

  test("agentEnabled false : widget caché", () => {
    expect(nextScreen({ token: "x", agentEnabled: false })).toBe("hidden")
  })

  test("token présent et agent allumé : fil", () => {
    expect(nextScreen({ token: "x", agentEnabled: true })).toBe("thread")
  })
})

describe("pollIntervalMs", () => {
  test("flux ouvert → 400 ms", () => {
    expect(pollIntervalMs({ status: "streaming" })).toBe(POLL_STREAMING_MS)
    expect(pollIntervalMs({ kind: "list", messages: [{ streamId: "s1", status: "streaming" }] })).toBe(
      POLL_STREAMING_MS,
    )
  })

  test("aucun flux → 2000 ms", () => {
    expect(pollIntervalMs(null)).toBe(POLL_IDLE_MS)
    expect(pollIntervalMs({ kind: "list", messages: [] })).toBe(POLL_IDLE_MS)
    expect(pollIntervalMs({ kind: "list", messages: [{ streamId: "s1", status: "done" }] })).toBe(
      POLL_IDLE_MS,
    )
    expect(pollIntervalMs({ kind: "deltas", deltas: [] })).toBe(POLL_IDLE_MS)
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

  test("session n'a pas de bannière — on revient à la gate", () => {
    expect(bannerForCode("session")).toBeNull()
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
      message: "Écrivez un message.",
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
    expect(store.get(SESSION_STORAGE_KEY)).toBe("jeton")
    expect(readSessionToken(storage)).toBe("jeton")
    clearSessionToken(storage)
    expect(readSessionToken(storage)).toBeNull()
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

  test("reducePoll : list sans flux ouvert revient à 2 s et jette les brouillons", () => {
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
