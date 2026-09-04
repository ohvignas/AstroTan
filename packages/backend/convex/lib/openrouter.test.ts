import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  OPENROUTER_CHAT_URL,
  OPENROUTER_KEY_URL,
  completerJson,
  extractMessageContent,
  interpretOpenRouterStatus,
  pingOpenRouter,
} from "./openrouter"

describe("interpretOpenRouterStatus", () => {
  test("401 et 403 sont un refus de clé", () => {
    expect(interpretOpenRouterStatus(401)).toBe("OPENROUTER_REFUSED")
    expect(interpretOpenRouterStatus(403)).toBe("OPENROUTER_REFUSED")
  })

  test("429 et 5xx sont une indisponibilité", () => {
    expect(interpretOpenRouterStatus(429)).toBe("OPENROUTER_UNAVAILABLE")
    expect(interpretOpenRouterStatus(503)).toBe("OPENROUTER_UNAVAILABLE")
  })

  test("200 n'est pas une erreur", () => {
    expect(interpretOpenRouterStatus(200)).toBeNull()
  })
})

describe("extractMessageContent", () => {
  test("lit choices[0].message.content", () => {
    expect(
      extractMessageContent({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    ).toBe('{"ok":true}')
  })

  test("refuse un corps sans message", () => {
    expect(() => extractMessageContent({})).toThrow(/OPENROUTER_BAD_RESPONSE/)
  })

  test("lit un content en parties (flagships verbeux)", () => {
    expect(
      extractMessageContent({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "```json\n" },
                { type: "text", text: '{"seoTitle":"Ok"}' },
                { type: "text", text: "\n```" },
              ],
            },
          },
        ],
      }),
    ).toContain("seoTitle")
  })
})

describe("completerJson", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("poste vers OpenRouter et parse le JSON du message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"seoTitle":"Bonjour"}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const parsed = await completerJson({
      apiKey: "sk-or-test",
      system: "sys",
      user: "user",
      model: "anthropic/claude-sonnet-4",
    })
    expect(parsed).toEqual({ seoTitle: "Bonjour" })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(OPENROUTER_CHAT_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-or-test",
    )
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown }
    expect(body.model).toBe("anthropic/claude-sonnet-4")
    expect(JSON.stringify(body.messages)).not.toContain("sk-or-test")
  })

  test("accepte un JSON fencé avec préambule", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Voici :\n```json\n{"seoTitle":"Fencé"}\n```\n',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(
      completerJson({
        apiKey: "sk-or-test",
        system: "s",
        user: "u",
        model: "x-ai/grok-4.6",
      }),
    ).resolves.toEqual({ seoTitle: "Fencé" })
  })

  test("une réponse sale (fence, objet imbriqué, parts) ne throw plus parse", async () => {
    const envelope = {
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "Voici :\n```json\n" },
              {
                type: "text",
                text: '{"seo":{"title":"Imbriqué"},"geo":{"summary":"Ok"}}',
              },
              { type: "text", text: "\n```\n" },
            ],
          },
        },
      ],
    }
    fetchMock.mockResolvedValue(
      new Response(`data: ${JSON.stringify(envelope)}\n\ndata: [DONE]\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const parsed = await completerJson({
      apiKey: "sk-or-ne-doit-pas-fuiter",
      system: "s",
      user: "u",
      model: "x-ai/grok-4.6",
    })
    expect(parsed).toEqual({
      seo: { title: "Imbriqué" },
      geo: { summary: "Ok" },
    })
    expect(JSON.stringify(parsed)).not.toContain("sk-or-ne-doit-pas-fuiter")
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as {
      response_format?: { type?: string }
    }
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  test("un 401 devient OPENROUTER_REFUSED, sans fuiter le corps", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "sk-or-secret" } }), {
        status: 401,
      }),
    )
    await expect(
      completerJson({
        apiKey: "sk-or-secret",
        system: "s",
        user: "u",
        model: "openai/gpt-4o-mini",
      }),
    ).rejects.toMatchObject({ data: { code: "OPENROUTER_REFUSED" } })
  })
})

describe("pingOpenRouter", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("GET /api/v1/key, authentifié, avec une borne de temps", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }))
    await expect(pingOpenRouter("sk-or-test")).resolves.toBe("valide")
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(OPENROUTER_KEY_URL)
    expect(url).toBe("https://openrouter.ai/api/v1/key")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-or-test",
    )
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test("401 et 403 sont un refus, 429 et 5xx une indisponibilité", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }))
    await expect(pingOpenRouter("sk-or-mauvaise")).resolves.toBe("refuse")
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }))
    await expect(pingOpenRouter("sk-or-mauvaise")).resolves.toBe("refuse")
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }))
    await expect(pingOpenRouter("sk-or-ok")).resolves.toBe("injoignable")
  })

  test("un fetch qui lève rend injoignable, sans fuiter la clé", async () => {
    fetchMock.mockRejectedValue(new TypeError("sk-or-secret network"))
    const issue = await pingOpenRouter("sk-or-secret")
    expect(issue).toBe("injoignable")
    expect(JSON.stringify(issue)).not.toContain("sk-or-secret")
  })
})
