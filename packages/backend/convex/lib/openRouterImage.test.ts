import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { OPENROUTER_IMAGES_URL, genererImage } from "./openRouterImage"

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test("poste vers /api/v1/images et décode le PNG", async () => {
  const fetchMock = vi.mocked(fetch)
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [{ b64_json: PNG_B64, media_type: "image/png" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  )
  const image = await genererImage({
    apiKey: "sk-or-test",
    model: "google/gemini-3-pro-image",
    prompt: "une vitrine",
  })
  expect(image.mime).toBe("image/png")
  expect(image.bytes.length).toBeGreaterThan(20)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(OPENROUTER_IMAGES_URL)
  const body = JSON.parse(String(init.body)) as {
    model: string
    aspect_ratio: string
    resolution?: string
    output_format?: string
  }
  expect(body.model).toBe("google/gemini-3-pro-image")
  expect(body.aspect_ratio).toBe("16:9")
  expect(body.resolution).toBe("1K")
  expect(body.output_format).toBeUndefined()
})

test("2.5-flash : 16:9 sans resolution ni output_format", async () => {
  const fetchMock = vi.mocked(fetch)
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [{ b64_json: PNG_B64, media_type: "image/png" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  )
  await genererImage({
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash-image",
    prompt: "une vitrine",
  })
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  const body = JSON.parse(String(init.body)) as {
    aspect_ratio: string
    resolution?: string
    output_format?: string
  }
  expect(body.aspect_ratio).toBe("16:9")
  expect(body.resolution).toBeUndefined()
  expect(body.output_format).toBeUndefined()
})

test("un corps sans image devient OPENROUTER_BAD_IMAGE", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 }),
  )
  await expect(
    genererImage({
      apiKey: "sk-or-test",
      model: "google/gemini-3-pro-image",
      prompt: "x",
    }),
  ).rejects.toMatchObject({ data: { code: "OPENROUTER_BAD_IMAGE" } })
})
