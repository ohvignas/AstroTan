import { expect, test } from "vitest"
import { EMAIL_TEST_DEMO_LIMIT, EMAIL_TEST_STAFF_LIMIT } from "./emailTestQuota"

test("le quota démo est plus serré que le quota owner/admin", () => {
  expect(EMAIL_TEST_DEMO_LIMIT.rate).toBe(3)
  expect(EMAIL_TEST_STAFF_LIMIT.rate).toBeGreaterThan(EMAIL_TEST_DEMO_LIMIT.rate)
  expect(EMAIL_TEST_DEMO_LIMIT.kind).toBe("token bucket")
  expect(EMAIL_TEST_STAFF_LIMIT.kind).toBe("token bucket")
})
