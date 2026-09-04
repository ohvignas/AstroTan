import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { Zap } from "lucide-react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { AgentConnectorsRow } from "@/components/agent-connectors-row"
import { AgentIdentityFields } from "@/components/agent-identity-fields"
import { AgentKnowledgeFiles } from "@/components/agent-knowledge-files"
import { AgentPreviewBubble } from "@/components/agent-preview-bubble"
import { Button } from "@/components/ui/button"
import { AiModelSelect } from "@/components/ai-model-select"
import { OcrModelSelect } from "@/components/ocr-model-select"
import { AiPage } from "@/components/settings-environment"
import { DEFAULT_AGENT_CHAT_COLOR } from "@astrotan/backend/convex/lib/agentChatAppearance"
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  hasAuthoredAgentInstructions,
} from "@astrotan/backend/convex/lib/defaultAgentInstructions"
import { describeSettingsError } from "@/lib/settingsErrors"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/agent")({
  validateSearch: (search: Record<string, unknown>): { calendar?: "ok" | "erreur" } => ({
    calendar:
      search.calendar === "ok" || search.calendar === "erreur"
        ? search.calendar
        : undefined,
  }),
  component: AgentRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>
type Secrets = NonNullable<ReturnType<typeof useSecretsAccess>["secrets"]>

function AgentRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  const settings = useQuery(api.settings.getPrivate)
  const calendar = Route.useSearch().calendar
  if (loading || secrets === undefined || settings === undefined) {
    return <SettingsLoading />
  }
  return (
    <AgentForm
      canWrite={canWrite}
      secrets={secrets}
      settings={settings}
      calendar={calendar}
    />
  )
}

function AgentForm({
  canWrite,
  secrets,
  settings,
  calendar,
}: {
  canWrite: boolean
  secrets: Secrets
  settings: Settings
  calendar?: "ok" | "erreur"
}) {
  const updateAgent = useMutation(api.settings.updateAgent)
  const update = useMutation(api.settings.update)
  const ensureInstructions = useMutation(api.settings.ensureDefaultAgentInstructions)
  const [agentEnabled, setAgentEnabled] = useState(settings?.agentEnabled === true)
  const [agentDisplayName, setAgentDisplayName] = useState(settings?.agentDisplayName ?? "")
  const [agentInstructions, setAgentInstructions] = useState(() => {
    const fromServer = settings?.agentInstructions
    return hasAuthoredAgentInstructions(fromServer)
      ? fromServer
      : DEFAULT_AGENT_INSTRUCTIONS
  })
  const [agentAvatarMediaId, setAgentAvatarMediaId] = useState<Id<"_storage"> | null>(
    settings?.agentAvatarMediaId ?? null,
  )
  const [agentChatColor, setAgentChatColor] = useState(
    settings?.agentChatColor ?? DEFAULT_AGENT_CHAT_COLOR,
  )
  const [agentTeaser, setAgentTeaser] = useState(settings?.agentTeaser ?? "")
  const [previewOpen, setPreviewOpen] = useState(false)

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: {
      agentEnabled,
      agentDisplayName,
      agentInstructions,
      agentAvatarMediaId,
      agentChatColor,
      agentTeaser,
    },
    manual: {},
    saveAuto: async (auto) => {
      await updateAgent(auto)
    },
    saveAll: async ({ auto }) => {
      await updateAgent(auto)
    },
    describeError: describeSettingsError,
  })

  useEffect(() => {
    if (hasAuthoredAgentInstructions(settings?.agentInstructions)) return
    if (!canWrite) return
    let cancelled = false
    void ensureInstructions({}).then((text) => {
      if (cancelled || typeof text !== "string") return
      setAgentInstructions((current) =>
        hasAuthoredAgentInstructions(current) ? current : text,
      )
    })
    return () => {
      cancelled = true
    }
  }, [canWrite, settings?.agentInstructions, ensureInstructions])

  return (
    <>
      <SettingsFormShell
        to="/settings/agent"
        canWrite={canWrite}
        autoSave={autoSave}
        unsavedLabel="L'affichage, le nom ou les consignes de l'agent"
      >
        <SettingsGroup
          title="Identité de l'agent"
          action={
            <Button
              type="button"
              variant="outline"
              aria-label="Tester"
              onClick={() => setPreviewOpen(true)}
            >
              <Zap data-icon="inline-start" />
              Tester
            </Button>
          }
        >
          <AiModelSelect
            canWrite={canWrite}
            openRouterModel={settings?.openRouterAgentModel ?? null}
            onSave={(id) => update({ openRouterAgentModel: id })}
            fieldId="agent-model"
            fieldLabel="Modèle de l'agent"
            description="Le modèle utilisé par le chat de l'agent sur le site."
          />
          <AgentIdentityFields
            canWrite={canWrite}
            agentEnabled={agentEnabled}
            agentDisplayName={agentDisplayName}
            agentInstructions={agentInstructions}
            agentAvatarMediaId={agentAvatarMediaId}
            agentChatColor={agentChatColor}
            agentTeaser={agentTeaser}
            onEnabledChange={setAgentEnabled}
            onDisplayNameChange={setAgentDisplayName}
            onInstructionsChange={setAgentInstructions}
            onAvatarChange={setAgentAvatarMediaId}
            onChatColorChange={setAgentChatColor}
            onTeaserChange={setAgentTeaser}
          />
          <div className="grid gap-3">
            <h3 className="font-heading text-sm font-medium">Base de savoir</h3>
            <AgentKnowledgeFiles disabled={!canWrite} />
          </div>
          <div className="grid gap-3">
            <h3 className="font-heading text-sm font-medium">Applications</h3>
            <AgentConnectorsRow
              canWrite={canWrite}
              secrets={secrets}
              calendar={calendar}
              declaredDomain={settings?.declaredDomain ?? null}
            />
          </div>
        </SettingsGroup>

        <AiPage
          secrets={secrets}
          canWrite={canWrite}
          openRouterModel={settings?.openRouterModel ?? null}
          onSaveModel={(id) => update({ openRouterModel: id })}
          openRouterImageModel={settings?.openRouterImageModel ?? null}
          onSaveImageModel={(id) => update({ openRouterImageModel: id })}
        >
          <OcrModelSelect
            canWrite={canWrite}
            openRouterOcrModel={settings?.openRouterOcrModel ?? null}
            onSave={(id) => update({ openRouterOcrModel: id })}
          />
        </AiPage>
      </SettingsFormShell>
      <AgentPreviewBubble
        avatarUrl={settings?.agentAvatarUrl ?? null}
        color={agentChatColor}
        teaser={agentTeaser}
        agentName={agentDisplayName}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
