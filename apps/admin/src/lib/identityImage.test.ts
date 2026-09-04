import { describe, expect, test } from "vitest"
import {
  TEMPLATE_ICON_FILENAME,
  resolveIdentityMedia,
  templateIdentityToAssign,
} from "./identityImage"

const icon = {
  storageId: "icon-storage",
  filename: TEMPLATE_ICON_FILENAME,
  alt: "icône astrotan",
}
const other = {
  storageId: "other-storage",
  filename: "photo.png",
  alt: "Une photo",
}

describe("resolveIdentityMedia", () => {
  test("uses the assigned row when iconId is set", () => {
    expect(
      resolveIdentityMedia({
        assignedId: "icon-storage",
        media: [other, icon],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toEqual(icon)
  })

  test("falls back to the template file already in the library", () => {
    expect(
      resolveIdentityMedia({
        assignedId: null,
        media: [other, icon],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toEqual(icon)
  })

  test("does not invent a row when the template is absent", () => {
    expect(
      resolveIdentityMedia({
        assignedId: null,
        media: [other],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toBeNull()
    expect(
      resolveIdentityMedia({
        assignedId: null,
        media: undefined,
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toBeNull()
  })

  test("does not pick the template when another file is already assigned", () => {
    expect(
      resolveIdentityMedia({
        assignedId: "other-storage",
        media: [other, icon],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toEqual(other)
  })
})

describe("templateIdentityToAssign", () => {
  test("assigns the library template when iconId is empty", () => {
    expect(
      templateIdentityToAssign({
        assignedId: null,
        media: [icon],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toBe("icon-storage")
  })

  test("does not assign when an icon is already linked", () => {
    expect(
      templateIdentityToAssign({
        assignedId: "already",
        media: [icon],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toBeNull()
  })

  test("does not create a second file when the template is not in the library", () => {
    expect(
      templateIdentityToAssign({
        assignedId: null,
        media: [other],
        templateFilename: TEMPLATE_ICON_FILENAME,
      })
    ).toBeNull()
  })
})
