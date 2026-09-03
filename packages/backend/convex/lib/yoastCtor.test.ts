import { describe, expect, test } from "vitest"
import { asCtor } from "./yoastCtor"

class Sample {
  n: number
  constructor(n: number) {
    this.n = n
  }
}

describe("asCtor", () => {
  test("unwraps CJS default / double-default the Convex bundler leaves", () => {
    expect(new (asCtor<typeof Sample>(Sample))(1).n).toBe(1)
    expect(new (asCtor<typeof Sample>({ default: Sample }))(2).n).toBe(2)
    expect(new (asCtor<typeof Sample>({ default: { default: Sample } }))(3).n).toBe(
      3,
    )
  })

  test("refuses a plain object — the failure mode of named CJS imports", () => {
    expect(() => asCtor({ Paper: Sample })).toThrow(/constructor/)
  })
})
