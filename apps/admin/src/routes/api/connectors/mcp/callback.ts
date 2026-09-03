import { createFileRoute } from "@tanstack/react-router"
import { api } from "@astrotan/backend/convex/_generated/api"
import { fetchAuthAction } from "@/lib/auth-server"
import { MCP_OAUTH_MESSAGE_TYPE } from "@/lib/mcpAuthorize"

function popupHtml(ok: boolean): string {
  const flag = ok ? "true" : "false"
  return `<!doctype html>
<title>Connecteur MCP</title>
<script>
  const ok = ${flag};
  const payload = { type: ${JSON.stringify(MCP_OAUTH_MESSAGE_TYPE)}, ok };
  if (window.opener && window.opener !== window) {
    window.opener.postMessage(payload, window.location.origin);
    window.close();
  } else {
    location.replace("/settings/agent?mcp=" + (ok ? "ok" : "erreur"));
  }
</script>
`
}

export const Route = createFileRoute("/api/connectors/mcp/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const incoming = new URL(request.url)
        const code = incoming.searchParams.get("code")
        const state = incoming.searchParams.get("state")
        const error = incoming.searchParams.get("error")
        let ok = false
        if (!error && code && state) {
          try {
            await fetchAuthAction(api.mcpOAuth.exchangeCode, { code, state })
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
