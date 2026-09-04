import { expect, test } from "vitest"
import { hashToken } from "./token"
import { extractBearer, hashesMatch } from "./apiAuth"

test("extrait le Bearer et refuse le reste", () => {
  expect(extractBearer({ authorization: "Bearer abc" })).toBe("abc")
  expect(extractBearer({ authorization: "bearer abc" })).toBe("abc")
  expect(extractBearer({ authorization: "Bearer  tok " })).toBe("tok")
  expect(extractBearer({ authorization: "Basic abc" })).toBeNull()
  expect(extractBearer({})).toBeNull()
  expect(extractBearer({ authorization: "Bearer" })).toBeNull()
})

test("deux hash identiques passent, un hash différent échoue", async () => {
  const hash = await hashToken("atn_secret")
  expect(await hashesMatch("atn_secret", hash)).toBe(true)
  expect(await hashesMatch("autre", hash)).toBe(false)
})
