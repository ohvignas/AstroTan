// Livrable du lot 5, spec §9 (réponse Q2 du spike d'intégration).
//
// `vite build` (TanStack Start) produit `dist/server/server.js`, qui n'est
// PAS un serveur : il exporte `default = { fetch }`, un handler au format
// Web Fetch. `node dist/server/server.js` charge le module, n'ouvre aucun
// socket, et le processus sort — ce qui, dans un conteneur, ressemble
// exactement à un crash au démarrage. Ce fichier est le seul point qui
// transforme ce handler en processus qui écoute.
//
// Le chemin d'import est relatif à ce fichier : l'image de production copie
// `serve.mjs` et `dist/` côte à côte sous `/app` (docker/admin.Dockerfile),
// la même disposition que le dépôt.
import { fileURLToPath } from "node:url"
import { serve } from "srvx"
import handler from "./dist/server/server.js"
import { responseFromClientFile } from "./serve-static.mjs"

const clientDir = fileURLToPath(new URL("./dist/client/", import.meta.url))

// `hostname: "0.0.0.0"` et non le défaut : dans un conteneur, écouter sur
// la loopback rend le service injoignable depuis Traefik comme depuis le
// healthcheck, sans le moindre message d'erreur.
//
// Le handler TanStack Start ne sert pas `dist/client` : sans ce filet,
// le HTML répond 200 et chaque `/assets/*.js` tombe en 404 — page bloquée
// sur « Chargement… ».
serve({
  fetch: async (request) => {
    const pathname = new URL(request.url).pathname
    if (pathname !== "/" && !pathname.startsWith("/api/")) {
      const file = await responseFromClientFile(clientDir, pathname)
      if (file !== null) return file
    }
    return handler.fetch(request)
  },
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
})
