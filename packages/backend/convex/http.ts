import { httpRouter } from "convex/server"
import { authComponent, createAuth } from "./auth"
import { registerSiteApi } from "./lib/apiHttp"

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
registerSiteApi(http)

export default http
