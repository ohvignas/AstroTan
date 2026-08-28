import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authed/statistiques")({
  component: StatistiquesRelais,
})

// Un relais, pas un écran : il frappe le jeton d'échange d'Umami puis s'en
// va. Il existe parce que l'adresse n'est connue qu'après un appel réseau,
// et qu'il n'y a que deux façons d'ouvrir une page dans ce cas.
//
// La première — ouvrir un onglet vide au clic et le remplir ensuite — a été
// écartée après l'avoir essayée : `window.open` est bloquée par certains
// navigateurs et contextes embarqués même dans un vrai geste utilisateur, et
// le bouton ne faisait alors rien du tout. Un lien qui ne fait rien est le
// pire résultat possible.
//
// Celle-ci ne peut pas être bloquée : la barre latérale pointe une ancre
// ordinaire vers cette route, le navigateur l'ouvre comme n'importe quel
// lien, et c'est cette page — déjà chargée — qui redirige.
function StatistiquesRelais() {
  const ssoLink = useAction(api.analytics.ssoLink)
  const umami = useQuery(api.analytics.umamiLinks)
  const [echec, setEchec] = useState(false)

  useEffect(() => {
    // Attendre les liens de repli : sans eux, un échec du SSO n'aurait nulle
    // part où retomber.
    if (umami === undefined) return

    let vivant = true
    ssoLink({})
      .then((url) => {
        if (!vivant) return
        // `null` quand Umami ne peut pas frapper de jeton — Redis absent,
        // identifiants refusés. Sa page de connexion reste une issue.
        const destination = url ?? umami?.dashboard
        if (destination) window.location.replace(destination)
        else setEchec(true)
      })
      .catch(() => {
        if (!vivant) return
        if (umami) window.location.replace(umami.dashboard)
        else setEchec(true)
      })
    return () => {
      vivant = false
    }
  }, [ssoLink, umami])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{echec ? "Statistiques indisponibles" : "Ouverture d'Umami…"}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {echec
          ? "Aucune mesure d'audience n'est configurée sur ce déploiement."
          : "Connexion en cours, vous allez être redirigé."}
      </CardContent>
    </Card>
  )
}
