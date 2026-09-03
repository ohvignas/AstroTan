import {
  DEFAULT_OPENROUTER_OCR_MODEL,
  OPENROUTER_OCR_MODELS,
} from "@astrotan/backend/convex/lib/openRouterOcrModels"
import { AiModelSelect } from "@/components/ai-model-select"

export function OcrModelSelect({
  canWrite,
  openRouterOcrModel,
  onSave,
}: {
  canWrite: boolean
  openRouterOcrModel: string | null
  onSave: (id: string) => Promise<unknown>
}) {
  return (
    <AiModelSelect
      canWrite={canWrite}
      openRouterModel={openRouterOcrModel}
      onSave={onSave}
      models={OPENROUTER_OCR_MODELS}
      fallbackId={DEFAULT_OPENROUTER_OCR_MODEL}
      fieldId="ocr-model"
      fieldLabel="Modèle OCR"
      description="OCR Mistral (moteur OpenRouter) pour les PDF scannés ou Canva, sans calque texte. Défaut : Gemini 2.5 Flash."
    />
  )
}
