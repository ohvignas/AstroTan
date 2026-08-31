import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  FlecheTendance,
  sensPourRang,
  sensPourVolume,
} from "./fleche-tendance"

test("volume : monter est une amélioration, l'absence est plate", () => {
  expect(sensPourVolume(12, 8)).toBe("up")
  expect(sensPourVolume(8, 12)).toBe("down")
  expect(sensPourVolume(8, 8)).toBe("flat")
  expect(sensPourVolume(8, null)).toBe("flat")
})

test("rang : descendre (12 → 7) est une amélioration", () => {
  expect(sensPourRang(7, 12)).toBe("up")
  expect(sensPourRang(12, 7)).toBe("down")
  expect(sensPourRang(7, 7)).toBe("flat")
  expect(sensPourRang(7, null)).toBe("flat")
})

test("les trois glyphes portent leur couleur", () => {
  expect(renderToStaticMarkup(<FlecheTendance sens="up" />)).toContain("↑")
  expect(renderToStaticMarkup(<FlecheTendance sens="up" />)).toContain(
    "text-emerald-600",
  )
  expect(renderToStaticMarkup(<FlecheTendance sens="down" />)).toContain("↓")
  expect(renderToStaticMarkup(<FlecheTendance sens="down" />)).toContain(
    "text-red-600",
  )
  expect(renderToStaticMarkup(<FlecheTendance sens="flat" />)).toContain("→")
  expect(renderToStaticMarkup(<FlecheTendance sens="flat" />)).toContain(
    "text-muted-foreground",
  )
})
