import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  DATAFORSEO_BACKLINKS_URL,
  DATAFORSEO_LABS_URL,
  DATAFORSEO_SERP_URL,
} from "./dataforseoSerp"
import { fetchLabs, fetchOverview, fetchSerp } from "./dataforseoFetch"

const LOGIN = "login@exemple.fr"
const PASSWORD = "secret-test"

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

test("Labs : POST ranked_keywords, target + locale, items dans result[0]", async () => {
  const row = {
    keyword_data: { keyword: "agence web" },
    ranked_serp_element: { serp_item: { rank_absolute: 2, url: "https://a.fr/" } },
  }
  fetchMock.mockResolvedValue(
    jsonOk({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [row], total_count: 1 }] }],
    }),
  )
  const items = await fetchLabs({
    login: LOGIN,
    password: PASSWORD,
    target: "agence-dupont.fr",
    locationCode: 2250,
    languageCode: "fr",
  })
  expect(items).toEqual({ items: [row], totalCount: 1 })
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(DATAFORSEO_LABS_URL)
  expect(init.method).toBe("POST")
  expect(JSON.parse(String(init.body))).toEqual([
    {
      target: "agence-dupont.fr",
      location_code: 2250,
      language_code: "fr",
      limit: 50,
      load_rank_absolute: true,
    },
  ])
  expect(JSON.parse(String(init.body))[0]).not.toHaveProperty("item_types")
})

test("Backlinks : POST summary/live, pas overview ; target seul", async () => {
  fetchMock.mockResolvedValue(
    jsonOk({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ backlinks: 3, referring_domains: 1 }] }],
    }),
  )
  const body = await fetchOverview({
    login: LOGIN,
    password: PASSWORD,
    target: "agence-dupont.fr",
  })
  expect(body).not.toBeNull()
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(DATAFORSEO_BACKLINKS_URL)
  expect(url).not.toContain("/overview/")
  expect(JSON.parse(String(init.body))).toEqual([{ target: "agence-dupont.fr" }])
})

test("SERP : POST organic/live/advanced avec depth et stop_crawl_on_match", async () => {
  fetchMock.mockResolvedValue(
    jsonOk({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [{ type: "organic" }] }] }],
    }),
  )
  const items = await fetchSerp({
    login: LOGIN,
    password: PASSWORD,
    keyword: "agence web lyon",
    locationCode: 1006094,
    languageCode: "fr",
    matchValue: "agence-dupont.fr/contact",
  })
  expect(items).toHaveLength(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(DATAFORSEO_SERP_URL)
  const payload = JSON.parse(String(init.body))[0]
  expect(payload).toMatchObject({
    keyword: "agence web lyon",
    location_code: 1006094,
    language_code: "fr",
    device: "desktop",
    depth: 100,
    find_targets_in: ["organic"],
  })
  expect(payload.stop_crawl_on_match).toEqual([
    { match_value: "agence-dupont.fr/contact", match_type: "wildcard" },
  ])
})

test("40100 / 40201 / 40400 / HTTP 402 : null, pas un tableau vide", async () => {
  for (const corps of [{ status_code: 40100 }, { status_code: 40201 }, { status_code: 40400 }]) {
    fetchMock.mockResolvedValueOnce(jsonOk(corps))
    expect(
      await fetchLabs({
        login: LOGIN,
        password: PASSWORD,
        target: "exemple.fr",
        locationCode: 2250,
        languageCode: "fr",
      }),
    ).toBeNull()
  }
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
  expect(
    await fetchOverview({ login: LOGIN, password: PASSWORD, target: "exemple.fr" }),
  ).toBeNull()
})
