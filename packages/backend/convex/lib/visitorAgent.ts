import { Agent, stepCountIs } from "@convex-dev/agent"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { ToolSet } from "ai"
import { ConvexError } from "convex/values"
import { components, internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { lireSecret } from "../secrets"
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
  const name = privee.agentDisplayName ?? "Assistant"
  const site = privee.siteName ?? "ce site"
  const identity = [`Tu es ${name}, l'assistant de ${site}.`, privee.agentInstructions?.trim() ?? ""]
    .filter((line) => line.length > 0)
    .join("\n")
  const knowledge = privee.agentKnowledge?.trim()
    ? `Base de connaissances:\n${privee.agentKnowledge.trim()}`
    : ""
  const rules = [
    "Ne jamais inventer un fait, un prix, un délai ou un engagement.",
    "Ne jamais citer une page brouillon ou un contenu non publié.",
    "Ne jamais promettre un créneau sans avoir utilisé l'outil calendrier.",
    "Si l'outil de lecture d'une page échoue, le dire clairement.",
    "Qualifier le besoin, le délai et un téléphone sans interroger en rafale.",
    "Répondre dans la langue du visiteur. Par défaut, le français.",
  ].join("\n")
  return [identity, knowledge, rules].filter((block) => block.length > 0).join("\n\n")
}

export async function makeVisitorAgent(ctx: ActionCtx, tools: ToolSet) {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (!apiKey) throw new ConvexError({ code: "AGENT_UNCONFIGURED" })
  const privee: AgentConfig = await ctx.runQuery(internal.chatStream.getAgentConfig, {})
  if (privee.agentEnabled === false) throw new ConvexError({ code: "AGENT_DISABLED" })
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
