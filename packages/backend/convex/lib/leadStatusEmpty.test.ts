import { expect, test } from "vitest"
import { LEAD_STATUSES, LEAD_STATUS_EMPTY, LEAD_STATUS_LABELS } from "../content"

test("chaque colonne a une phrase vide en français, minuscule après « en »", () => {
  expect(LEAD_STATUSES.map((status) => LEAD_STATUS_EMPTY[status])).toEqual([
    "Aucun contact en nouveau",
    "Aucun contact en contacté",
    "Aucun contact en qualifié",
    "Aucun contact en gagné",
    "Aucun contact en perdu",
  ])
  for (const status of LEAD_STATUSES) {
    expect(LEAD_STATUS_EMPTY[status]).toContain(LEAD_STATUS_LABELS[status].toLowerCase())
  }
})
