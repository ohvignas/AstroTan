import { useQuery } from "convex/react"
import { anyApi } from "convex/server"

const jeSuisDemoQuery = anyApi.demo.jeSuisDemo

export function DemoBanner() {
  const jeSuisDemo = useQuery(jeSuisDemoQuery)
  if (jeSuisDemo !== true) return null
  return (
    <div
      role="status"
      className="border-b bg-muted px-4 py-2 text-center text-sm"
    >
      Bac à sable partagé — vos brouillons sont effacés toutes les heures. Rien
      n'est publié sur le site.
    </div>
  )
}
