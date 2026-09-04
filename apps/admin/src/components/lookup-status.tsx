import { Loader2Icon } from "lucide-react"

/**
 * Ce que le bouton Vérifier montre pendant et après le lookup.
 *
 * Le bouton disabled tout seul ne prouve rien : l'œil a besoin d'un
 * spinner, d'une heure, ou d'une raison d'échec. Les trois états sont
 * mutuellement exclusifs — pendant, on ne montre ni la preuve ni
 * l'erreur d'un tour précédent.
 */

export function preuveLookup(verifieA: number, trouves: number): string {
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(verifieA))
  const mot = trouves <= 1 ? "enregistrement" : "enregistrements"
  return `Vérifié à ${heure} · Cloudflare : ${trouves} ${mot}`
}

export function erreurLookup({
  erreur,
  raisonsIndispo,
  apexNxdomain,
}: {
  erreur: string | null
  raisonsIndispo: string[]
  apexNxdomain: boolean
}): string | null {
  if (erreur !== null) return erreur
  if (raisonsIndispo.length > 0) {
    return raisonsIndispo[0] ?? "Pas de réponse du résolveur DNS."
  }
  if (apexNxdomain) return "Ce nom n'existe pas (NXDOMAIN)."
  return null
}

export function statutDuLookup(input: {
  enCours: boolean
  erreur: string | null
  verifieA: number | null
  trouves: number
  raisonsIndispo: string[]
  apexNxdomain: boolean
}): { enCours: boolean; preuve: string | null; erreur: string | null } {
  if (input.enCours) return { enCours: true, preuve: null, erreur: null }
  const erreur = erreurLookup({
    erreur: input.erreur,
    raisonsIndispo: input.raisonsIndispo,
    apexNxdomain: input.apexNxdomain,
  })
  if (erreur !== null) return { enCours: false, preuve: null, erreur }
  if (input.verifieA === null) return { enCours: false, preuve: null, erreur: null }
  return {
    enCours: false,
    preuve: preuveLookup(input.verifieA, input.trouves),
    erreur: null,
  }
}

export function StatutLookup({
  enCours,
  preuve,
  erreur,
}: {
  enCours: boolean
  preuve: string | null
  erreur: string | null
}) {
  if (enCours) {
    return (
      <p
        data-testid="lookup-pending"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
        Lecture du DNS…
      </p>
    )
  }
  if (erreur !== null) {
    return (
      <p data-testid="lookup-erreur" className="text-xs text-destructive">
        {erreur}
      </p>
    )
  }
  if (preuve !== null) {
    return (
      <p data-testid="lookup-preuve" className="text-xs text-muted-foreground">
        {preuve}
      </p>
    )
  }
  return null
}
