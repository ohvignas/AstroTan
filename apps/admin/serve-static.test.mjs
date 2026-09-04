import path from "node:path"
import { describe, expect, test } from "vitest"
import { resolveClientPath } from "./serve-static.mjs"

const root = `/app/dist/client${path.sep}`

describe("resolveClientPath", () => {
  test("maps an assets URL onto the client directory", () => {
    expect(resolveClientPath(root, "/assets/index-CmIquIPA.js")).toBe(
      path.join(root, "assets/index-CmIquIPA.js"),
    )
  })

  test("refuses path traversal", () => {
    expect(resolveClientPath(root, "/assets/../../etc/passwd")).toBeNull()
    expect(resolveClientPath(root, "/../server/server.js")).toBeNull()
  })

  test("refuses the directory itself", () => {
    expect(resolveClientPath(root, "/")).toBeNull()
  })
})
