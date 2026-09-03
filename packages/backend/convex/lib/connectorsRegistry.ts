import { api } from "../_generated/api"
import { MUTATION_REGISTRY } from "../_registry"

MUTATION_REGISTRY.push({
  name: "connectors.updateGoogle",
  allowedRoles: ["owner", "admin"],
  invoke: (t) =>
    t.mutation(api.connectors.updateGoogle, {
      googleCalendarClientId: "client.apps.googleusercontent.com",
    }),
})

MUTATION_REGISTRY.push({
  name: "connectors.storeGoogleRefresh",
  allowedRoles: ["owner", "admin"],
  invoke: (t) =>
    t.action(api.connectors.storeGoogleRefresh, { refreshToken: "refresh-registre" }),
})

MUTATION_REGISTRY.push({
  name: "connectors.exchangeGoogleCode",
  allowedRoles: ["owner", "admin"],
  invoke: async (t) => {
    await t.mutation(api.connectors.updateGoogle, {
      googleCalendarClientId: "registre.apps.googleusercontent.com",
    })
    await t.action(api.secrets.set, {
      nom: "GOOGLE_CALENDAR_CLIENT_SECRET",
      valeur: "secret-registre",
    })
    return t.action(api.connectors.exchangeGoogleCode, { code: "code-registre" })
  },
})

MUTATION_REGISTRY.push({
  name: "connectors.disconnectGoogle",
  allowedRoles: ["owner", "admin"],
  invoke: (t) => t.mutation(api.connectors.disconnectGoogle, {}),
})
