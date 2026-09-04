import { SparklesIcon } from "lucide-react"
import { GenerateWithAiButton } from "@/components/generate-with-ai-button"

/**
 * Le bouton « Générer avec l'IA » des panneaux SEO / GEO.
 *
 * Présentation seulement : l'action Convex et le remplissage du formulaire
 * restent chez l'éditeur. Cacher le bouton n'est qu'une courtoisie —
 * `ai.generateSeoGeo` revérifie le rôle et la propriété.
 */
export function GenerateSeoGeoButton({
  disabled,
  busy,
  onGenerate,
}: {
  disabled: boolean
  busy: boolean
  onGenerate: (extraInstructions?: string) => void
}) {
  return (
    <GenerateWithAiButton
      disabled={disabled}
      busy={busy}
      busyLabel="Génération…"
      icon={<SparklesIcon data-icon="inline-start" />}
      placeholder="Ex. tutoiement, insiste sur le bénéfice local"
      onGenerate={onGenerate}
    />
  )
}
