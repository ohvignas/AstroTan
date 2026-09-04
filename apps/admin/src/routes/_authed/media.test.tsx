import { describe, expect, test } from "vitest"
import source from "./media.tsx?raw"

describe("Médiathèque — fichiers d'identité", () => {
  test("masque Supprimer pour tout rôle d'identité, icône comprise", () => {
    expect(source).toContain("identityRoles")
    expect(source).toContain("describeIdentityMedia")
    expect(source).toMatch(/!isIdentity && ownsOrOutranks/)
  })
})
