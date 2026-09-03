export type LeadOrigin = "chat" | "contact"

export function leadOrigin(lead: {
  source?: LeadOrigin
  threadId?: string
}): LeadOrigin {
  if (lead.source === "chat" || lead.source === "contact") return lead.source
  return lead.threadId ? "chat" : "contact"
}
