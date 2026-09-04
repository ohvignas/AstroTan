import { ImageIcon } from "lucide-react"
import { GenerateWithAiButton } from "@/components/generate-with-ai-button"

/**
 * Génère une image via OpenRouter (une d'article ou OG de page).
 * L'action Convex revérifie le rôle — cacher le bouton n'est qu'une courtoisie.
 */
export function GenerateCoverButton({
  disabled,
  busy,
  onGenerate,
  className,
}: {
  disabled: boolean
  busy: boolean
  onGenerate: (extraInstructions?: string) => void
  className?: string
}) {
  return (
    <GenerateWithAiButton
      disabled={disabled}
      busy={busy}
      busyLabel="Génération de l’image…"
      icon={<ImageIcon data-icon="inline-start" />}
      placeholder="Ex. style plat, pas de texte sur l'image"
      onGenerate={onGenerate}
      className={className}
    />
  )
}
