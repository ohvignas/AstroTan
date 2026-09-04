import { useState } from "react"
import {
  OPENROUTER_MODELS,
  DEFAULT_OPENROUTER_MODEL,
} from "@astrotan/backend/convex/lib/openRouterModels"
import {
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  OPENROUTER_IMAGE_MODELS,
} from "@astrotan/backend/convex/lib/openRouterImageModels"
import { describeSettingsError } from "@/lib/settingsErrors"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function AiModelSelect({
  canWrite,
  openRouterModel,
  onSave,
  models = OPENROUTER_MODELS,
  fallbackId = DEFAULT_OPENROUTER_MODEL,
  fieldId = "ai-model",
  fieldLabel = "Modèle de texte",
  description = "Champs SEO, GEO et extrait depuis l'éditeur.",
}: {
  canWrite: boolean
  openRouterModel: string | null
  onSave: (id: string) => Promise<unknown>
  models?: readonly { id: string; label: string }[]
  fallbackId?: string
  fieldId?: string
  fieldLabel?: string
  description?: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = openRouterModel ?? fallbackId

  const items: Record<string, string> = Object.fromEntries(
    models.map((model) => [model.id, model.label]),
  )

  async function handleChange(value: string) {
    setError(null)
    setPending(true)
    try {
      await onSave(value)
    } catch (err) {
      setError(describeSettingsError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{fieldLabel}</FieldLabel>
      <Select
        items={items}
        value={selected}
        disabled={!canWrite || pending}
        onValueChange={(value) => handleChange(value as string)}
      >
        <SelectTrigger id={fieldId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  )
}

export function AiModelFields({
  canWrite,
  openRouterModel,
  onSaveModel,
  openRouterImageModel,
  onSaveImageModel,
}: {
  canWrite: boolean
  openRouterModel: string | null
  onSaveModel: (id: string) => Promise<unknown>
  openRouterImageModel: string | null
  onSaveImageModel: (id: string) => Promise<unknown>
}) {
  return (
    <>
      <AiModelSelect
        canWrite={canWrite}
        openRouterModel={openRouterModel}
        onSave={onSaveModel}
      />
      <AiModelSelect
        canWrite={canWrite}
        openRouterModel={openRouterImageModel}
        onSave={onSaveImageModel}
        models={OPENROUTER_IMAGE_MODELS}
        fallbackId={DEFAULT_OPENROUTER_IMAGE_MODEL}
        fieldId="ai-image-model"
        fieldLabel="Modèle d'image"
        description="Utilisé pour générer l'image de une d'un article. Défaut : Gemini 3 Pro Image (Nano Banana Pro)."
      />
    </>
  )
}
