import { afterEach, describe, expect, test, vi } from "vitest"
import { startChat } from "./chatApi"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("startChat", () => {
  test("deux appels concurrents n'ouvrent qu'une requête", async () => {
    let finish!: (value: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const first = startChat()
    const second = startChat()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    finish(
      new Response(JSON.stringify({ token: "jeton-partage" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(first).resolves.toEqual({ ok: true, data: { token: "jeton-partage" } })
    await expect(second).resolves.toEqual({ ok: true, data: { token: "jeton-partage" } })
  })

  test("après la fin du vol, un nouvel appel refait une requête", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "un" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "deux" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(startChat()).resolves.toEqual({ ok: true, data: { token: "un" } })
    await expect(startChat()).resolves.toEqual({ ok: true, data: { token: "deux" } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
