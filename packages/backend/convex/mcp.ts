import { internalAction } from "./_generated/server"
import { probeEnabledMcpServers } from "./lib/loadMcpTools"

export const listTools = internalAction({
  args: {},
  handler: async (ctx) => {
    const { servers, close } = await probeEnabledMcpServers(ctx, async (transport) => {
      const { createMCPClient } = await import("@ai-sdk/mcp")
      return createMCPClient(transport)
    })
    await close()
    return servers
  },
})
