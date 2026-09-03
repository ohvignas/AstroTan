import { ChevronDownIcon } from "lucide-react"
import {
  MAX_GOOGLE_CALENDAR_ID,
  MAX_GOOGLE_CLIENT_ID,
} from "@astrotan/backend/convex/content"
import { CopyButton } from "@/components/copy-button"
import { publicSiteIfRelevant } from "@/components/googleOAuthUrls"
import { SecretField } from "@/components/settings-secrets"
import type { SecretEtat } from "@/components/settings-secrets"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

function ReadonlyUrlField({
  id,
  label,
  value,
  copyLabel,
  hint,
}: {
  id: string
  label: string
  value: string
  copyLabel: string
  hint: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex min-w-0 items-center gap-2">
        <Input id={id} readOnly value={value} className="bg-muted/40 font-mono text-xs" />
        <CopyButton
          value={value}
          label={copyLabel}
          text="Copier"
          variant="outline"
          size="sm"
        />
      </div>
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  )
}

export function AgentGoogleConnectSetup({
  ready,
  adminOrigin,
  redirectUri,
  declaredDomain,
  webSiteUrl,
  clientId,
  calendarId,
  clientSecret,
  onClientIdChange,
  onCalendarIdChange,
  onSaveSecret,
  onClearSecret,
}: {
  ready: boolean
  adminOrigin: string
  redirectUri: string
  declaredDomain: string | null
  webSiteUrl: string
  clientId: string
  calendarId: string
  clientSecret: SecretEtat
  onClientIdChange: (value: string) => void
  onCalendarIdChange: (value: string) => void
  onSaveSecret: (valeur: string) => Promise<void>
  onClearSecret: () => Promise<void>
}) {
  const publicSite = publicSiteIfRelevant({
    adminOrigin,
    declaredDomain,
    webSiteUrl,
  })

  return (
    <Collapsible
      defaultOpen={!ready}
      className="group/setup rounded-lg border border-input"
    >
      <CollapsibleTrigger className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium hover:bg-muted/40">
        Paramétrage
        <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-data-open/setup:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-input px-3 py-3">
        <div className="flex flex-col gap-3">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>
              Dans Google Cloud, créez un client OAuth de type « Application Web ».
            </li>
            <li>
              Collez l'origine JavaScript et l'URI de redirection ci-dessous : elles
              correspondent à cette administration.
            </li>
            <li>
              Revenez avec l'identifiant client et le secret, puis enregistrez-les.
            </li>
          </ol>
          <ReadonlyUrlField
            id="google-js-origin"
            label="Origine JavaScript"
            value={adminOrigin}
            copyLabel="Copier l'origine JavaScript"
            hint="Origines JavaScript autorisées, dans Google Cloud → Identifiants."
          />
          <ReadonlyUrlField
            id="google-redirect-uri"
            label="URI de redirection"
            value={redirectUri}
            copyLabel="Copier l'URI de redirection"
            hint="URI de redirection autorisés, dans Google Cloud → Identifiants."
          />
          {publicSite ? (
            <p className="text-sm text-muted-foreground">
              Le site public ({publicSite}) n'entre pas dans Google Cloud : le retour
              OAuth arrive sur l'administration.
            </p>
          ) : null}
          {ready ? null : (
            <>
              <Field>
                <FieldLabel htmlFor="google-client-id">Identifiant client OAuth</FieldLabel>
                <Input
                  id="google-client-id"
                  autoComplete="off"
                  value={clientId}
                  maxLength={MAX_GOOGLE_CLIENT_ID}
                  onChange={(event) => onClientIdChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Secret client</FieldLabel>
                <SecretField
                  etat={clientSecret}
                  disabled={false}
                  onSave={onSaveSecret}
                  onClear={onClearSecret}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="google-calendar-id">
                  Agenda (laisser vide = principal)
                </FieldLabel>
                <Input
                  id="google-calendar-id"
                  autoComplete="off"
                  value={calendarId}
                  maxLength={MAX_GOOGLE_CALENDAR_ID}
                  onChange={(event) => onCalendarIdChange(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
