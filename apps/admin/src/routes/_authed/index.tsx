import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SiteDashboardPanel } from "@/components/site-dashboard"
import { TuilesContenu } from "@/components/dashboard-tiles"

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
})

// L'accueil de l'administration.
//
// Il répond à deux questions, dans cet ordre, parce que c'est l'ordre dans
// lequel on se les pose en ouvrant l'écran : **comment va le site**, puis
// **qu'est-ce qui m'attend**. La courbe d'audience occupe donc la première
// place, et les tuiles de contenu la seconde — l'inverse ferait scruter des
// compteurs avant de savoir si quelqu'un est passé.
//
// L'identité de la session et le rôle ne sont nulle part ici : ils sont
// dans la barre latérale, et les répéter occupait la première place de
// l'écran sans rien apprendre.
function DashboardPage() {
  // `undefined` pendant le chargement, `null` si Umami n'est pas configuré.
  const umami = useQuery(api.analytics.umamiLinks)
  // Une query, donc réactive : un lead qui arrive fait bouger la tuile sans
  // rechargement. Un tableau de bord dont les compteurs ne bougent pas est
  // un tableau de bord qui ment jusqu'à la prochaine touche F5.
  const overview = useQuery(api.dashboard.overview)

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SiteDashboardPanel umami={umami} />
      <TuilesContenu overview={overview} />
    </div>
  )
}
