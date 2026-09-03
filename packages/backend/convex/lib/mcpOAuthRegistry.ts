import { api } from "../_generated/api"
import { MUTATION_REGISTRY } from "../_registry"

MUTATION_REGISTRY.push({
  name: "mcpOAuth.beginAuthorize",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    const id = await t.mutation(api.mcpServers.create, {
      name: "registre-oauth",
      transport: "sse",
      url: "https://mcp.make.com",
    })
    return t.action(api.mcpOAuth.beginAuthorize, { id })
  },
})

MUTATION_REGISTRY.push({
  name: "mcpOAuth.exchangeCode",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    const id = await t.mutation(api.mcpServers.create, {
      name: "registre-ex",
      transport: "sse",
      url: "https://mcp.make.com",
    })
    const { url } = (await t.action(api.mcpOAuth.beginAuthorize, { id })) as { url: string }
    const state = new URL(url).searchParams.get("state") ?? ""
    return t.action(api.mcpOAuth.exchangeCode, { code: "code-registre", state })
  },
})
