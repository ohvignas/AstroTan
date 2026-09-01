import { defineApp } from "convex/server"
import betterAuth from "./betterAuth/convex.config"
import resend from "@convex-dev/resend/convex.config.js"
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"
import agent from "@convex-dev/agent/convex.config"

const app = defineApp()
app.use(betterAuth)
app.use(resend)
app.use(rateLimiter)
app.use(agent)

export default app
