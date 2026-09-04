import { describe, expect, test } from "vitest"
import source from "./dashboard-tiles.tsx?raw"

describe("tuile Leads — nouveau = pas encore ouvert", () => {
  test("la pastille lit unseen, pas la colonne Nouveau", () => {
    expect(source).toMatch(/alerteLeadsNouveaux\(leads\.unseen\?\.count \?\? 0\)/)
    expect(source).not.toMatch(/byStatus\.new/)
    expect(source).not.toMatch(/LEAD_STATUS_LABELS/)
  })
})
