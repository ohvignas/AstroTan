// Ce que ce tableau de bord peut afficher de faux est plus grave que ce
// qu'il peut afficher de laid : un zéro là où le service est en panne, une
// courbe à l'envers, un « +100 % » calculé depuis rien.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SiteSummary, UmamiLinks } from "@astrotan/backend/convex/analytics"
import { SiteDashboard, trend } from "./site-dashboard"

const OK: SiteSummary = {
  periode: "mois",
  unit: "day",
  startAt: 1_787_000_000_000,
  endAt: 1_789_000_000_000,
  totals: {
    visitors: { value: 44, prev: 39 },
    pageviews: { value: 128, prev: 160 },
  },
  series: [
    { date: "2026-08-01T00:00:00Z", visitors: 5, pageviews: 12 },
    { date: "2026-08-02T00:00:00Z", visitors: 9, pageviews: 20 },
  ],
  topPages: [{ label: "/blog/bienvenue", visits: 312 }],
  topReferrers: [{ label: "Accès direct", visits: 94 }],
  status: "ok",
}

const SHARED: UmamiLinks = {
  dashboard: "https://umami.exemple.test/share/demo",
  shared: true,
}

function render(summary: SiteSummary | undefined, umami: UmamiLinks | null = null) {
  return renderToStaticMarkup(
    <SiteDashboard summary={summary} umami={umami} periode="mois" onPeriode={() => {}} />
  )
}

describe("trend", () => {
  test("rend l'écart en pourcentage, dans les deux sens", () => {
    expect(trend({ value: 44, prev: 39 })).toBe(13)
    expect(trend({ value: 128, prev: 160 })).toBe(-20)
  })

  test("refuse de qualifier une progression depuis zéro", () => {
    // « +100 % » depuis rien est une division par zéro déguisée : aucun
    // pourcentage ne décrit honnêtement ce passage.
    expect(trend({ value: 12, prev: 0 })).toBeNull()
  })
})

// Les tests de la courbe ont disparu avec la sparkline écrite à la main.
// Le graphique est désormais rendu par recharts, qui exige un DOM là où la
// configuration vitest de cette application est en `environment: "node"`.
// Ce qui restait vérifiable sans DOM — le format des étiquettes, la lecture
// des seaux en UTC — a été déplacé dans `lib/dashboardFormat.test.ts`
// plutôt que supprimé.
//
// Ce qui SE vérifie encore sans DOM, et qui est tout l'enjeu de cet écran,
// c'est LEQUEL des deux cadres est rendu. `ResponsiveContainer` ne trace
// rien hors navigateur — mesuré, le rendu serveur s'arrête à un
// `<div class="recharts-wrapper">` vide — mais deux marqueurs traversent :
//
//   `data-etat`          — posé par chacun des deux cadres.
//   `--color-pageviews`  — la feuille de style que recharts émet pour la
//                          configuration des séries. Elle n'existe que si
//                          le graphique est monté avec ses deux séries.
//
// Les tests ci-dessous exigent les deux dans un sens ET leur absence dans
// l'autre : un cadre qui se rendrait à la place de son jumeau les fait
// tomber, ce qu'une assertion sur le seul texte ne ferait pas.

/** Umami a répondu, et le site n'a reçu personne. */
const ZEROS: SiteSummary = {
  ...OK,
  totals: {
    visitors: { value: 0, prev: 0 },
    pageviews: { value: 0, prev: 0 },
  },
  series: [
    { date: "2026-08-01T00:00:00Z", visitors: 0, pageviews: 0 },
    { date: "2026-08-02T00:00:00Z", visitors: 0, pageviews: 0 },
  ],
  topPages: [],
  topReferrers: [],
}

/** Umami n'a pas répondu du tout. */
const PANNE: SiteSummary = {
  periode: "mois",
  unit: "day",
  startAt: 0,
  endAt: 0,
  totals: null,
  series: null,
  topPages: null,
  topReferrers: null,
  status: "unreachable",
}

