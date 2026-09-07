import { Component, type ReactNode } from "react"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"

/**
 * Tient les listes du menu abonnées tant que le shell est monté.
 *
 * `useQuery` se désabonne au démontage : quitter `/posts` lâchait
 * `posts.list`, y revenir renvoyait `undefined` le temps que Convex
 * self-host réponde — « Chargement… » 600–1400 ms, même à chaud, JS
 * déjà en cache. `profiles.me` échappait à ça parce que `AppShell`
 * le souscrit déjà. Même geste ici.
 */
export function WarmNavQueries() {
  return (
    <WarmQueryBoundary>
      <WarmNavSubscriptions />
    </WarmQueryBoundary>
  )
}

function WarmNavSubscriptions() {
  useQuery(api.posts.list)
  useQuery(api.pages.list)
  useQuery(api.settings.homePageSlug)
  return null
}

class WarmQueryBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}
