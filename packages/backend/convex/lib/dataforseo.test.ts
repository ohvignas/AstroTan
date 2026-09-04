import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  DATAFORSEO_USER_DATA_URL,
  authorizationHeader,
  interpretDataForSeo,
  isDataForSeoSuccess,
  pingDataForSeo,
} from "./dataforseo"

const LOGIN = "login@exemple.fr"
const PASSWORD = "mot-de-passe-qui-ne-doit-jamais-ressortir"

describe("authorizationHeader", () => {
  test("Basic + base64(login:password)", () => {
    expect(authorizationHeader(LOGIN, PASSWORD)).toBe(
      `Basic ${btoa(`${LOGIN}:${PASSWORD}`)}`,
    )
  })
})

describe("interpretDataForSeo", () => {
  test("200 + 20000 : identifiants valides", () => {
    expect(interpretDataForSeo(200, { status_code: 20000 })).toBe("valide")
  })

  test("200 + 40100 : refusés", () => {
    expect(interpretDataForSeo(200, { status_code: 40100 })).toBe("refuse")
  })

  test("401 et 403 HTTP : refusés", () => {
    expect(interpretDataForSeo(401, {})).toBe("refuse")
    expect(interpretDataForSeo(403, {})).toBe("refuse")
  })

  test("429 et 5xx : injoignable, jamais refuse", () => {
    expect(interpretDataForSeo(429, {})).toBe("injoignable")
    expect(interpretDataForSeo(500, {})).toBe("injoignable")
    expect(interpretDataForSeo(200, { status_code: 50000 })).toBe("injoignable")
  })

  test("402 HTTP et 40201 : refuse (fonds), pas valide", () => {
    expect(interpretDataForSeo(402, {})).toBe("refuse")
    expect(interpretDataForSeo(200, { status_code: 40201 })).toBe("refuse")
  })
})

describe("isDataForSeoSuccess", () => {
  test("HTTP 200 + 20000 : succès, même sans status_code (stubs)", () => {
    expect(isDataForSeoSuccess(true, { status_code: 20000 })).toBe(true)
    expect(isDataForSeoSuccess(true, { tasks: [{ result: [] }] })).toBe(true)
  })

  test("200 + 40100 / 40201 / 40400 : pas un zéro, un échec", () => {
    expect(isDataForSeoSuccess(true, { status_code: 40100 })).toBe(false)
    expect(isDataForSeoSuccess(true, { status_code: 40201 })).toBe(false)
    expect(isDataForSeoSuccess(true, { status_code: 40400 })).toBe(false)
    expect(
      isDataForSeoSuccess(true, {
        status_code: 20000,
        tasks: [{ status_code: 40100, result: [] }],
      }),
    ).toBe(false)
  })

  test("HTTP 401 / 402 / 404 : échec même si le corps ment", () => {
    expect(isDataForSeoSuccess(false, { status_code: 20000 })).toBe(false)
  })
})

describe("pingDataForSeo", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("GET user_data, Basic auth, borne de temps", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status_code: 20000 }), { status: 200 }),
    )
    await expect(pingDataForSeo(LOGIN, PASSWORD)).resolves.toBe("valide")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DATAFORSEO_USER_DATA_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe(
      authorizationHeader(LOGIN, PASSWORD),
    )
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test("un fetch qui lève rend injoignable, sans le mot de passe", async () => {
    fetchMock.mockRejectedValue(new TypeError("network unreachable"))
    const issue = await pingDataForSeo(LOGIN, PASSWORD)
    expect(issue).toBe("injoignable")
    expect(issue).not.toContain(PASSWORD)
  })
})
