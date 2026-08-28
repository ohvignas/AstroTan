import { createFileRoute } from "@tanstack/react-router"

// Cible du `healthcheck` Docker du service `admin`. Aucune dépendance :
// ni session Better Auth, ni appel Convex (voir le raisonnement complet en
// tête de `apps/web/src/pages/api/health.ts`). Cette route ne dit qu'une
// chose : le wrapper `serve.mjs` écoute et le routeur répond.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
