import { BarChart3Icon, FlaskConicalIcon, HashIcon } from "lucide-react"
import type { FactLine } from "@/lib/postSeoFacts"

const ICONS = {
  rank: HashIcon,
  umami: BarChart3Icon,
  labs: FlaskConicalIcon,
}

/**
 * Le rang, l'audience et le snapshot Labs — des mesures, pas des verdicts.
 *
 * Discrets par construction : ni pastille de couleur ni accordéon. Les
 * trois seules couleurs du panneau restent celles des critères, qui, eux,
 * demandent une action.
 */
export function PostSeoFacts({ facts }: { facts: FactLine[] }) {
  return (
    <section aria-label="Faits" className="border-t border-border pt-2.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Faits
      </h3>
      <ul className="mt-1.5 flex flex-col gap-1">
        {facts.map((fact) => {
          const Icon = ICONS[fact.id]
          return (
            <li
              key={fact.id}
              className="flex items-start gap-2 text-xs leading-snug text-muted-foreground"
            >
              <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {/* `fact.text` nomme déjà sa mesure (« Rang relevé : 7. ») :
                  répéter `fact.title` devant donnait « Rang : Rang relevé ». */}
              <span>{fact.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
