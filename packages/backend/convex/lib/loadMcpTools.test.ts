import { expect, test, vi } from "vitest"
import { loadMcpTools, probeEnabledMcpServers, safeMcpError } from "./loadMcpTools"
import { chiffrer, lireCleMaitresse, SECRETS_KEY_VAR } from "./secretsCrypto"

test("préfixe les outils et un serveur injoignable n'empêche pas les autres", async () => {
  const toolsA = { ping: { description: "a" } }
  const toolsB = { ping: { description: "b" } }
  const closeA = vi.fn()
  const closeB = vi.fn()
  const createClient = vi.fn(async ({ transport }: { transport: { url: string } }) => {
    if (transport.url.includes("down.example")) throw new Error("MCP_UNREACHABLE")
    if (transport.url.includes("a.example")) {
      return { tools: async () => toolsA, close: closeA }
    }
    return { tools: async () => toolsB, close: closeB }
  })

  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [
        { _id: "id-a", name: "alpha", transport: "http", url: "https://a.example/mcp" },
        { _id: "id-down", name: "down", transport: "http", url: "https://down.example/mcp" },
        { _id: "id-b", name: "beta", transport: "http", url: "https://b.example/mcp" },
      ]
    }),
  }

  const { tools, close } = await loadMcpTools(ctx as never, createClient as never)
  expect(Object.keys(tools).sort()).toEqual(["alpha__ping", "beta__ping"])
  expect(tools.alpha__ping).toBe(toolsA.ping)
  expect(tools.beta__ping).toBe(toolsB.ping)
  await close()
  expect(closeA).toHaveBeenCalled()
  expect(closeB).toHaveBeenCalled()
})

test("probeEnabledMcpServers rend les noms et l'erreur sans avaler le down", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { url: string } }) => {
    if (transport.url.includes("down.example")) throw new Error("MCP_UNREACHABLE")
    return {
      tools: async () => ({ ping: { description: "a" } }),
      listTools: async () => ({ tools: [{ name: "ping" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [
        { _id: "id-a", name: "alpha", transport: "http", url: "https://a.example/mcp" },
        { _id: "id-down", name: "down", transport: "http", url: "https://down.example/mcp" },
      ]
    }),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([
    {
      name: "alpha",
      url: "https://a.example/mcp",
      ok: true,
      toolNames: ["ping"],
      transport: "http",
      headerNames: [],
      hasRefresh: false,
      hasExpiresAt: false,
    },
    {
      name: "down",
      url: "https://down.example/mcp",
      ok: false,
      toolNames: [],
      error: "MCP_UNREACHABLE",
      transport: "http",
      headerNames: [],
      hasRefresh: false,
      hasExpiresAt: false,
    },
  ])
  await close()
})

test("un serveur HTTP qui répond n'est pas retenté en SSE", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { type: string } }) => {
    if (transport.type === "sse") throw new Error("unexpected SSE")
    return {
      tools: async () => ({ ping: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "ping" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-n", name: "Notion", transport: "http", url: "https://mcp.notion.com/mcp" }]
    }),
    runMutation: vi.fn(),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([expect.objectContaining({ ok: true, transport: "http" })])
  expect(createClient).toHaveBeenCalledTimes(1)
  expect(createClient.mock.calls[0]?.[0].transport.type).toBe("http")
  expect(ctx.runMutation).not.toHaveBeenCalled()
  await close()
})

test("un 401 n'est pas un mauvais transport : on ne bascule pas", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { type: string } }) => {
    if (transport.type === "http") throw new Error("MCP HTTP Transport Error: 401 Unauthorized")
    return {
      tools: async () => ({ run: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "run" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-make", name: "Make", transport: "sse", url: "https://mcp.make.com" }]
    }),
    runMutation: vi.fn(),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([
    expect.objectContaining({
      name: "Make",
      ok: false,
      error: "MCP HTTP Transport Error: 401 Unauthorized",
      transport: "sse",
    }),
  ])
  expect(createClient).toHaveBeenCalledTimes(1)
  expect(createClient.mock.calls[0]?.[0].transport.type).toBe("http")
  expect(ctx.runMutation).not.toHaveBeenCalled()
  await close()
})

test("mcp.make.com stocké sse : HTTP streamable d'abord, puis on le persiste", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { type: string } }) => {
    if (transport.type === "sse") throw new Error("unexpected SSE")
    return {
      tools: async () => ({ run: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "run" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-make", name: "Make", transport: "sse", url: "https://mcp.make.com" }]
    }),
    runMutation: vi.fn(),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([
    expect.objectContaining({
      name: "Make",
      ok: true,
      toolNames: ["run"],
      transport: "http",
    }),
  ])
  expect(createClient).toHaveBeenCalledTimes(1)
  expect(createClient.mock.calls[0]?.[0].transport.type).toBe("http")
  expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
    id: "id-make",
    transport: "http",
  })
  await close()
})

test("404 / pas un endpoint SSE : retente l'autre transport et le persiste", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { type: string } }) => {
    if (transport.type === "sse") throw new Error("404 Not Found: not an SSE endpoint")
    return {
      tools: async () => ({ run: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "run" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-leg", name: "legacy", transport: "sse", url: "https://legacy.example/sse" }]
    }),
    runMutation: vi.fn(),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([
    expect.objectContaining({
      name: "legacy",
      ok: true,
      toolNames: ["run"],
      transport: "http",
    }),
  ])
  expect(createClient.mock.calls.map((call) => call[0].transport.type)).toEqual(["sse", "http"])
  expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
    id: "id-leg",
    transport: "http",
  })
  await close()
})

