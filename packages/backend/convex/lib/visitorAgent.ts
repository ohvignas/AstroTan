import { Agent, stepCountIs } from "@convex-dev/agent"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { ToolSet } from "ai"
import { ConvexError } from "convex/values"
import { components, internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { lireSecret } from "../secrets"
import { MINIMAL_AGENT_INSTRUCTIONS } from "./defaultAgentInstructions"
import { resolveOpenRouterAgentModel } from "./openRouterModels"
import { demoSandboxActif, modeleSandbox } from "./demoSandbox"
import {
  emptyVisitorFacts,
  formatVisitorContextBlock,
  type VisitorStreamFacts,
} from "./visitorContext"

export type AgentConfig = {
  agentKnowledge: string | null
  openRouterModel: string | null
  openRouterAgentModel: string | null
  agentEnabled: boolean
  siteName: string | null
  agentDisplayName: string | null
  agentInstructions: string | null
  visitor?: VisitorStreamFacts | null
}

export function buildInstructions(
  privee: AgentConfig,
  extras?: { nowMs: number; calendarConnected?: boolean },
): string {
  const authored = privee.agentInstructions?.trim() ?? ""
  const brief = authored.length > 0 ? authored : MINIMAL_AGENT_INSTRUCTIONS
  const knowledge = privee.agentKnowledge?.trim()
    ? `Base de connaissances:\n${privee.agentKnowledge.trim()}`
    : ""
  const context =
    extras === undefined
      ? ""
      : formatVisitorContextBlock({
          ...(privee.visitor ?? emptyVisitorFacts()),
          siteName: privee.visitor?.siteName ?? privee.siteName,
          nowMs: extras.nowMs,
          calendarConnected: extras.calendarConnected === true,
        })
  return [brief, knowledge, context].filter((block) => block.length > 0).join("\n\n")
}

export async function makeVisitorAgent(
  ctx: ActionCtx,
  tools: ToolSet,
  options?: { preview?: boolean; threadId?: string; calendarConnected?: boolean },
) {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (!apiKey) throw new ConvexError({ code: "AGENT_UNCONFIGURED" })
  const privee: AgentConfig = await ctx.runQuery(internal.chatStream.getAgentConfig, {
    threadId: options?.threadId,
  })
  if (privee.agentEnabled === false && options?.preview !== true) {
    throw new ConvexError({ code: "AGENT_DISABLED" })
  }
  const openrouter = createOpenRouter({
    apiKey,
    appName: "AstroTan",
    appUrl: process.env.WEB_SITE_URL,
  })
  const env = process.env
  let model: string
  if (demoSandboxActif(env)) {
    const slug = modeleSandbox({}, env)
    if (!slug) throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })
    model = slug
  } else {
    model = resolveOpenRouterAgentModel(privee.openRouterAgentModel, privee.openRouterModel)
  }
  return new Agent(components.agent, {
    name: privee.agentDisplayName ?? "Assistant",
    languageModel: openrouter.chat(model),
    instructions: buildInstructions(privee, {
      nowMs: Date.now(),
      calendarConnected: options?.calendarConnected === true,
    }),
    tools,
    stopWhen: stepCountIs(8),
  })
}
