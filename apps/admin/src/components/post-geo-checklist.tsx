import type { GeoCheckItem } from "@/lib/geoChecklist"

export function PostGeoChecklist({ items }: { items: GeoCheckItem[] }) {
  return (
    <section>
      <h3 className="text-xs font-medium">GEO</h3>
      <ul className="mt-1 space-y-1 text-xs">
        {items.map((item) => (
          <li key={item.id} className={toneClass(item.status)}>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

function toneClass(status: GeoCheckItem["status"]): string {
  if (status === "missing" || status === "blocked") return "text-destructive"
  if (status === "pending" || status === "warn") return "text-muted-foreground"
  return "text-muted-foreground"
}
