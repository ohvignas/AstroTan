import { nombre } from "./dashboardFormat"

/** Nouveau = pas encore ouvert. La colonne du tableau n'entre pas en ligne. */
export function estLeadNouveau(lead: { seenAt?: number }): boolean {
  return lead.seenAt === undefined
}

/** Pastille de la tuile accueil. Absente dès qu'il n'y a plus rien à ouvrir. */
export function alerteLeadsNouveaux(unseen: number): string | undefined {
  if (unseen <= 0) return undefined
  return `${nombre(unseen)} ${unseen > 1 ? "nouveaux" : "nouveau"}`
}
