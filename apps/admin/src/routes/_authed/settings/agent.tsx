import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import {
  MAX_AGENT_DISPLAY_NAME,
  MAX_AGENT_INSTRUCTIONS,
  MAX_AGENT_KNOWLEDGE,
} from "@astrotan/backend/convex/content"
import { describeSettingsError } from "@/lib/settingsErrors"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/_authed/settings/agent")({
  component: AgentRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type Secrets = NonNullable<ReturnType<typeof useSecretsAccess>["secrets"]>

function AgentRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || secrets === undefined || settings === undefined) {
    return <SettingsLoading />
  }
  return <AgentForm canWrite={canWrite} secrets={secrets} settings={settings} />
}

function AgentForm({
  canWrite,
  secrets,
  settings,
}: {
  canWrite: boolean
  secrets: Secrets
  settings: Settings
}) {
  const updateAgent = useMutation(api.settings.updateAgent)
  const [agentEnabled, setAgentEnabled] = useState(
    settings?.agentEnabled === true,
  )
  const [agentDisplayName, setAgentDisplayName] = useState(
    settings?.agentDisplayName ?? "",
  )
  const [agentInstructions, setAgentInstructions] = useState(
    settings?.agentInstructions ?? "",
  )
  const [agentKnowledge, setAgentKnowledge] = useState(
    settings?.agentKnowledge ?? "",
  )

  const autoFields = {
    agentEnabled,
    agentDisplayName,
    agentInstructions,
    agentKnowledge,
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: autoFields,
    manual: {},
    saveAuto: async (auto) => {
      await updateAgent(auto)
    },
    saveAll: async ({ auto }) => {
      await updateAgent(auto)
    },
    describeError: describeSettingsError,
  })

  const openRouterMissing =
    secrets.etats.OPENROUTER_API_KEY?.source === "aucune"

  return (
    <SettingsFormShell
      to="/settings/agent"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="L'affichage, le nom ou les consignes de l'agent"
    >
      {openRouterMissing ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Sans clé OpenRouter, la bulle affichera que l'assistant est
          indisponible.{" "}
          <Link to="/settings/ia" className="underline">
            Configurer la clé sur l'écran IA
          </Link>
          .
        </p>
      ) : null}

      <SettingsGroup>
        <Field orientation="horizontal">
          <Switch
            id="agent-enabled"
            checked={agentEnabled}
            disabled={!canWrite}
            onCheckedChange={(checked) => setAgentEnabled(checked === true)}
          />
          <FieldLabel htmlFor="agent-enabled">
            Afficher la bulle sur le site
          </FieldLabel>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-display-name">Nom d'affichage</FieldLabel>
          <Input
            id="agent-display-name"
            autoComplete="off"
            value={agentDisplayName}
            maxLength={MAX_AGENT_DISPLAY_NAME}
            disabled={!canWrite}
            onChange={(event) => setAgentDisplayName(event.target.value)}
          />
          <FieldDescription>
            {agentDisplayName.length}/{MAX_AGENT_DISPLAY_NAME}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
          <Textarea
            id="agent-instructions"
            value={agentInstructions}
            maxLength={MAX_AGENT_INSTRUCTIONS}
            disabled={!canWrite}
            onChange={(event) => setAgentInstructions(event.target.value)}
          />
          <FieldDescription>
            {agentInstructions.length}/{MAX_AGENT_INSTRUCTIONS}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-knowledge">Base de savoir</FieldLabel>
          <Textarea
            id="agent-knowledge"
            value={agentKnowledge}
            maxLength={MAX_AGENT_KNOWLEDGE}
            disabled={!canWrite}
            onChange={(event) => setAgentKnowledge(event.target.value)}
          />
          <FieldDescription>
            {agentKnowledge.length}/{MAX_AGENT_KNOWLEDGE}
          </FieldDescription>
        </Field>
      </SettingsGroup>
    </SettingsFormShell>
  )
}
