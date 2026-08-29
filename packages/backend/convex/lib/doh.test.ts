import { describe, expect, test, vi } from "vitest"
import { lireReponse, resoudre, urlRequete } from "./doh"

describe("urlRequete", () => {
  test("demande du JSON au résolveur, sur le nom et le type donnés", () => {
    const url = new URL(urlRequete("exemple.fr", "TXT"))
    expect(url.origin).toBe("https://cloudflare-dns.com")
    expect(url.searchParams.get("name")).toBe("exemple.fr")
    expect(url.searchParams.get("type")).toBe("TXT")
  })

  test("refuse un nom qui n'est pas un hôte, plutôt que de l'envoyer", () => {
    // Le nom part dans une URL vers un tiers. Une valeur non validée y
    // ferait passer des paramètres de requête supplémentaires.
    expect(() => urlRequete("exemple.fr&name=autre.fr", "A")).toThrow()
  })
})

describe("lireReponse", () => {
  test("Status 0 avec des réponses rend les valeurs", () => {
    expect(lireReponse({ Status: 0, Answer: [{ data: "203.0.113.7" }] })).toEqual({
      statut: "ok",
      valeurs: ["203.0.113.7"],
    })
  })

  test("Status 3 (NXDOMAIN) est « absent », pas une erreur", () => {
    // La différence porte tout l'écran : « le domaine n'existe pas encore »
    // appelle une instruction à suivre, « le résolveur n'a pas répondu »
    // appelle un nouvel essai. Les confondre ferait dire à l'écran de
    // créer un enregistrement qui existe déjà.
    expect(lireReponse({ Status: 3 })).toEqual({ statut: "absent" })
  })

  test("Status 0 sans réponse est « absent »", () => {
    expect(lireReponse({ Status: 0, Answer: [] })).toEqual({ statut: "absent" })
  })

  test("retire les guillemets que le résolveur met autour d'un TXT", () => {
    // Un TXT SPF revient `"v=spf1 include:amazonses.com ~all"`, guillemets
    // compris. Comparer sans les retirer ne trouve jamais `v=spf1`.
    expect(
      lireReponse({ Status: 0, Answer: [{ data: '"v=spf1 include:x ~all"' }] }),
    ).toEqual({ statut: "ok", valeurs: ["v=spf1 include:x ~all"] })
  })

  test("une charge inattendue est une erreur nommée, jamais une exception", () => {
    expect(lireReponse(null)).toEqual({
      statut: "erreur",
      raison: "Réponse illisible du résolveur DNS.",
    })
  })
})

describe("resoudre", () => {
  test("un résolveur injoignable rend une erreur, jamais une exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom") }))
    await expect(resoudre("exemple.fr", "A")).resolves.toEqual({
      statut: "erreur",
      raison: "Le résolveur DNS est injoignable.",
    })
    vi.unstubAllGlobals()
  })

  test("un statut HTTP non 200 rend une erreur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })))
    await expect(resoudre("exemple.fr", "A")).resolves.toMatchObject({
      statut: "erreur",
    })
    vi.unstubAllGlobals()
  })
})
