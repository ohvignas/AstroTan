import { expect, test } from "vitest"
import { alerteLeadsNouveaux, estLeadNouveau } from "./leadVu"

test("nouveau = pas encore ouvert", () => {
  expect(estLeadNouveau({})).toBe(true)
  expect(estLeadNouveau({ seenAt: undefined })).toBe(true)
  expect(estLeadNouveau({ seenAt: 1_700_000_000_000 })).toBe(false)
})

test("la pastille dashboard n'existe que s'il reste des non lus", () => {
  expect(alerteLeadsNouveaux(0)).toBeUndefined()
  expect(alerteLeadsNouveaux(1)).toBe("1 nouveau")
  expect(alerteLeadsNouveaux(2)).toBe("2 nouveaux")
})
