import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, vi } from "vitest"
import {
  CALL_MCP_TOOL,
  LIST_MCP_TOOLS,
  createMcpMetaTools,
} from "./mcpMetaTools"
import { wrapToolExecutes } from "./streamTools"

const here = dirname(fileURLToPath(import.meta.url))

function mockCtx(servers: Array<{ _id: string; name: string; url: string }>) {
  return {
    runQuery: vi.fn(async (_ref: unknown, args?: { serverId?: string }) => {
      if (args && "serverId" in args) return null
      return servers.map((server) => ({
        ...server,
        transport: "http" as const,
      }))
    }),
    runMutation: vi.fn(),
  }
}

test("le modèle ne voit que 2 meta-tools, pas 135 définitions Make", () => {
  const createClient = vi.fn(async () => {
    const tools: Record<string, { description: string }> = {}
    for (let i = 0; i < 135; i++) tools[`misc_${i}`] = { description: "x" }
    return { tools: async () => tools, close: vi.fn() }
  })
  const tools = createMcpMetaTools(mockCtx([]) as never, createClient as never)
  expect(Object.keys(tools).sort()).toEqual([CALL_MCP_TOOL, LIST_MCP_TOOLS])
  expect(createClient).not.toHaveBeenCalled()
})

test("list_mcp_tools handshake à la demande et rend nom + description courte", async () => {
  const close = vi.fn()
  const createClient = vi.fn(async () => ({
    tools: async () => ({
      scenarios_list: { description: "Liste les scénarios Make" },
    }),
    listTools: async () => ({
      tools: [{ name: "scenarios_list", description: "Liste les scénarios Make" }],
    }),
    close,
  }))
  const tools = createMcpMetaTools(
    mockCtx([{ _id: "id-make", name: "Make", url: "https://mcp.make.com" }]) as never,
    createClient as never,
  )
  expect(createClient).not.toHaveBeenCalled()
  const execute = (
    tools[LIST_MCP_TOOLS] as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }
  ).execute
  const result = await execute({}, {})
  expect(createClient).toHaveBeenCalledTimes(1)
  expect(result).toEqual({
    tools: [
      {
        name: "Make__scenarios_list",
        description: "Liste les scénarios Make",
      },
    ],
  })
  expect(close).toHaveBeenCalled()
})

test("call_mcp_tool exécute un outil nommé via callTool, sans charger 135 schémas", async () => {
  const callTool = vi.fn(async () => ({ ok: true, ran: "scenarios_run" }))
  const toolsFn = vi.fn(async () => {
    throw new Error("client.tools() ne doit pas être appelé pour un call")
  })
  const close = vi.fn()
  const createClient = vi.fn(async () => ({
    tools: toolsFn,
    callTool,
    close,
  }))
  const tools = wrapToolExecutes(
    createMcpMetaTools(
      mockCtx([{ _id: "id-make", name: "Make", url: "https://mcp.make.com" }]) as never,
      createClient as never,
    ),
  )
  expect(createClient).not.toHaveBeenCalled()
  const execute = (
    tools[CALL_MCP_TOOL] as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }
  ).execute
  const result = await execute(
    { name: "Make__scenarios_run", arguments: { id: 42 } },
    {},
  )
  expect(callTool).toHaveBeenCalledWith({
    name: "scenarios_run",
    arguments: { id: 42 },
  })
  expect(toolsFn).not.toHaveBeenCalled()
  expect(result).toEqual({ ok: true, ran: "scenarios_run" })
  expect(close).toHaveBeenCalled()
})

test("call_mcp_tool coupe un execute qui hang et rend une erreur", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const close = vi.fn()
  const createClient = vi.fn(async () => ({
    tools: async () => ({}),
    callTool: async () => new Promise(() => {}),
    close,
  }))
  const tools = wrapToolExecutes(
    createMcpMetaTools(
      mockCtx([{ _id: "id-make", name: "Make", url: "https://mcp.make.com" }]) as never,
      createClient as never,
    ),
    30,
  )
  const execute = (
    tools[CALL_MCP_TOOL] as {
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }
  ).execute
  const started = Date.now()
  const result = await execute({ name: "Make__slow", arguments: {} }, {})
  expect(Date.now() - started).toBeLessThan(400)
  expect(result).toEqual({ error: expect.stringMatching(/timed out after 30ms/) })
  warn.mockRestore()
})

test("chatStream n'appelle plus loadMcpTools au boot du stream", async () => {
  const source = await readFile(join(here, "../chatStream.ts"), "utf8")
  expect(source).not.toMatch(/loadMcpTools\s*\(/)
  expect(source).toMatch(/createMcpMetaTools/)
  expect(source).not.toMatch(/135 tools loaded/)
  expect(source).not.toMatch(/sending \$\{MAX_MCP_TOOLS_FOR_MODEL\}/)
})