test("/mcp : HTTP d'abord, puis SSE si mauvais transport", async () => {
  const createClient = vi.fn(async ({ transport }: { transport: { type: string } }) => {
    if (transport.type === "http") throw new Error("404 Method Not Allowed")
    return {
      tools: async () => ({ ping: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "ping" }] }),
      close: vi.fn(),
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-x", name: "legacy", transport: "http", url: "https://x.example/mcp" }]
    }),
    runMutation: vi.fn(),
  }

  const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
  expect(servers).toEqual([expect.objectContaining({ ok: true, transport: "sse" })])
  expect(createClient.mock.calls.map((call) => call[0].transport.type)).toEqual(["http", "sse"])
  expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
    id: "id-x",
    transport: "sse",
  })
  await close()
})

test("safeMcpError ne rend jamais un Bearer", () => {
  expect(safeMcpError(new Error("401 Bearer sk-secret-value-xyz"))).toBe(
    "401 Bearer [redacted]",
  )
})

test("un handshake MCP qui ne résout jamais n'empêche pas les autres", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const closeOk = vi.fn()
  const createClient = vi.fn(async ({ transport }: { transport: { url: string } }) => {
    if (transport.url.includes("hang.example")) return new Promise(() => {})
    return {
      tools: async () => ({ ping: { description: "ok" } }),
      close: closeOk,
    }
  })
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [
        { _id: "id-hang", name: "Make", transport: "sse", url: "https://hang.example/sse" },
        { _id: "id-ok", name: "ok", transport: "http", url: "https://ok.example/mcp" },
      ]
    }),
    runMutation: vi.fn(),
  }

  const started = Date.now()
  const { tools, close } = await loadMcpTools(ctx as never, createClient as never, {
    timeoutMs: 40,
  })
  expect(Date.now() - started).toBeLessThan(400)
  expect(Object.keys(tools)).toEqual(["ok__ping"])
  expect(warn.mock.calls.some((call) => String(call[0]).includes("Make"))).toBe(true)
  await close()
  expect(closeOk).toHaveBeenCalled()
  warn.mockRestore()
})

test("probe : un SSE qui hang rend ok:false au timeout, sans bloquer", async () => {
  const createClient = vi.fn(async () => new Promise(() => {}))
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return [{ _id: "id-make", name: "Make", transport: "sse", url: "https://hang.example" }]
    }),
    runMutation: vi.fn(),
  }

  const started = Date.now()
  const { servers, close } = await probeEnabledMcpServers(
    ctx as never,
    createClient as never,
    { timeoutMs: 40 },
  )
  expect(Date.now() - started).toBeLessThan(400)
  expect(servers).toEqual([
    expect.objectContaining({
      name: "Make",
      ok: false,
      error: expect.stringMatching(/timed out after 40ms/),
    }),
  ])
  await close()
})

test("access expiré : refresh avant le handshake, sans passer refresh_token en header", async () => {
  const previous = process.env[SECRETS_KEY_VAR]
  process.env[SECRETS_KEY_VAR] = btoa(
    String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 13) % 251)),
  )
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("/token")) {
      return new Response(JSON.stringify({ access_token: "acc-new", expires_in: 900 }), {
        status: 200,
      })
    }
    return new Response("no", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)
  try {
    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) throw new Error("SECRETS_KEY")
    const { iv, chiffre } = await chiffrer(
      cle.octets,
      JSON.stringify({
        Authorization: "Bearer acc-old",
        refresh_token: "ref-old",
        expires_at: 1,
        token_endpoint: "https://www.make.com/oauth/v2/token",
        client_id: "id",
        client_secret: "sec",
        resource: "https://mcp.make.com",
      }),
    )
    const createClient = vi.fn(async () => ({
      tools: async () => ({ run: { description: "ok" } }),
      listTools: async () => ({ tools: [{ name: "run" }] }),
      close: vi.fn(),
    }))
    const runMutation = vi.fn()
    const ctx = {
      runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
        if (args && "serverId" in args) return { iv, chiffre, majPar: "admin-1" }
        return [{ _id: "id-make", name: "Make", transport: "http", url: "https://mcp.make.com" }]
      }),
      runMutation,
    }
    const { servers, close } = await probeEnabledMcpServers(ctx as never, createClient as never)
    expect(servers[0]).toEqual(expect.objectContaining({ ok: true, toolNames: ["run"] }))
    const firstCall = createClient.mock.calls[0] as
      | [{ transport: { headers?: Record<string, string> } }]
      | undefined
    expect(firstCall?.[0].transport.headers).toEqual({ Authorization: "Bearer acc-new" })
    expect(JSON.stringify(firstCall?.[0].transport.headers)).not.toContain("ref-old")
    expect(runMutation).toHaveBeenCalled()
    await close()
  } finally {
    if (previous === undefined) delete process.env[SECRETS_KEY_VAR]
    else process.env[SECRETS_KEY_VAR] = previous
    vi.unstubAllGlobals()
  }
})
