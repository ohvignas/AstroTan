import { Agent, stepCountIs } from "@convex-dev/agent"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { ToolSet } from "ai"
import { ConvexError } from "convex/values"
import { components, internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { lireSecret } from "../secrets"
import { MINIMAL_AGENT_INSTRUCTIONS } from "./defaultAgentInstructions"
import { resolveOpenRouterModel } from "./openRouterModels"

export type AgentConfig = {
  agentKnowledge: string | null
  openRouterModel: string | null
  agentEnabled: boolean
  siteName: string | null
  agentDisplayName: string | null
  agentInstructions: string | null
}

export function buildInstructions(privee: AgentConfig): string {
  const authored = privee.agentInstructions?.trim() ?? ""
  const brief = authored.length > 0 ? authored : MINIMAL_AGENT_INSTRUCTIONS
  const knowledge = privee.agentKnowledge?.trim()
    ? `Base de connaissances:\n${privee.agentKnowledge.trim()}`
    : ""
  return [brief, knowledge].filter((block) => block.length > 0).join("\n\n")
}

export async function makeVisitorAgent(
  ctx: ActionCtx,
  tools: ToolSet,
  options?: { preview?: boolean },
) {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (!apiKey) throw new ConvexError({ code: "AGENT_UNCONFIGURED" })
  const privee: AgentConfig = await ctx.runQuery(internal.chatStream.getAgentConfig, {})
  if (privee.agentEnabled === false && options?.preview !== true) {
    throw new ConvexError({ code: "AGENT_DISABLED" })
  }
  const openrouter = createOpenRouter({
    apiKey,
    appName: "AstroTan",
    appUrl: process.env.WEB_SITE_URL,
  })
  return new Agent(components.agent, {
    name: privee.agentDisplayName ?? "Assistant",
    languageModel: openrouter.chat(resolveOpenRouterModel(privee.openRouterModel)),
    instructions: buildInstructions(privee),
    tools,
    stopWhen: stepCountIs(8),
  })
}
