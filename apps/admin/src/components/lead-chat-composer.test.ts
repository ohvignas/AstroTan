import { describe, expect, test } from "vitest"
import source from "./lead-chat-composer.tsx?raw"

describe("composer staff", () => {
  test("bouton + et limite 500 Mo", () => {
    expect(source).toContain("Écrire au visiteur…")
    expect(source).toContain("Ajouter une image")
    expect(source).toContain('accept="image/*"')
    expect(source).toContain('name="media"')
    expect(source).toContain("MAX_CHAT_FILE_BYTES")
    expect(source).toContain("PlusIcon")
  })
})
