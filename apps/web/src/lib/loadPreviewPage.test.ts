import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { loadPreviewPage } from "./loadPreviewPage"

const TEST_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
const TTL_MS = 15 * 60 * 1000

function signTestToken(type: string, id: string, expiresAt: number, secret = TEST_SECRET): string {
  const message = `${type}:${id}:${expiresAt}`
  const signature = createHmac("sha256", secret).update(message).digest("hex")
  return `${expiresAt}.${signature}`
}

// `getConvexClient` (`./convexClient.ts`) is the only thing standing
// between `loadPreviewPage` and a real network call to Convex. Mocking it
// here — rather than pointing this suite at a live Convex deployment —
// is what lets the assertions below prove the *structural* half of this
// task's brief ("verify the HMAC and the expiration before any network
// call"): every test whose token or type is wrong asserts `query` was
// never invoked at all, not merely that the eventual result was `null`.
// (Real end-to-end verification against the running Convex + Astro dev
// servers is done separately, by hand, per this task's own "verify by
// driving it" instruction.)
const queryMock = vi.fn()
vi.mock("./convexClient", () => ({
  getConvexClient: () => ({ query: queryMock }),
}))

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.PREVIEW_SECRET = TEST_SECRET
  queryMock.mockReset()
})

afterEach(() => {
  process.env = originalEnv
})

describe("loadPreviewPage", () => {
  test("un jeton valide pour le bon id appelle previewPage une fois et retourne son résultat", async () => {
    const page = { title: "Draft title", seo: undefined, blocks: [] }
    queryMock.mockResolvedValueOnce(page)
    const expiresAt = Date.now() + TTL_MS
    const token = signTestToken("page", "page_1", expiresAt)

    const result = await loadPreviewPage({ type: "page", id: "page_1", token })

    expect(result).toBe(page)
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock).toHaveBeenCalledWith(expect.anything(), { id: "page_1", token })
  })

  test("un type non reconnu est refusé sans jamais appeler Convex", async () => {
    const expiresAt = Date.now() + TTL_MS
    // Even a token genuinely signed for "post" is irrelevant — this app
    // has no wiring for any type but "page".
    const token = signTestToken("post", "id_1", expiresAt)

    const result = await loadPreviewPage({ type: "post", id: "id_1", token })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("un id manquant est refusé sans jamais appeler Convex", async () => {
    const expiresAt = Date.now() + TTL_MS
    const token = signTestToken("page", "page_1", expiresAt)

    const result = await loadPreviewPage({ type: "page", id: undefined, token })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("un jeton absent (null) est refusé sans jamais appeler Convex", async () => {
    const result = await loadPreviewPage({ type: "page", id: "page_1", token: null })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("un jeton expiré est refusé sans jamais appeler Convex", async () => {
    const expiredToken = signTestToken("page", "page_1", Date.now() - 1)

    const result = await loadPreviewPage({ type: "page", id: "page_1", token: expiredToken })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("un jeton altéré est refusé sans jamais appeler Convex", async () => {
    const expiresAt = Date.now() + TTL_MS
    const token = signTestToken("page", "page_1", expiresAt)
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0")

    const result = await loadPreviewPage({ type: "page", id: "page_1", token: tampered })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("un jeton émis pour la page A est refusé sur la page B, sans jamais appeler Convex", async () => {
    const expiresAt = Date.now() + TTL_MS
    const tokenForA = signTestToken("page", "page_A", expiresAt)

    const result = await loadPreviewPage({ type: "page", id: "page_B", token: tokenForA })

    expect(result).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  test("barrière 1 passée mais Convex refuse (second contrôle indépendant) -> null", async () => {
    queryMock.mockRejectedValueOnce(new Error("INVALID_PREVIEW_TOKEN"))
    const expiresAt = Date.now() + TTL_MS
    const token = signTestToken("page", "page_1", expiresAt)

    const result = await loadPreviewPage({ type: "page", id: "page_1", token })

    expect(result).toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(1) // barrier 2 really was reached and really did run
  })

  test("barrière 1 passée mais Convex ne trouve rien (id inconnu) -> null", async () => {
    queryMock.mockResolvedValueOnce(null)
    const expiresAt = Date.now() + TTL_MS
    const token = signTestToken("page", "unknown_id", expiresAt)

    const result = await loadPreviewPage({ type: "page", id: "unknown_id", token })

    expect(result).toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
