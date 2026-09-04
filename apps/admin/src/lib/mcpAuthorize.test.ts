import { describe, expect, test } from "vitest"
import {
  MCP_OAUTH_MESSAGE_TYPE,
  canOpenAuthorize,
  deriveAuthorizeUrl,
  inferMcpTransport,
  isMcpOAuthPopupMessage,
  mcpConnectorSubtitle,
  needsMcpOAuth,
  resolveAuthorizeUrl,
} from "./mcpAuthorize"
import { faviconCandidates } from "./mcpFavicon"

describe("canOpenAuthorize", () => {
  test("accepte https et localhost, refuse le reste", () => {
    expect(canOpenAuthorize("https://mcp.example.com/mcp")).toBe(true)
    expect(canOpenAuthorize("http://localhost:3000/sse")).toBe(true)
    expect(canOpenAuthorize("http://evil.example/sse")).toBe(false)
    expect(canOpenAuthorize("stdio://local")).toBe(false)
    expect(canOpenAuthorize("pas-une-url")).toBe(false)
  })
})

describe("deriveAuthorizeUrl", () => {
  test("ne reprend jamais l'URL MCP comme authorize (401 sans Bearer)", () => {
    expect(deriveAuthorizeUrl("https://mcp.example.com/mcp")).toBe(null)
    expect(deriveAuthorizeUrl("https://mcp.example.com/sse")).toBe(null)
    expect(deriveAuthorizeUrl("https://example.com/stateless")).toBe(null)
  })
})

describe("resolveAuthorizeUrl", () => {
  test("l'URL complète saisie prime ; une URL nue est refusée", () => {
    expect(
      resolveAuthorizeUrl("https://mcp.example.com/mcp", "https://auth.example/connect?client_id=x"),
    ).toBe("https://auth.example/connect?client_id=x")
    expect(resolveAuthorizeUrl("https://mcp.example.com/mcp", "")).toBe(null)
    expect(
      resolveAuthorizeUrl("https://mcp.example.com/mcp", "https://auth.example/oauth/authorize"),
    ).toBe(null)
    expect(resolveAuthorizeUrl("", "")).toBe(null)
  })
})

describe("needsMcpOAuth", () => {
  test("URL MCP ou authorize nu → découverte + DCR + PKCE", () => {
    expect(needsMcpOAuth("https://mcp.example.com/mcp", "")).toBe(true)
    expect(needsMcpOAuth("https://mcp.example.com/sse", "")).toBe(true)
    expect(needsMcpOAuth("https://example.com/sse", "")).toBe(true)
    expect(needsMcpOAuth("https://mcp.example.com/mcp", "https://auth.example/oauth/authorize")).toBe(
      true,
    )
    expect(
      needsMcpOAuth("https://mcp.example.com/mcp", "https://auth.example/connect?client_id=x"),
    ).toBe(false)
  })
})

describe("mcpConnectorSubtitle", () => {
  test("connecté si jeton, à autoriser sinon", () => {
    expect(
      mcpConnectorSubtitle({
        url: "https://mcp.make.com/mcp",
        headersConfigured: true,
      }),
    ).toBe("Connecté · mcp.make.com")
    expect(
      mcpConnectorSubtitle({
        url: "https://mcp.make.com/mcp",
        headersConfigured: false,
      }),
    ).toBe("À autoriser · mcp.make.com")
  })
})

describe("inferMcpTransport", () => {
  test("/mcp → HTTP streamable, sinon SSE", () => {
    expect(inferMcpTransport("https://mcp.example.com/mcp")).toBe("http")
    expect(inferMcpTransport("https://mcp.example.com/sse")).toBe("sse")
    expect(inferMcpTransport("https://mcp.example.com")).toBe("sse")
  })
})

test("message popup MCP : même origine, même type", () => {
  expect(isMcpOAuthPopupMessage({ type: MCP_OAUTH_MESSAGE_TYPE, ok: true })).toBe(true)
  expect(isMcpOAuthPopupMessage({ type: "autre", ok: true })).toBe(false)
})

test("favicon : origine de l'URL, puis apple-touch-icon", () => {
  expect(faviconCandidates("https://mcp.example.com/sse")).toEqual([
    "https://mcp.example.com/favicon.ico",
    "https://mcp.example.com/apple-touch-icon.png",
  ])
  expect(faviconCandidates("pas-une-url")).toEqual([])
})
