import type { Periode } from "@astrotan/backend/convex/analytics"
import type { RelevePoint } from "@astrotan/backend/convex/lib/seoSiteHistory"
import { etiquettePoint } from "@/lib/dashboardFormat"

export type SerieGraphe = "visites" | "position" | "backlinks" | "keywords"

export const LIBELLES_SERIE: Record<SerieGraphe, string> = {
  visites: "Visites",
  position: "Position moyenne",
  backlinks: "Backlinks",
  keywords: "Mots-clés",
}

/** Recliquer la pastille SEO active ne ramène pas aux visites. */
export function prochaineSerie(_actuelle: SerieGraphe, clic: SerieGraphe): SerieGraphe {
  return clic
}

/**
 * Un point par relevé. Aucun seau inventé entre deux lundis.
 */
export function pointsPourCourbe(
  points: RelevePoint[],
  periode: Periode,
): { etiquette: string; valeur: number }[] {
  return points.map((p) => ({
    etiquette: etiquettePoint(new Date(p.fetchedAt).toISOString(), periode),
    valeur: p.value,
  }))
}
