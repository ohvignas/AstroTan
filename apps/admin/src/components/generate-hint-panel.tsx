import { useId, useState } from "react"
import { MAX_EXTRA_INSTRUCTIONS } from "@astrotan/backend/convex/lib/extraInstructions"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function GenerateHintPanel({
  placeholder,
  disabled,
  busy,
  onGenerate,
}: {
  placeholder: string
  disabled: boolean
  busy: boolean
  onGenerate: (extraInstructions?: string) => void
}) {
  const hintId = useId()
  const [hint, setHint] = useState("")

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Label htmlFor={hintId}>Instruction complémentaire</Label>
      <Textarea
        id={hintId}
        value={hint}
        maxLength={MAX_EXTRA_INSTRUCTIONS}
        placeholder={placeholder}
        disabled={disabled || busy}
        onChange={(event) => setHint(event.target.value)}
        className="min-h-20"
      />
      <Button
        type="button"
        size="sm"
        disabled={disabled || busy}
        onClick={() => onGenerate(hint.trim() || undefined)}
      >
        Générer
      </Button>
    </div>
  )
}
