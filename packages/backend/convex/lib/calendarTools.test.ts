import { expect, test } from "vitest"
import { assertCalendarWindow } from "./calendarTools"
import { CALENDAR_WINDOW_MS } from "../content"

test("une fenêtre de 14 jours passe", () => {
  const start = "2026-09-01T00:00:00.000Z"
  const end = new Date(Date.parse(start) + CALENDAR_WINDOW_MS).toISOString()
  expect(assertCalendarWindow(start, end)).toBe(true)
})

test("une fenêtre de plus de 14 jours est refusée", () => {
  const start = "2026-09-01T00:00:00.000Z"
  const end = new Date(Date.parse(start) + CALENDAR_WINDOW_MS + 1).toISOString()
  expect(assertCalendarWindow(start, end)).toBe(false)
})

test("une fenêtre inversée est refusée", () => {
  expect(assertCalendarWindow("2026-09-10T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBe(
    false,
  )
})
