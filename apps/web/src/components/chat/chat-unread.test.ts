import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ChatWidget } from "./ChatWidget"
import {
  readSeenStaffIds,
  staffMessageIds,
  staffUnreadCount,
  unreadNotice,
  unreadPastille,
  unreadSrLabel,
  writeSeenStaffIds,
} from "./chatUnread"
import { SEEN_STAFF_KEY, type DisplayedMessage, type StorageLike } from "./chatWidgetState"

function memoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

const thread: DisplayedMessage[] = [
  { id: "u1", role: "user", text: "Bonjour" },
  { id: "a1", role: "assistant", text: "Oui ?" },
  { id: "a2", role: "assistant", text: "Voici la suite" },
]

describe("staffUnreadCount", () => {
  test("ouvert ou pas encore figé → 0", () => {
    expect(staffUnreadCount(thread, [], true)).toBe(0)
    expect(staffUnreadCount(thread, null, false)).toBe(0)
  })

  test("compte les assistant absents du dernier vu, jamais un 1 fixe", () => {
    expect(staffUnreadCount(thread, ["a1"], false)).toBe(1)
    expect(staffUnreadCount(thread, [], false)).toBe(2)
    expect(staffUnreadCount(thread, ["a1", "a2"], false)).toBe(0)
  })

  test("ignore un brouillon en stream et un assistant vide", () => {
    expect(
      staffMessageIds([
        { id: "a0", role: "assistant", text: "   " },
        { id: "a1", role: "assistant", text: "He", streaming: true },
        { id: "a2", role: "assistant", text: "OK" },
      ]),
    ).toEqual(["a2"])
  })
})

describe("libellés", () => {
  test("notice et pastille comme la cloche (9+)", () => {
    expect(unreadNotice(0)).toBeNull()
    expect(unreadNotice(1)).toBe("Nouveau message !")
    expect(unreadNotice(3)).toBe("Nouveaux messages !")
    expect(unreadPastille(0)).toBeNull()
    expect(unreadPastille(1)).toBe("1")
    expect(unreadPastille(12)).toBe("9+")
    expect(unreadSrLabel(0)).toBe("Aide")
    expect(unreadSrLabel(1)).toBe("1 message non lu")
    expect(unreadSrLabel(3)).toBe("3 messages non lus")
    expect(unreadSrLabel(12)).toBe("9+ messages non lus")
  })
})

describe("sessionStorage des ids vus", () => {
  test("lu / écrit / lié au jeton", () => {
    const storage = memoryStorage()
    expect(readSeenStaffIds(storage, "abc")).toBeNull()
    writeSeenStaffIds(storage, "abc", ["a1"])
    expect(readSeenStaffIds(storage, "abc")).toEqual(["a1"])
    expect(readSeenStaffIds(storage, "autre")).toBeNull()
    expect(storage.store.get(SEEN_STAFF_KEY)).toContain("a1")
  })
})

function renderFab(
  unreadCount: number,
  messages: DisplayedMessage[] = [],
  hasOpened = false,
) {
  return renderToStaticMarkup(
    createElement(ChatWidget, {
      open: false,
      onOpenChange: () => undefined,
      avatarUrl: "/a.png",
      teaser: "Une question ? Je suis à votre écoute",
      unreadCount,
      hasOpened,
      onReset: () => undefined,
      messages,
      body: "",
      bodyError: null,
      onBodyChange: () => undefined,
      onSubmit: () => undefined,
    }),
  )
}

describe("teaser remplacé, pas édité", () => {
  test("sans non-lus, le teaser Identité reste", () => {
    const html = renderFab(0)
    expect(html).toContain("Une question ? Je suis à votre écoute")
    expect(html).not.toContain("Nouveau message !")
    expect(html).not.toContain("data-unread")
    expect(html).not.toContain("data-slot=\"chat-unread\"")
  })

  test("avec non-lus, notice + pastille, teaser masqué", () => {
    const html = renderFab(2)
    expect(html).toContain("Nouveaux messages !")
    expect(html).toContain("data-unread")
    expect(html).toContain("data-slot=\"chat-unread\"")
    expect(html).toContain("2")
    expect(html).not.toContain("Une question ? Je suis à votre écoute")
  })

  test("déjà ouvert, même sans message : pas de teaser Identité", () => {
    const html = renderFab(0, [], true)
    expect(html).not.toContain("Une question ? Je suis à votre écoute")
    expect(html).not.toContain("Nouveau message !")
  })

  test("fil déjà commencé : pas de teaser Identité, les non-lus restent", () => {
    const written = renderFab(0, [{ id: "u1", role: "user", text: "Bonjour" }])
    expect(written).not.toContain("Une question ? Je suis à votre écoute")
    expect(written).not.toContain("Nouveau message !")
    expect(written).not.toContain("data-slot=\"chat-unread\"")

    const unread = renderFab(1, [
      { id: "u1", role: "user", text: "Bonjour" },
      { id: "a1", role: "assistant", text: "Oui ?" },
    ])
    expect(unread).toContain("Nouveau message !")
    expect(unread).toContain("data-slot=\"chat-unread\"")
    expect(unread).not.toContain("Une question ? Je suis à votre écoute")
  })

  test("widget ouvert : pas de pastille, le teaser Identité n'est pas muté", () => {
    const html = renderToStaticMarkup(
      createElement(ChatWidget, {
        open: true,
        onOpenChange: () => undefined,
        avatarUrl: "/a.png",
        teaser: "Une question ? Je suis à votre écoute",
        unreadCount: 3,
        onReset: () => undefined,
        messages: [],
        body: "",
        bodyError: null,
        onBodyChange: () => undefined,
        onSubmit: () => undefined,
      }),
    )
    expect(html).not.toContain("data-slot=\"chat-unread\"")
    expect(html).not.toContain("Nouveaux messages !")
    expect(html).not.toContain("Une question ? Je suis à votre écoute")
  })
})
