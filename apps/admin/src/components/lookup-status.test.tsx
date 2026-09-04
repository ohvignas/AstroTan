import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  StatutLookup,
  erreurLookup,
  preuveLookup,
  statutDuLookup,
} from "./lookup-status"

function texte(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

describe("preuveLookup", () => {
  test("l'heure et le compte Cloudflare prouvent que ça a cherché", () => {
    const a = Date.parse("2026-09-01T02:04:00+02:00")
    expect(preuveLookup(a, 2)).toMatch(
      /^Vérifié à \d{2}:\d{2} · Cloudflare : 2 enregistrements$/,
    )
    expect(preuveLookup(a, 0)).toMatch(
      /^Vérifié à \d{2}:\d{2} · Cloudflare : 0 enregistrement$/,
    )
    expect(preuveLookup(a, 1)).toMatch(
      /^Vérifié à \d{2}:\d{2} · Cloudflare : 1 enregistrement$/,
    )
  })
})

describe("erreurLookup", () => {
  test("chaque panne a sa raison, pas un silence", () => {
    expect(
      erreurLookup({
        erreur: null,
        raisonsIndispo: ["Délai dépassé — Cloudflare n'a pas répondu."],
        apexNxdomain: false,
      }),
    ).toBe("Délai dépassé — Cloudflare n'a pas répondu.")
    expect(
      erreurLookup({
        erreur: null,
        raisonsIndispo: ["Réseau : le résolveur est injoignable."],
        apexNxdomain: false,
      }),
    ).toBe("Réseau : le résolveur est injoignable.")
    expect(
      erreurLookup({
        erreur: null,
        raisonsIndispo: [],
        apexNxdomain: true,
      }),
    ).toBe("Ce nom n'existe pas (NXDOMAIN).")
    expect(
      erreurLookup({
        erreur: null,
        raisonsIndispo: ["Pas de réponse du résolveur DNS."],
        apexNxdomain: false,
      }),
    ).toBe("Pas de réponse du résolveur DNS.")
    expect(
      erreurLookup({
        erreur: "Le résolveur DNS a répondu 503.",
        raisonsIndispo: [],
        apexNxdomain: false,
      }),
    ).toBe("Le résolveur DNS a répondu 503.")
  })

  test("sans panne, rien", () => {
    expect(
      erreurLookup({ erreur: null, raisonsIndispo: [], apexNxdomain: false }),
    ).toBeNull()
  })
})

describe("StatutLookup", () => {
  test("pendant le lookup : spinner et « Lecture du DNS… », visibles hors du bouton", () => {
    const html = renderToStaticMarkup(
      <StatutLookup enCours preuve={null} erreur={null} />,
    )
    expect(html).toContain('data-testid="lookup-pending"')
    expect(html).toContain("animate-spin")
    expect(texte(html)).toContain("Lecture du DNS…")
    expect(html).not.toContain("lookup-preuve")
    expect(html).not.toContain("lookup-erreur")
  })

  test("après : un texte discret prouve que ça a cherché", () => {
    const html = renderToStaticMarkup(
      <StatutLookup
        enCours={false}
        preuve="Vérifié à 02:04 · Cloudflare : 2 enregistrements"
        erreur={null}
      />,
    )
    expect(html).toContain('data-testid="lookup-preuve"')
    expect(texte(html)).toContain("Vérifié à 02:04")
    expect(texte(html)).toContain("Cloudflare : 2 enregistrements")
    expect(html).not.toContain("lookup-pending")
  })

  test("une erreur dit pourquoi, pas seulement que ça a échoué", () => {
    const html = renderToStaticMarkup(
      <StatutLookup
        enCours={false}
        preuve={null}
        erreur="Délai dépassé — Cloudflare n'a pas répondu."
      />,
    )
    expect(html).toContain('data-testid="lookup-erreur"')
    expect(texte(html)).toContain("Délai dépassé — Cloudflare n'a pas répondu.")
    expect(html).not.toContain("lookup-pending")
  })
})

describe("statutDuLookup", () => {
  test("en cours : pending, rien d'autre", () => {
    expect(
      statutDuLookup({
        enCours: true,
        erreur: null,
        verifieA: 1,
        trouves: 2,
        raisonsIndispo: [],
        apexNxdomain: false,
      }),
    ).toEqual({ enCours: true, preuve: null, erreur: null })
  })

  test("succès : la preuve, pas d'erreur", () => {
    const verifieA = Date.parse("2026-09-01T02:04:00+02:00")
    const statut = statutDuLookup({
      enCours: false,
      erreur: null,
      verifieA,
      trouves: 2,
      raisonsIndispo: [],
      apexNxdomain: false,
    })
    expect(statut.enCours).toBe(false)
    expect(statut.erreur).toBeNull()
    expect(statut.preuve).toMatch(/Vérifié à \d{2}:\d{2} · Cloudflare : 2 enregistrements/)
  })

  test("indisponible : l'erreur l'emporte sur la preuve", () => {
    expect(
      statutDuLookup({
        enCours: false,
        erreur: null,
        verifieA: Date.now(),
        trouves: 0,
        raisonsIndispo: ["Réseau : le résolveur est injoignable."],
        apexNxdomain: false,
      }),
    ).toEqual({
      enCours: false,
      preuve: null,
      erreur: "Réseau : le résolveur est injoignable.",
    })
  })
})
