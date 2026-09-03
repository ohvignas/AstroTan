import { createFileRoute } from "@tanstack/react-router"
import { api } from "@astrotan/backend/convex/_generated/api"
import { fetchAuthAction } from "@/lib/auth-server"

function popupHtml(ok: boolean): string {
  const flag = ok ? "true" : "false"
  return `<!doctype html>
<title>Google Agenda</title>
<script>
  const ok = ${flag};
  const payload = { type: "astrotan-google-calendar", ok };
  if (window.opener && window.opener !== window) {
    window.opener.postMessage(payload, window.location.origin);
    window.close();
  } else {
    location.replace("/settings/agent?calendar=" + (ok ? "ok" : "erreur"));
  }
</script>
`
}

export const Route = createFileRoute("/api/connectors/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const incoming = new URL(request.url)
        const code = incoming.searchParams.get("code")
        const error = incoming.searchParams.get("error")
        let ok = false
        if (!error && code) {
          try {
            await fetchAuthAction(api.connectors.exchangeGoogleCode, { code })
            ok = true
          } catch {
            ok = false
          }
        }
        return new Response(popupHtml(ok), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      },
    },
  },
})
