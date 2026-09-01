import type { FactLine } from "@/lib/postSeoFacts"

export function PostSeoFacts({ facts }: { facts: FactLine[] }) {
  return (
    <section>
      <h3 className="text-xs font-medium">Faits</h3>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {facts.map((fact) => (
          <li key={fact.id}>{fact.text}</li>
        ))}
      </ul>
    </section>
  )
}
