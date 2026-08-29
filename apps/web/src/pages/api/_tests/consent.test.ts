// Vit sous `_tests/` pour la même raison mécanique que
// `revalidate.test.ts` : un `.ts` posé directement dans `src/pages/**`
// devient une route Astro. Voir son en-tête pour le détail.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

// `getConvexClient().mutation(...)` est la seule sortie réseau de cette
// route : la simuler permet de vérifier CE QUE la route envoie à Convex —
// en particulier l'empreinte d'origine — sans dépendre d'un déploiement
// réel, comme `middleware.test.ts` le fait déjà pour `getConvexClient`.
const mutation = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ mutation }),
}))

let POST: typeof import("../consent").POST

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"

const VALID_BODY = {
  consentVersion: "1.0.0",
  visitorId: "visiteur-1",
  consentId: "geste-1",
  action: "custom",
  timestamp: "2026-08-29T10:00:00.000Z",
  analytics: true,
  marketing: false,
  preferences: false,
}

function fakeContext(options: {
  body?: unknown
  clientAddress?: string
}): APIContext {
  const { body, clientAddress = "203.0.113.42" } = options
  const request = new Request("http://localhost/api/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { request, clientAddress } as unknown as APIContext
}

/**
 * La même empreinte que la route doit produire : `sha-256(adresse|secret)`.
 * Recalculée ici plutôt que réimportée, pour que le test prouve que la
 * route hache réellement CETTE construction — pas seulement qu'elle
 * renvoie une chaîne qui en a la forme.
 */
async function empreinteAttendue(adresse: string, secret: string): Promise<string> {
  const octets = new TextEncoder().encode(`${adresse}|${secret}`)
  const digest = await crypto.subtle.digest("SHA-256", octets)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

let originalEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  vi.resetModules()
  mutation.mockReset()
  mutation.mockResolvedValue(null)
  originalEnv = { ...process.env }
  process.env.CONSENT_LOG_SECRET = SECRET
  const mod = await import("../consent")
  POST = mod.POST
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe("POST /api/consent", () => {
  test("un enregistrement valide envoie l'empreinte de l'adresse, jamais l'adresse", async () => {
    const response = await POST(fakeContext({ body: VALID_BODY, clientAddress: "203.0.113.42" }))

    expect(response.status).toBe(204)
    expect(mutation).toHaveBeenCalledTimes(1)
    const [, args] = mutation.mock.calls[0] as [unknown, Record<string, unknown>]

    expect(args.origin).toBe(await empreinteAttendue("203.0.113.42", SECRET))
    // L'adresse en clair n'apparaît nulle part dans ce qui part vers Convex.
    expect(JSON.stringify(args)).not.toContain("203.0.113.42")
    expect(args.consentId).toBe("geste-1")
  })

  test("deux adresses différentes produisent deux empreintes différentes", async () => {
    await POST(fakeContext({ body: VALID_BODY, clientAddress: "203.0.113.42" }))
    await POST(fakeContext({ body: { ...VALID_BODY, consentId: "geste-2" }, clientAddress: "198.51.100.7" }))

    const [, premier] = mutation.mock.calls[0] as [unknown, Record<string, unknown>]
    const [, second] = mutation.mock.calls[1] as [unknown, Record<string, unknown>]
    expect(premier.origin).not.toBe(second.origin)
  })

  test("sans secret configuré, la route répond 204 et n'appelle jamais Convex", async () => {
    delete process.env.CONSENT_LOG_SECRET
    vi.resetModules()
    const mod = await import("../consent")

    const response = await mod.POST(fakeContext({ body: VALID_BODY }))

    expect(response.status).toBe(204)
    expect(mutation).not.toHaveBeenCalled()
  })

  test("un corps malformé répond 204 sans appeler Convex", async () => {
    const response = await POST(fakeContext({ body: { consentId: "geste-1" } }))

    expect(response.status).toBe(204)
    expect(mutation).not.toHaveBeenCalled()
  })

  test("un refus de Convex (par exemple RATE_LIMITED) répond quand même 204", async () => {
    // Le choix de la personne est déjà appliqué et stocké dans son
    // navigateur ; le journal est notre obligation, pas la sienne — voir
    // l'en-tête de `consent.ts`.
    mutation.mockRejectedValueOnce(new Error("RATE_LIMITED"))

    const response = await POST(fakeContext({ body: VALID_BODY }))

    expect(response.status).toBe(204)
  })
})
