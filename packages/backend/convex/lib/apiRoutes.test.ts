import { expect, test } from "vitest"
import { parseApiRoute } from "./apiRoutes"

test("liste et création d'articles", () => {
  expect(parseApiRoute("GET", "/api/v1/posts")).toEqual({ resource: "posts" })
  expect(parseApiRoute("POST", "/api/v1/posts")).toEqual({ resource: "posts" })
})

test("article nommé, y compris publish/unpublish", () => {
  expect(parseApiRoute("GET", "/api/v1/posts/k17")).toEqual({
    resource: "posts",
    id: "k17",
  })
  expect(parseApiRoute("POST", "/api/v1/posts/k17/publish")).toEqual({
    resource: "posts",
    id: "k17",
    action: "publish",
  })
  expect(parseApiRoute("POST", "/api/v1/posts/k17/unpublish")).toEqual({
    resource: "posts",
    id: "k17",
    action: "unpublish",
  })
})

test("leads en lecture seule, pages méta, tags", () => {
  expect(parseApiRoute("GET", "/api/v1/leads")).toEqual({ resource: "leads" })
  expect(parseApiRoute("GET", "/api/v1/leads/ld1")).toEqual({
    resource: "leads",
    id: "ld1",
  })
  expect(parseApiRoute("GET", "/api/v1/pages")).toEqual({ resource: "pages" })
  expect(parseApiRoute("PATCH", "/api/v1/pages/p1")).toEqual({
    resource: "pages",
    id: "p1",
  })
  expect(parseApiRoute("GET", "/api/v1/tags")).toEqual({ resource: "tags" })
  expect(parseApiRoute("POST", "/api/v1/tags")).toEqual({ resource: "tags" })
})

test("spec et docs sans id", () => {
  expect(parseApiRoute("GET", "/api/v1/openapi.json")).toEqual({
    resource: "openapi",
  })
  expect(parseApiRoute("GET", "/api/v1/docs")).toEqual({ resource: "docs" })
})

test("chemin inconnu → null", () => {
  expect(parseApiRoute("GET", "/api/v1/media")).toBeNull()
  expect(parseApiRoute("POST", "/api/v1/leads")).toBeNull()
  expect(parseApiRoute("GET", "/api/auth/sign-in/email")).toBeNull()
})
