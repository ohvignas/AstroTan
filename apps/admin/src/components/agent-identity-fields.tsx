import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  MAX_AGENT_CHAT_COLOR,
  MAX_AGENT_DISPLAY_NAME,
  MAX_AGENT_INSTRUCTIONS,
  MAX_AGENT_TEASER,
} from "@astrotan/backend/convex/content"
import {
  DEFAULT_AGENT_CHAT_COLOR,
  resolveAgentChatColor,
} from "@astrotan/backend/convex/lib/agentChatAppearance"
import { AgentAvatarField } from "@/components/agent-avatar-field"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export function AgentIdentityFields({
  canWrite,
  agentEnabled,
  agentDisplayName,
  agentInstructions,
  agentAvatarMediaId,
  agentChatColor,
  agentTeaser,
  onEnabledChange,
  onDisplayNameChange,
  onInstructionsChange,
  onAvatarChange,
  onChatColorChange,
  onTeaserChange,
}: {
  canWrite: boolean
  agentEnabled: boolean
  agentDisplayName: string
  agentInstructions: string
  agentAvatarMediaId: Id<"_storage"> | null
  agentChatColor: string
  agentTeaser: string
  onEnabledChange: (enabled: boolean) => void
  onDisplayNameChange: (value: string) => void
  onInstructionsChange: (value: string) => void
  onAvatarChange: (id: Id<"_storage"> | null) => void
  onChatColorChange: (value: string) => void
  onTeaserChange: (value: string) => void
}) {
  const swatch = resolveAgentChatColor(agentChatColor)
  return (
    <>
      <Field orientation="horizontal">
        <Switch
          id="agent-enabled"
          checked={agentEnabled}
          disabled={!canWrite}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
        />
        <FieldLabel htmlFor="agent-enabled">Afficher la bulle sur le site</FieldLabel>
      </Field>

      <Field>
        <FieldLabel htmlFor="agent-display-name">Nom d'affichage</FieldLabel>
        <Input
          id="agent-display-name"
          autoComplete="off"
          value={agentDisplayName}
          maxLength={MAX_AGENT_DISPLAY_NAME}
          disabled={!canWrite}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
        <FieldDescription>
          {agentDisplayName.length}/{MAX_AGENT_DISPLAY_NAME}
        </FieldDescription>
      </Field>

      <AgentAvatarField
        value={agentAvatarMediaId}
        disabled={!canWrite}
        onChange={onAvatarChange}
      />

      <Field>
        <FieldLabel htmlFor="agent-chat-color">Couleur du chat</FieldLabel>
        <div className="flex items-center gap-2">
          <input
            id="agent-chat-color"
            type="color"
            value={swatch}
            disabled={!canWrite}
            aria-label="Couleur du chat"
            className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => onChatColorChange(event.target.value)}
          />
          <Input
            id="agent-chat-color-hex"
            autoComplete="off"
            spellCheck={false}
            value={agentChatColor}
            maxLength={MAX_AGENT_CHAT_COLOR}
            disabled={!canWrite}
            placeholder={DEFAULT_AGENT_CHAT_COLOR}
            onChange={(event) => onChatColorChange(event.target.value)}
          />
          <span
            aria-hidden
            className="size-6 shrink-0 rounded-full border border-input"
            style={{ background: swatch }}
          />
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="agent-teaser">Message à côté de la bulle</FieldLabel>
        <Input
          id="agent-teaser"
          autoComplete="off"
          value={agentTeaser}
          maxLength={MAX_AGENT_TEASER}
          disabled={!canWrite}
          onChange={(event) => onTeaserChange(event.target.value)}
        />
        <FieldDescription>
          Affiché à côté du bouton, pas dans la conversation. {agentTeaser.length}/
          {MAX_AGENT_TEASER}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
        <Textarea
          id="agent-instructions"
          value={agentInstructions}
          maxLength={MAX_AGENT_INSTRUCTIONS}
          disabled={!canWrite}
          onChange={(event) => onInstructionsChange(event.target.value)}
        />
        <FieldDescription>
          {agentInstructions.length}/{MAX_AGENT_INSTRUCTIONS}
        </FieldDescription>
      </Field>
    </>
  )
}
