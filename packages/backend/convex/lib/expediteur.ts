import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"

// L'adresse d'expédition, décidée à un seul endroit.
//
// Elle était écrite en dur dans `invitations.ts` et `leads.ts`, sur
// `onboarding@resend.dev` — le BAC À SABLE de Resend, qui ne délivre qu'aux
// adresses de test du service. En production, aucune invitation et aucune
// notification n'arrivait, et rien ne le disait.

export const EXPEDITEUR_BAC_A_SABLE = "AstroTan <onboarding@resend.dev>"

/** `bonjour@exemple.fr` ou `Nom <bonjour@exemple.fr>`, les deux formes que Resend accepte. */
export function estAdresseValide(valeur: string): boolean {
  const brut = valeur.trim()
  const adresse = brut.includes("<") ? (brut.split("<")[1]?.split(">")[0] ?? "") : brut
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(adresse)
}

/**
 * L'adresse à utiliser, avec repli VISIBLE.
 *
 * Le repli est le bac à sable et non une adresse plausible : le bac à sable
 * échoue de façon voyante (rien n'arrive sauf aux adresses de test), là où
 * un domaine non vérifié échoue en silence côté Resend.
 */
export function choisirExpediteur(regle: string | undefined): string {
  const brut = regle?.trim() ?? ""
  if (brut.length === 0 || !estAdresseValide(brut)) return EXPEDITEUR_BAC_A_SABLE
  return brut
}

/** La même décision, avec la lecture du réglage. */
export async function resoudreExpediteur(ctx: ActionCtx): Promise<string> {
  const regle = await ctx.runQuery(internal.settings.expediteur, {})
  return choisirExpediteur(regle ?? undefined)
}
