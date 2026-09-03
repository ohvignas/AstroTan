export const MCP_TOOL_EXECUTE_TIMEOUT_MS = 20_000
export const MAX_MCP_TOOLS_FOR_MODEL = 48
export const STREAM_TEXT_TIMEOUT_MS = 60_000
/** Premier essai avec tools MCP : assez court pour relancer sans tools sous 60 s. */
export const STREAM_WITH_MCP_TIMEOUT_MS = 25_000
export const STREAM_RETRY_TIMEOUT_MS = 30_000
export const STREAM_FALLBACK_TEXT = "Je n'ai pas pu terminer. Réessayez dans un instant."
export const STREAM_FALLBACK_ID = "stream-fallback"

export type StreamRecovery = "retry-without-mcp" | "fallback" | "throw"

export function shouldWriteStreamFallback(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: string } }).data?.code
      : undefined
  return code !== "AGENT_UNCONFIGURED" && code !== "AGENT_DISABLED"
}

export function planStreamRecovery(input: {
  error: unknown
  mcpToolCount: number
  alreadyRetriedWithoutMcp: boolean
}): StreamRecovery {
  if (!shouldWriteStreamFallback(input.error)) return "throw"
  if (input.mcpToolCount > 0 && !input.alreadyRetriedWithoutMcp) return "retry-without-mcp"
  return "fallback"
}

/** abortFromSignal du DeltaStreamer lève AbortError hors de `work` — ne jamais le laisser sortir. */
export function safeAbort(abort?: AbortController): void {
  if (!abort || abort.signal.aborted) return
  try {
    abort.abort()
  } catch {
    // AI SDK + @convex-dev/agent : l'abort doit couper le stream, pas l'action Convex.
  }
}

/**
 * streamText (AI SDK) streame ou rejette. Un hang + abort mal empilé avale l'erreur
 * et laisse l'action ouverte : on borne, on abort sans throw, on rend { ok:false }.
 */
export async function runStreamTextBounded<T>(
  work: Promise<T>,
  abort?: AbortController,
  timeoutMs = STREAM_TEXT_TIMEOUT_MS,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    const value = await withTimeout(work, timeoutMs, "chatStream")
    return { ok: true, value }
  } catch (error) {
    void work.catch(() => {})
    safeAbort(abort)
    return { ok: false, error }
  }
}

const PREFERRED_TOOL = /list|search|get|find|run|create|scenario|module|data|hook/i

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function selectToolsForModel<T extends Record<string, unknown>>(
  tools: T,
  max = MAX_MCP_TOOLS_FOR_MODEL,
): T {
  const entries = Object.entries(tools)
  if (entries.length <= max) return tools
  const preferred = entries.filter(([name]) => PREFERRED_TOOL.test(name))
  const rest = entries.filter(([name]) => !PREFERRED_TOOL.test(name))
  const picked = [...preferred, ...rest].slice(0, max)
  console.warn(`mcp: ${entries.length} tools loaded, sending ${picked.length} to the model`)
  return Object.fromEntries(picked) as T
}

export function wrapToolExecutes<T extends Record<string, unknown>>(
  tools: T,
  timeoutMs = MCP_TOOL_EXECUTE_TIMEOUT_MS,
): T {
  const out: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== "object") {
      out[name] = tool
      continue
    }
    const execute = "execute" in tool ? tool.execute : undefined
    if (typeof execute !== "function") {
      out[name] = tool
      continue
    }
    out[name] = {
      ...tool,
      execute: async (input: unknown, options: unknown) => {
        try {
          return await withTimeout(
            Promise.resolve(execute(input, options)),
            timeoutMs,
            `tool ${name}`,
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`tool:${name}: ${message}`)
          return { error: message }
        }
      },
    }
  }
  return out as T
}
