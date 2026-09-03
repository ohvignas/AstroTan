import { api } from "../_generated/api"
import { MUTATION_REGISTRY } from "../_registry"

MUTATION_REGISTRY.push({
  name: "mcpServers.create",
  allowedRoles: ["owner", "admin"],
  invoke: (t) =>
    t.mutation(api.mcpServers.create, {
      name: "registre",
      transport: "http",
      url: "https://example.com/mcp",
    }),
})

MUTATION_REGISTRY.push({
  name: "mcpServers.remove",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    const id = await t.mutation(api.mcpServers.create, {
      name: "registre-rm",
      transport: "http",
      url: "https://example.com/mcp",
    })
    return t.mutation(api.mcpServers.remove, { id })
  },
})

MUTATION_REGISTRY.push({
  name: "mcpServers.setEnabled",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    const id = await t.mutation(api.mcpServers.create, {
      name: "registre-en",
      transport: "http",
      url: "https://example.com/mcp",
    })
    return t.mutation(api.mcpServers.setEnabled, { id, enabled: false })
  },
})

MUTATION_REGISTRY.push({
  name: "mcpServers.setHeaders",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    const id = await t.mutation(api.mcpServers.create, {
      name: "registre-hd",
      transport: "http",
      url: "https://example.com/mcp",
    })
    return t.action(api.mcpServers.setHeaders, {
      id,
      headersJson: JSON.stringify({ Authorization: "Bearer registre" }),
    })
  },
})
