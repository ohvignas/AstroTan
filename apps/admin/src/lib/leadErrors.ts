// Ce qu'un refus du serveur devient à l'écran, sur le tableau des leads.
//
// Il existe parce qu'un déplacement rejeté ne disait rien : `move` était
// appelé avec `void`, la promesse rejetée partait au néant, et la carte
// revenait à sa place. Rien ne distinguait « le serveur a refusé » de « je
// n'ai pas visé la bonne colonne » — et c'est la seconde lecture qu'on fait
// spontanément, donc on recommence, et on échoue encore.
//
// Même forme que `pageErrors.ts`, et une copie séparée pour la même raison :
// les CODES appartiennent à leur domaine. Le geste (`move` / `remove`)
// n'entre que dans le repli sans code : un timeout à l'ouverture ne doit
// jamais se faire passer pour un déplacement.
import { ConvexError } from "convex/values"

export type LeadErrorKind = "move" | "remove"

const LEAD_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Action refusée par le serveur : vous n'avez pas l'autorité pour ceci.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND: "Cette fiche n'existe plus — elle a peut-être été supprimée ailleurs.",
}

const FALLBACK: Record<LeadErrorKind, { withMessage: (message: string) => string; silent: string }> =
  {
    move: {
      withMessage: (message) => `Le déplacement a échoué : ${message}`,
      silent: "Le déplacement a échoué, et le serveur n'a pas dit pourquoi.",
    },
    remove: {
      withMessage: (message) => `La suppression a échoué : ${message}`,
      silent: "La suppression a échoué, et le serveur n'a pas dit pourquoi.",
    },
  }

export function describeLeadError(error: unknown, kind: LeadErrorKind): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string" && LEAD_ERROR_MESSAGES[code]) {
        return LEAD_ERROR_MESSAGES[code]
      }
    }
  }
  const fallback = FALLBACK[kind]
  if (error instanceof Error && error.message) {
    return fallback.withMessage(error.message)
  }
  return fallback.silent
}
