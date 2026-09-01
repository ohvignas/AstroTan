// Première barrière HMAC des jetons de session chat — le clone discipliné
// de `previewToken.ts` : même wire format que Convex
// (`packages/backend/convex/lib/chatSessionToken.ts`), aucune
// implémentation partagée. Un bug d'un côté qui annulerait un bug de
// l'autre est précisément ce que deux barrières indépendantes existent
// pour exclure.
//
// Format : `${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex}`
// Message signé : `chatSession:${leadId}:${threadId}:${expiresAt}`
// Clé : `CHAT_SESSION_SECRET` (≥ 32), lue dans les fonctions, jamais
// mise en cache au chargement du module.
//
// `apps/web` tourne sur Node (`@astrojs/node` standalone), pas sur le
// runtime Convex (Web Crypto only). D'où `node:crypto` : `createHmac`
// synchrone, `timingSafeEqual` sur des digestes à largeur fixe.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

const MIN_CHAT_SESSION_SECRET_LENGTH = 32

function getChatSessionSecret(): string {
  const secret = process.env.CHAT_SESSION_SECRET
  if (!secret) {
    throw new Error("CHAT_SESSION_SECRET is not set on this Astro deployment")
  }
  if (secret.length < MIN_CHAT_SESSION_SECRET_LENGTH) {
    throw new Error(
      `CHAT_SESSION_SECRET must be at least ${MIN_CHAT_SESSION_SECRET_LENGTH} characters`,
    )
  }
  return secret
}

function buildMessage(leadId: string, threadId: string, expiresAt: number): string {
  return `chatSession:${leadId}:${threadId}:${expiresAt}`
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

// Hash des deux côtés avant `timingSafeEqual` : cette primitive jette sur
// des buffers de longueurs différentes, et `.length` JS n'est pas la
// longueur en octets. Un digest SHA-256 fait toujours 32 octets — plus
// aucune longueur qui puisse différer, donc plus de throw. Même leçon
// que `previewToken.ts`.
function timingSafeEqualHex(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest()
  const digestB = createHash("sha256").update(b, "utf8").digest()
  return timingSafeEqual(digestA, digestB)
}

function fromBase64Url(segment: string): string | null {
  if (segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
  if (segment.length % 4 === 1) return null
  try {
    return Buffer.from(segment, "base64url").toString("utf8")
  } catch {
    return null
  }
}

// Rend le payload, ou `null`. Ne jette jamais sur une entrée attaquant
// (malformée, expirée, trafiquée). `getChatSessionSecret()` est
// l'exception : un secret absent est une erreur de déploiement, pas une
// entrée, et doit échouer fort plutôt que refuser chaque jeton en silence.
export function verifyChatSessionToken(
  token: string,
  now = Date.now(),
): { leadId: string; threadId: string; expiresAt: number } | null {
  const secret = getChatSessionSecret()

  const parts = token.split(".")
  if (parts.length !== 4) return null
  const [expPart, leadPart, threadPart, sigPart] = parts
  if (!expPart || !leadPart || !threadPart || !sigPart) return null
  if (!/^\d+$/.test(expPart)) return null
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt)) return null

  const leadId = fromBase64Url(leadPart)
  const threadId = fromBase64Url(threadPart)
  if (leadId === null || threadId === null) return null

  const expected = hmacHex(secret, buildMessage(leadId, threadId, expiresAt))
  if (!timingSafeEqualHex(sigPart, expected)) return null

  if (!(now < expiresAt)) return null
  return { leadId, threadId, expiresAt }
}
