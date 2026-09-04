/** GET documenté, coût 0 — sert uniquement à juger les identifiants. */
export const DATAFORSEO_USER_DATA_URL =
  "https://api.dataforseo.com/v3/appendix/user_data"

/** 8 s, la même borne que les autres appels sortants du dépôt. */
export const DATAFORSEO_TIMEOUT_MS = 8_000

export type DataForSeoIssue = "valide" | "refuse" | "injoignable"

export function authorizationHeader(login: string, password: string): string {
  return `Basic ${btoa(`${login}:${password}`)}`
}

/**
 * DataForSEO rend souvent HTTP 200 même pour un refus : le verdict
 * est dans `status_code` (20000 = ok, 40100 = non autorisé).
 */
export function interpretDataForSeo(
  status: number,
  body: unknown,
): DataForSeoIssue {
  if (status === 429 || status >= 500) return "injoignable"
  if (status === 401 || status === 403) return "refuse"
  const code = (body as { status_code?: unknown } | null)?.status_code
  if (typeof code === "number" && code >= 50000) return "injoignable"
  if (status === 200 && code === 20000) return "valide"
  return "refuse"
}

/**
 * DataForSEO répond souvent HTTP 200 avec `status_code` 40100 / 40201 / 40400.
 * Traiter ça comme un succès écrivait un faux zéro (parse vide ≠ 0 réel).
 */
export function isDataForSeoSuccess(httpOk: boolean, body: unknown): boolean {
  if (!httpOk) return false
  const envelope = body as {
    status_code?: unknown
    tasks?: { status_code?: unknown }[]
  } | null
  const top = envelope?.status_code
  if (typeof top === "number" && top !== 20000) return false
  const task = envelope?.tasks?.[0]?.status_code
  if (typeof task === "number" && task !== 20000) return false
  return true
}

export async function pingDataForSeo(
  login: string,
  password: string,
): Promise<DataForSeoIssue> {
  try {
    const reponse = await fetch(DATAFORSEO_USER_DATA_URL, {
      headers: { Authorization: authorizationHeader(login, password) },
      signal: AbortSignal.timeout(DATAFORSEO_TIMEOUT_MS),
    })
    let corps: unknown = null
    try {
      corps = await reponse.json()
    } catch {
      // Un corps vide ou non-JSON n'est pas une panne : le statut HTTP suffit.
    }
    return interpretDataForSeo(reponse.status, corps)
  } catch {
    return "injoignable"
  }
}
