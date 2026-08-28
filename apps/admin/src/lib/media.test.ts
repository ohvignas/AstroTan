import { describe, expect, test } from "vitest"
import { ConvexError } from "convex/values"
import { describeMediaError, formatFileSize } from "./media"

describe("formatFileSize", () => {
  test("keeps small files in bytes", () => {
    expect(formatFileSize(0)).toBe("0 o")
    expect(formatFileSize(842)).toBe("842 o")
  })

  test("steps up a unit at a time", () => {
    expect(formatFileSize(1_000)).toBe("1 ko")
    expect(formatFileSize(1_536)).toBe("1,5 ko")
    expect(formatFileSize(2_400_000)).toBe("2,4 Mo")
  })

  test("never renders a negative or non-finite size", () => {
    expect(formatFileSize(-1)).toBe("—")
    expect(formatFileSize(Number.NaN)).toBe("—")
  })
})

describe("describeMediaError", () => {
  test("renders MEDIA_IN_USE as a sentence, never as a code", () => {
    const message = describeMediaError(
      new ConvexError({ code: "MEDIA_IN_USE" })
    )
    expect(message).not.toContain("MEDIA_IN_USE")
    expect(message).toMatch(/référenc/i)
  })

  test("names the rejected MIME type", () => {
    expect(
      describeMediaError(
        new ConvexError({ code: "UNSUPPORTED_MIME", mime: "image/svg+xml" })
      )
    ).toContain("image/svg+xml")
  })

  test("names the size limit it refused against", () => {
    expect(
      describeMediaError(
        new ConvexError({ code: "FILE_TOO_LARGE", max: 10 * 1024 * 1024 })
      )
    ).toContain("10,5 Mo")
  })

  test("surfaces which field was too long and its limit", () => {
    expect(
      describeMediaError(
        new ConvexError({ code: "FIELD_TOO_LONG", field: "alt", max: 300 })
      )
    ).toBe("alt dépasse la limite autorisée (maximum 300 caractères).")
  })

  test("falls back to a generic message rather than a blank one", () => {
    expect(describeMediaError(new Error("boom"))).toBe(
      "Une erreur inattendue est survenue."
    )
    expect(describeMediaError(new ConvexError({ code: "WAT" }))).toBe(
      "Une erreur inattendue est survenue."
    )
  })
})
