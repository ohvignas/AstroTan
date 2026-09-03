import { describe, expect, test } from "vitest"
import { MAX_CHAT_FILE_BYTES } from "@astrotan/backend/convex/content"
import { chatFileApiError, chatFileClientError } from "./chatFile"

describe("limites fichier chat", () => {
  test("refuse au-dessus de 500 Mo et un SVG", () => {
    const huge = new File([new Uint8Array(1)], "gros.png", { type: "image/png" })
    Object.defineProperty(huge, "size", { value: MAX_CHAT_FILE_BYTES + 1 })
    expect(chatFileClientError(huge)).toBe("Ce fichier dépasse 500 Mo.")
    expect(chatFileClientError(new File(["x"], "x.svg", { type: "image/svg+xml" }))).toMatch(
      /n'est pas accepté/,
    )
    expect(chatFileClientError(new File(["x"], "ok.png", { type: "image/png" }))).toBeNull()
  })

  test("codes API en français", () => {
    expect(chatFileApiError("file_too_large")).toBe("Ce fichier dépasse 500 Mo.")
    expect(chatFileApiError("unsupported_mime")).toMatch(/n'est pas accepté/)
    expect(chatFileApiError("empty")).toBeNull()
  })
})
