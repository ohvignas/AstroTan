// Cible du `healthcheck` Docker du service `web` (docker/docker-compose.yml).
// Délibérément sans aucune dépendance : pas d'appel Convex, pas de lecture
// d'env, pas de secret comparé. Un healthcheck qui interroge Convex
// transforme une panne du backend en boucle de redémarrage du conteneur —
// le conteneur, lui, sert encore parfaitement ses pages prérendues et son
// cache. Ce que cette route atteste, et rien de plus : « ce processus Node
// accepte des connexions HTTP et route ».
export const prerender = false

import type { APIRoute } from "astro"

export const GET: APIRoute = (context) => {
  // Même opt-out explicite que `/api/revalidate` : la documentation Astro
  // fait de cet appel l'opt-out, pas l'absence d'entrée dans `routeRules`.
  context.cache.set(false)
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}