describe("le cadre du graphique", () => {
  test("Umami répond sans trafic : la courbe est tracée, à zéro", () => {
    const html = render(ZEROS)
    expect(html).toContain('data-etat="mesure"')
    expect(html).not.toContain('data-etat="indisponible"')
    // Le graphique est monté avec ses deux séries.
    expect(html).toContain("--color-pageviews")
    expect(html).toContain("--color-visitors")
    // Zéro est une MESURE, et il s'affiche : c'est la demande.
    expect(html).toContain(">0<")
    expect(html).not.toContain("injoignable")
  })

  test("Umami muet : le cadre reste, vide, et n'écrit aucun zéro", () => {
    const html = render(PANNE)
    expect(html).toContain('data-etat="indisponible"')
    expect(html).not.toContain('data-etat="mesure"')
    // Aucun graphique monté : pas de courbe, donc pas de ligne plate qu'on
    // lirait comme une mesure.
    expect(html).not.toContain("--color-pageviews")
    expect(html).toContain("injoignable")
    expect(html).not.toContain(">0<")
    // Le cadre EST là — cinq lignes de grille, pas une phrase toute seule.
    expect(html.match(/<line/g)).toHaveLength(5)
  })

  test("les totaux sans la série : les chiffres restent, le cadre l'avoue", () => {
    // Umami peut rendre `/stats` et rater `/pageviews`. Le service a
    // répondu : ni « injoignable » ni une courbe à zéro ne le décrivent.
    const html = render({ ...OK, series: null })
    expect(html).toContain("44")
    expect(html).toContain("Courbe indisponible")
    expect(html).not.toContain("injoignable")
    expect(html).toContain('data-etat="indisponible"')
  })

  test("plus rien ne remplace le graphique par une phrase", () => {
    // Deux phrases ont vécu là : « pas encore assez de mesures pour tracer
    // une courbe » (garde à moins de deux points, inatteignable — la série
    // est dense et fait 7, 30 ou 12 points) et la promesse que les chiffres
    // reviendraient.
    for (const html of [render(OK), render(ZEROS), render(PANNE)]) {
      expect(html).not.toContain("assez de mesures")
      expect(html).not.toContain("réapparaîtront")
    }
  })
})

describe("SiteDashboard", () => {
  test("affiche chiffres, tendances et palmarès", () => {
    const html = render(OK, SHARED)
    expect(html).toContain("44")
    expect(html).toContain("13 % vs")
    expect(html).toContain("/blog/bienvenue")
    expect(html).toContain("Accès direct")
  })

  test("avec un partage, un seul lien, vers le partage", () => {
    const html = render(OK, SHARED)
    expect(html).toContain("/share/demo")
    expect(html).toContain("Tout le détail")
    // Le second lien « Administrer Umami » a été retiré : régler Umami se
    // fait depuis Umami, et il occupait une place à côté du seul lien qui
    // rend un service.
    expect(html).not.toContain("Administrer")
  })

  test("sans partage, le lien mène à la racine et le dit", () => {
    const html = render(OK, {
      dashboard: "https://umami.exemple.test",
      shared: false,
    })
    expect(html).toContain("Ouvrir Umami")
    expect(html).not.toContain("Administrer")
  })

  test("sans Umami configuré, aucun lien mort", () => {
    const html = render(OK, null)
    expect(html).not.toContain("umami.exemple.test")
  })

  test.each([
    ["not-configured", "configurée"],
    ["unreachable", "injoignable"],
    ["unauthorized", "refusés"],
  ] as const)("l'état %s explique au lieu d'afficher zéro", (status, expected) => {
    const html = render({ ...PANNE, status })
    expect(html).toContain(expected)
    expect(html).not.toContain(">0<")
    // L'état est posé SUR le cadre, pas à sa place.
    expect(html).toContain('data-etat="indisponible"')
  })

  test("un palmarès indisponible ne se confond pas avec un palmarès vide", () => {
    const html = render({ ...OK, topReferrers: null })
    expect(html).toContain("indisponible")
    // Les chiffres principaux, eux, sont toujours là.
    expect(html).toContain("44")
  })
})
