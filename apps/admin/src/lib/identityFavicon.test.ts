import { describe, expect, test } from "vitest"
import {
  identityFaviconHref,
  pickIdentityStorageId,
} from "./identityFavicon"

describe("pickIdentityStorageId", () => {
  test("prefers the icon over the logo", () => {
    expect(
      pickIdentityStorageId({ iconId: "icon-1", logoId: "logo-1" })
    ).toBe("icon-1")
  })

  test("ignores the logo when no icon is set", () => {
    expect(pickIdentityStorageId({ logoId: "logo-1" })).toBeNull()
    expect(pickIdentityStorageId({ iconId: null, logoId: "logo-1" })).toBeNull()
    expect(pickIdentityStorageId({ iconId: "", logoId: "logo-1" })).toBeNull()
  })

  test("returns null when neither is set, or settings are missing", () => {
    expect(pickIdentityStorageId(null)).toBeNull()
    expect(pickIdentityStorageId(undefined)).toBeNull()
    expect(pickIdentityStorageId({})).toBeNull()
    expect(pickIdentityStorageId({ iconId: null, logoId: null })).toBeNull()
  })
})

describe("identityFaviconHref", () => {
  const fallback = "/fallback-icon.png"

  test("keeps the fallback while settings or the URL are still loading", () => {
    expect(identityFaviconHref({ remoteUrl: undefined, fallbackHref: fallback })).toBe(
      fallback
    )
  })

  test("keeps the fallback when the storage file is gone", () => {
    expect(identityFaviconHref({ remoteUrl: null, fallbackHref: fallback })).toBe(
      fallback
    )
  })

  test("uses the resolved identity URL once it exists", () => {
    expect(
      identityFaviconHref({
        remoteUrl: "https://convex.example/icon.png",
        fallbackHref: fallback,
      })
    ).toBe("https://convex.example/icon.png")
  })
})
