import { describe, expect, test } from "vitest"
import { leadOrigin } from "./leadOrigin"

describe("leadOrigin", () => {
  test("un source explicite gagne", () => {
    expect(leadOrigin({ source: "chat" })).toBe("chat")
    expect(leadOrigin({ source: "contact", threadId: "t" })).toBe("contact")
  })

  test("sans source, un thread vaut chatbot", () => {
    expect(leadOrigin({ threadId: "thread_1" })).toBe("chat")
    expect(leadOrigin({})).toBe("contact")
  })
})
