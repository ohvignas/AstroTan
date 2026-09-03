export const DEFAULT_AGENT_AVATAR_PATH = "/agent-avatar.png"

export function resolveAgentAvatarUrl(url: string | null | undefined): string {
  const trimmed = url?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : DEFAULT_AGENT_AVATAR_PATH
}
