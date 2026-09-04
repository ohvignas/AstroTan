import { useEffect, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { PlusIcon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import { AgentConnectorCard } from "@/components/agent-connector-card"
import { AgentGoogleConnectDialog } from "@/components/agent-google-connect-dialog"
import { AgentMcpDialog } from "@/components/agent-mcp-dialog"
import { AgentMcpList } from "@/components/agent-mcp-list"
import { GoogleCalendarMark } from "@/components/google-calendar-mark"
import type { SecretsBloc } from "@/components/settings-environment"
import { Button } from "@/components/ui/button"
import { launchGoogleOAuth } from "@/lib/oauthPopup"

// AgentMcpDialog appelle api.mcpServers.create ; inferMcpTransport choisit http | sse.

export function AgentConnectorsRow({
  canWrite,
  secrets,
  calendar,
  declaredDomain,
}: {
  canWrite: boolean
  secrets: SecretsBloc
  calendar?: "ok" | "erreur"
  declaredDomain: string | null
}) {
  const status = useQuery(api.connectors.googleStatus, canWrite ? {} : "skip")
  const authUrl = useQuery(
    api.connectors.googleAuthUrl,
    canWrite && status?.ready ? {} : "skip",
  )
  const disconnect = useMutation(api.connectors.disconnectGoogle)
  const updateGoogle = useMutation(api.connectors.updateGoogle)
  const servers = useQuery(api.mcpServers.list)
  const remove = useMutation(api.mcpServers.remove)
  const [googleOpen, setGoogleOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(
    calendar === "erreur" ? "La connexion Google a été refusée ou interrompue." : null,
  )
  const [pendingLaunch, setPendingLaunch] = useState(false)

  function onGoogleResult(ok: boolean) {
    setGoogleError(ok ? null : "La connexion Google a été refusée ou interrompue.")
    setGoogleOpen(false)
  }

  useEffect(() => {
    if (!pendingLaunch || !authUrl?.url) return
    setPendingLaunch(false)
    launchGoogleOAuth(authUrl.url, onGoogleResult)
  }, [pendingLaunch, authUrl])

  async function continueToGoogle() {
    if (authUrl?.url) {
      launchGoogleOAuth(authUrl.url, onGoogleResult)
      return
    }
    setPendingLaunch(true)
  }

  const connected = status?.connected === true
  const envRefresh = status?.refreshSource === "environnement"
  const agendaLabel =
    status?.calendarId && status.calendarId !== "primary"
      ? status.calendarId
      : "Agenda principal"

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {connected ? (
          <AgentConnectorCard
            mark={<GoogleCalendarMark />}
            title={status?.email ?? "Compte Google Agenda"}
            subtitle={`Connecté · ${agendaLabel}`}
            action={
              <Button
                variant="ghost"
                className="min-h-11 shrink-0"
                disabled={!canWrite || envRefresh}
                onClick={() => void disconnect()}
              >
                Déconnecter
              </Button>
            }
          />
        ) : (
          <Button
            className="min-h-16 w-full"
            disabled={!canWrite}
            onClick={() => setGoogleOpen(true)}
          >
            <GoogleCalendarMark />
            Connecter son agenda
          </Button>
        )}
        <AgentMcpList
          canWrite={canWrite}
          servers={servers}
          onRemove={(id) => void remove({ id })}
        />
      </div>
      <Button
        variant="outline"
        className="min-h-11 w-fit"
        disabled={!canWrite}
        onClick={() => setMcpOpen(true)}
      >
        <PlusIcon data-icon="inline-start" />
        Ajouter un connecteur
      </Button>
      {envRefresh ? (
        <p className="text-sm text-muted-foreground">
          Ce jeton vient de l'environnement Convex.
        </p>
      ) : null}
      {googleError ? (
        <p role="alert" className="text-sm text-destructive">
          {googleError}
        </p>
      ) : null}
      <AgentGoogleConnectDialog
        open={googleOpen}
        ready={status?.ready === true}
        declaredDomain={declaredDomain}
        clientSecret={secrets.etats.GOOGLE_CALENDAR_CLIENT_SECRET}
        onOpenChange={setGoogleOpen}
        onSaveIds={async (clientId, calendarId) => {
          await updateGoogle({
            googleCalendarClientId: clientId,
            googleCalendarId: calendarId,
          })
        }}
        onSaveSecret={(valeur) => secrets.onSave("GOOGLE_CALENDAR_CLIENT_SECRET", valeur)}
        onClearSecret={() => secrets.onClear("GOOGLE_CALENDAR_CLIENT_SECRET")}
        onContinue={continueToGoogle}
      />
      <AgentMcpDialog open={mcpOpen} onOpenChange={setMcpOpen} />
    </div>
  )
}
