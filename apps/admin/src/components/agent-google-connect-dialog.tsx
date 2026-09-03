import { useEffect, useState } from "react"
import { AgentGoogleConnectSetup } from "@/components/agent-google-connect-setup"
import {
  googleOAuthRedirectUri,
  resolveAdminOrigin,
} from "@/components/googleOAuthUrls"
import type { SecretEtat } from "@/components/settings-secrets"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"

const EMPTY_SECRET: SecretEtat = {
  nom: "GOOGLE_CALENDAR_CLIENT_SECRET",
  environnement: false,
  base: false,
  illisible: false,
  source: "aucune",
}

export function AgentGoogleConnectDialog({
  open,
  ready,
  clientSecret,
  declaredDomain,
  onOpenChange,
  onSaveIds,
  onSaveSecret,
  onClearSecret,
  onContinue,
}: {
  open: boolean
  ready: boolean
  clientSecret: SecretEtat | undefined
  declaredDomain: string | null
  onOpenChange: (open: boolean) => void
  onSaveIds: (clientId: string, calendarId: string) => Promise<void>
  onSaveSecret: (valeur: string) => Promise<void>
  onClearSecret: () => Promise<void>
  onContinue: () => Promise<void>
}) {
  const [clientId, setClientId] = useState("")
  const [calendarId, setCalendarId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adminOrigin, setAdminOrigin] = useState("")

  useEffect(() => {
    setAdminOrigin(
      resolveAdminOrigin({
        windowOrigin: window.location.origin,
        siteUrl: import.meta.env.VITE_SITE_URL as string | undefined,
      }),
    )
  }, [])

  const redirectUri = adminOrigin.length > 0 ? googleOAuthRedirectUri(adminOrigin) : ""
  const webSiteUrl = (import.meta.env.VITE_WEB_SITE_URL as string | undefined) ?? ""

  function reset() {
    setClientId("")
    setCalendarId("")
    setBusy(false)
    setError(null)
  }

  async function handleContinue() {
    setError(null)
    setBusy(true)
    try {
      if (!ready) {
        await onSaveIds(clientId, calendarId)
      }
      await onContinue()
    } catch {
      setError("La connexion Google a été refusée ou interrompue.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connecter Google Agenda</DialogTitle>
          <DialogDescription>
            {ready
              ? "Une fenêtre Google va s'ouvrir. Autorisez l'accès à l'agenda de ce site."
              : "L'agent pourra proposer des créneaux et poser un rendez-vous sur cet agenda."}
          </DialogDescription>
        </DialogHeader>
        {ready ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void handleContinue()}
          >
            {busy ? "Ouverture…" : "Continuer vers Google"}
          </Button>
        ) : null}
        <AgentGoogleConnectSetup
          ready={ready}
          adminOrigin={adminOrigin}
          redirectUri={redirectUri}
          declaredDomain={declaredDomain}
          webSiteUrl={webSiteUrl}
          clientId={clientId}
          calendarId={calendarId}
          clientSecret={clientSecret ?? EMPTY_SECRET}
          onClientIdChange={setClientId}
          onCalendarIdChange={setCalendarId}
          onSaveSecret={onSaveSecret}
          onClearSecret={onClearSecret}
        />
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          {ready ? null : (
            <Button
              type="button"
              className="min-h-11"
              disabled={busy || clientId.trim().length === 0}
              aria-busy={busy}
              onClick={() => void handleContinue()}
            >
              {busy ? "Ouverture…" : "Continuer vers Google"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
