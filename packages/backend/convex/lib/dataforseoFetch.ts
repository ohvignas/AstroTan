import { authorizationHeader, DATAFORSEO_TIMEOUT_MS } from "./dataforseo"
import {
  DATAFORSEO_BACKLINKS_URL,
  DATAFORSEO_LABS_URL,
  DATAFORSEO_SERP_TIMEOUT_MS,
  DATAFORSEO_SERP_URL,
  SERP_DEPTH,
} from "./dataforseoSerp"

async function postJson(
  url: string,
  login: string,
  password: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; body: unknown }> {
  try {
    const reponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader(login, password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let body: unknown = null
    try {
      body = await reponse.json()
    } catch {
      // statut HTTP suffit
    }
    return { ok: reponse.ok, body }
  } catch {
    return { ok: false, body: null }
  }
}

function tasksResult(body: unknown): unknown[] {
  const tasks = (body as { tasks?: { result?: unknown[] }[] } | null)?.tasks
  return tasks?.[0]?.result ?? []
}

export async function fetchSerp(args: {
  login: string
  password: string
  keyword: string
  locationCode: number
  languageCode: string
  matchValue: string
}): Promise<unknown[] | null> {
  const { ok, body } = await postJson(
    DATAFORSEO_SERP_URL,
    args.login,
    args.password,
    [
      {
        keyword: args.keyword,
        location_code: args.locationCode,
        language_code: args.languageCode,
        device: "desktop",
        depth: SERP_DEPTH,
        stop_crawl_on_match: [{ match_value: args.matchValue, match_type: "wildcard" }],
        find_targets_in: ["organic"],
      },
    ],
    DATAFORSEO_SERP_TIMEOUT_MS,
  )
  if (!ok) return null
  const result = tasksResult(body)[0] as { items?: unknown[] } | undefined
  return result?.items ?? []
}

export async function fetchLabs(args: {
  login: string
  password: string
  target: string
  locationCode: number
  languageCode: string
}): Promise<unknown[] | null> {
  const { ok, body } = await postJson(
    DATAFORSEO_LABS_URL,
    args.login,
    args.password,
    [
      {
        target: args.target,
        location_code: args.locationCode,
        language_code: args.languageCode,
        limit: 50,
      },
    ],
    DATAFORSEO_TIMEOUT_MS,
  )
  if (!ok) return null
  return tasksResult(body)
}

export async function fetchOverview(args: {
  login: string
  password: string
  target: string
}): Promise<unknown | null> {
  const { ok, body } = await postJson(
    DATAFORSEO_BACKLINKS_URL,
    args.login,
    args.password,
    [{ target: args.target }],
    DATAFORSEO_TIMEOUT_MS,
  )
  return ok ? body : null
}
