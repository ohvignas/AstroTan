import { httpRouter } from "convex/server"
import { authComponent, createAuth } from "./auth"
import { registerSiteApi } from "./lib/apiHttp"
import { registerStripe } from "./lib/stripeHttp"

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
registerSiteApi(http)
registerStripe(http)

export default http
