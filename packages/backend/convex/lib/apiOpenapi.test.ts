import { expect, test } from "vitest"
import { openapiDocument } from "./apiOpenapi"

const doc = openapiDocument("https://x.convex.site")

test("est un document OpenAPI 3", () => {
  expect(doc.openapi).toBe("3.0.3")
  expect(doc.servers?.[0]?.url).toBe("https://x.convex.site")
  expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
    type: "http",
    scheme: "bearer",
  })
})

test("décrit les routes V1, sans POST public de leads", () => {
  const paths = Object.keys(doc.paths)
  expect(paths).toContain("/api/v1/posts")
  expect(paths).toContain("/api/v1/posts/{id}")
  expect(paths).toContain("/api/v1/posts/{id}/publish")
  expect(paths).toContain("/api/v1/leads")
  expect(paths).toContain("/api/v1/pages")
  expect(paths).toContain("/api/v1/tags")
  expect(doc.paths["/api/v1/leads"]?.get).toBeDefined()
  expect(doc.paths["/api/v1/leads"]?.post).toBeUndefined()
})

test("ne contient aucun secret", () => {
  const dumped = JSON.stringify(doc)
  expect(dumped).not.toMatch(/atn_|sk-|Bearer [A-Za-z0-9]/)
})
