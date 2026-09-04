import { hashToken } from "./token"
import { timingSafeEqualHex } from "./previewToken"

export function extractBearer(headers: { authorization?: string | null }): string | null {
  const raw = headers.authorization
  if (typeof raw !== "string") return null
  const match = /^Bearer\s+(\S+)/i.exec(raw.trim())
  return match?.[1] ?? null
}

export async function hashesMatch(presented: string, storedHash: string): Promise<boolean> {
  const presentedHash = await hashToken(presented)
  return timingSafeEqualHex(presentedHash, storedHash)
}
