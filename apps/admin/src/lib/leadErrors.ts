// Ce qu'un refus du serveur devient à l'écran, sur le tableau des leads.
//
// Il existe parce qu'un déplacement rejeté ne disait rien : `move` était
// appelé avec `void`, la promesse rejetée partait au néant, et la carte
// revenait à sa place. Rien ne distinguait « le serveur a refusé » de « je
// n'ai pas visé la bonne colonne » — et c'est la seconde lecture qu'on fait
// spontanément, donc on recommence, et on échoue encore.
//
// Même forme que `pageErrors.ts`, et une copie séparée pour la même raison :
// les CODES appartiennent à leur domaine.
import { ConvexError } from "convex/values"

const LEAD_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Action refusée par le serveur : vous n'avez pas l'autorité pour ceci.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND: "Cette fiche n'existe plus — elle a peut-être été supprimée ailleurs.",
}

export function describeLeadError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string" && LEAD_ERROR_MESSAGES[code]) {
        return LEAD_ERROR_MESSAGES[code]
      }
    }
  }
  // Le message brut plutôt qu'une phrase creuse : sur ce tableau, une panne
  // muette est précisément ce qu'on est en train de corriger.
  if (error instanceof Error && error.message) {
    return `Le déplacement a échoué : ${error.message}`
  }
  return "Le déplacement a échoué, et le serveur n'a pas dit pourquoi."
}
