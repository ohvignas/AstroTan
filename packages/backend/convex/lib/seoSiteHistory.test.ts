import { expect, test } from "vitest"
import { assemblerSeries, filtrerReleves } from "./seoSiteHistory"

const LUNDI = Date.UTC(2026, 7, 3, 6, 0, 0)
const LUNDI_SUIVANT = Date.UTC(2026, 7, 10, 6, 0, 0)
const LUNDI_ENCORE = Date.UTC(2026, 7, 17, 6, 0, 0)

test("ne garde que les relevés dans la fenêtre, sans en inventer entre deux lundis", () => {
  const points = filtrerReleves(
    [
      { fetchedAt: LUNDI, value: 12 },
      { fetchedAt: LUNDI_SUIVANT, value: 9 },
      { fetchedAt: LUNDI_ENCORE, value: 7 },
    ],
    LUNDI_SUIVANT,
    LUNDI_ENCORE,
  )
  expect(points).toEqual([
    { fetchedAt: LUNDI_SUIVANT, value: 9 },
    { fetchedAt: LUNDI_ENCORE, value: 7 },
  ])
})

test("un seul relevé dans la période reste un seul point", () => {
  expect(
    filtrerReleves([{ fetchedAt: LUNDI_SUIVANT, value: 42 }], LUNDI, LUNDI_ENCORE),
  ).toEqual([{ fetchedAt: LUNDI_SUIVANT, value: 42 }])
})

test("hors fenêtre : rien, pas un point inventé au bord", () => {
  expect(
    filtrerReleves([{ fetchedAt: LUNDI, value: 8 }], LUNDI_SUIVANT, LUNDI_ENCORE),
  ).toEqual([])
})

test("sans historique : le snapshot courant devient l'unique point, s'il est dans la fenêtre", () => {
  const series = assemblerSeries({
    history: [],
    fallback: {
      position: { fetchedAt: LUNDI_SUIVANT, value: 8.5 },
      backlinks: { fetchedAt: LUNDI_SUIVANT, value: 42 },
      keywords: { fetchedAt: LUNDI_SUIVANT, value: 18 },
    },
    startAt: LUNDI,
    endAt: LUNDI_ENCORE,
  })
  expect(series.position).toEqual([{ fetchedAt: LUNDI_SUIVANT, value: 8.5 }])
  expect(series.backlinks).toEqual([{ fetchedAt: LUNDI_SUIVANT, value: 42 }])
  expect(series.keywords).toEqual([{ fetchedAt: LUNDI_SUIVANT, value: 18 }])
})

test("dès qu'il y a un historique, le snapshot n'ajoute pas un second point", () => {
  const series = assemblerSeries({
    history: [
      { metric: "backlinks", fetchedAt: LUNDI, value: 30 },
      { metric: "backlinks", fetchedAt: LUNDI_SUIVANT, value: 42 },
    ],
    fallback: { backlinks: { fetchedAt: LUNDI_SUIVANT, value: 42 } },
    startAt: LUNDI,
    endAt: LUNDI_ENCORE,
  })
  expect(series.backlinks).toEqual([
    { fetchedAt: LUNDI, value: 30 },
    { fetchedAt: LUNDI_SUIVANT, value: 42 },
  ])
})
