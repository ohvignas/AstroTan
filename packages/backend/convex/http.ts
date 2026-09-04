import { httpRouter } from "convex/server"
import { authComponent, createAuth } from "./auth"
import { registerSiteApi } from "./lib/apiHttp"
import { webhook as stripeWebhook } from "./payments"

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
registerSiteApi(http)
http.route({ path: "/stripe/webhook", method: "POST", handler: stripeWebhook })

export default http
