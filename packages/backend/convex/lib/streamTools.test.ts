import { expect, test, vi } from "vitest"
import {
  MAX_MCP_TOOLS_FOR_MODEL,
  STREAM_RETRY_TIMEOUT_MS,
  STREAM_TEXT_TIMEOUT_MS,
  STREAM_WITH_MCP_TIMEOUT_MS,
  planStreamRecovery,
  runStreamTextBounded,
  selectToolsForModel,
  shouldWriteStreamFallback,
  wrapToolExecutes,
} from "./streamTools"

test("selectToolsForModel garde tout sous le plafond", () => {
  const tools = { a: { description: "a" }, b: { description: "b" } }
  expect(selectToolsForModel(tools, 8)).toBe(tools)
})

test("selectToolsForModel plafonne sans vider Make, préfère scenarios_list", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const tools: Record<string, { description: string }> = {}
  for (let i = 0; i < 135; i++) tools[`Make__misc_${i}`] = { description: "x" }
  tools["Make__scenarios_list"] = { description: "list" }
  tools["Make__scenarios_run"] = { description: "run" }
  const picked = selectToolsForModel(tools)
  expect(Object.keys(picked)).toHaveLength(MAX_MCP_TOOLS_FOR_MODEL)
  expect(picked.Make__scenarios_list).toBe(tools.Make__scenarios_list)
  expect(picked.Make__scenarios_run).toBe(tools.Make__scenarios_run)
  expect(warn.mock.calls[0]?.[0]).toMatch(/137 tools loaded, sending 48/)
  warn.mockRestore()
})

test("wrapToolExecutes coupe un execute qui hang et rend une erreur", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const wrapped = wrapToolExecutes(
    {
      Make__slow: {
        description: "slow",
        execute: async () => new Promise(() => {}),
      },
    },
    30,
  )
  const started = Date.now()
  const execute = (wrapped.Make__slow as { execute: (input: unknown, options: unknown) => Promise<unknown> })
    .execute
  const result = await execute({}, {})
  expect(Date.now() - started).toBeLessThan(400)
  expect(result).toEqual({ error: expect.stringMatching(/timed out after 30ms/) })
  warn.mockRestore()
})

test("shouldWriteStreamFallback sauve un AbortError, pas un AGENT_*", () => {
  const abort = new DOMException("This operation was aborted", "AbortError")
  expect(shouldWriteStreamFallback(abort)).toBe(true)
  expect(shouldWriteStreamFallback(new Error("chatStream timed out after 60000ms"))).toBe(true)
  expect(shouldWriteStreamFallback({ data: { code: "AGENT_UNCONFIGURED" } })).toBe(false)
  expect(shouldWriteStreamFallback({ data: { code: "AGENT_DISABLED" } })).toBe(false)
})

test("runStreamTextBounded sort d'un hang sans laisser AbortError s'échapper", async () => {
  const abort = new AbortController()
  const work = new Promise<never>(() => {})
  const started = Date.now()
  const outcome = await runStreamTextBounded(work, abort, 40)
  expect(Date.now() - started).toBeLessThan(400)
  expect(outcome.ok).toBe(false)
  expect(abort.signal.aborted).toBe(true)
  if (!outcome.ok) {
    expect(outcome.error).toEqual(expect.objectContaining({ message: expect.stringMatching(/timed out/) }))
  }
})

test("runStreamTextBounded n'échappe pas si abort() lève AbortError (abortFromSignal)", async () => {
  const abort = {
    abort: () => {
      throw new DOMException("This operation was aborted", "AbortError")
    },
    signal: { aborted: false },
  } as AbortController
  const work = new Promise<never>(() => {})
  await expect(runStreamTextBounded(work, abort, 30)).resolves.toEqual({
    ok: false,
    error: expect.objectContaining({ message: expect.stringMatching(/timed out/) }),
  })
})

test("essai MCP + retry tiennent sous le timeout client de 60 s", () => {
  expect(STREAM_WITH_MCP_TIMEOUT_MS + STREAM_RETRY_TIMEOUT_MS).toBeLessThanOrEqual(
    STREAM_TEXT_TIMEOUT_MS,
  )
})

test("planStreamRecovery relance sans MCP si Make a cassé l'appel", () => {
  const timeout = new Error("chatStream timed out after 25000ms")
  expect(
    planStreamRecovery({ error: timeout, mcpToolCount: 48, alreadyRetriedWithoutMcp: false }),
  ).toBe("retry-without-mcp")
  expect(
    planStreamRecovery({ error: timeout, mcpToolCount: 48, alreadyRetriedWithoutMcp: true }),
  ).toBe("fallback")
  expect(
    planStreamRecovery({ error: timeout, mcpToolCount: 0, alreadyRetriedWithoutMcp: false }),
  ).toBe("fallback")
  expect(
    planStreamRecovery({
      error: { data: { code: "AGENT_UNCONFIGURED" } },
      mcpToolCount: 48,
      alreadyRetriedWithoutMcp: false,
    }),
  ).toBe("throw")
})
