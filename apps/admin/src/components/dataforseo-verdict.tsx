import type { DataForSeoIssue } from "@astrotan/backend/convex/lib/dataforseo"
import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react"

/**
 * Ce que l'écran dit de chaque issue d'un essai DataForSEO.
 *
 * **La couleur ne porte jamais le verdict à elle seule** : une icône et une
 * phrase le disent aussi, et le `role` l'annonce à un lecteur d'écran.
 *
 * Chaque échec nomme sa sortie de secours. Un refus sans « et maintenant ? »
 * envoie chercher du côté des permissions une faute qui est presque
 * toujours un caractère perdu au collage — et il dit aussi que rien n'a
 * été écrit, sans quoi l'opérateur ne sait pas s'il doit recommencer ou
 * réparer.
 */
const VERDICTS: Record<
  DataForSeoIssue,
  { texte: string; role: "status" | "alert"; classe: string }
> = {
  valide: {
    texte: "Connecté",
    role: "status",
    classe: "text-emerald-600 dark:text-emerald-400",
  },
  refuse: {
    texte:
      "Identifiants refusés : rien n'a été enregistré. Recopiez le mot de passe d'API depuis la page API access.",
    role: "alert",
    classe: "text-destructive",
  },
  injoignable: {
    texte:
      "Service injoignable : les identifiants n'ont pas pu être essayés, et rien n'a été enregistré. Réessayez dans un moment.",
    role: "alert",
    classe: "text-destructive",
  },
}

const ICONES: Record<DataForSeoIssue, typeof CheckIcon> = {
  valide: CheckIcon,
  refuse: XIcon,
  injoignable: TriangleAlertIcon,
}

export function FeedbackDataForSeo({ verdict }: { verdict: DataForSeoIssue }) {
  const { texte, role, classe } = VERDICTS[verdict]
  const Icone = ICONES[verdict]
  return (
    <p role={role} className={`flex items-start gap-1.5 text-sm ${classe}`}>
      <Icone aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{texte}</span>
    </p>
  )
}
