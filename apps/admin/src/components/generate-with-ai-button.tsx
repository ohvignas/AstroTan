import { type ReactNode, useState } from "react"
import { ChevronDownIcon, Loader2Icon } from "lucide-react"
import { GenerateHintPanel } from "@/components/generate-hint-panel"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const segmentFocus =
  "focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"

export function GenerateWithAiButton({
  disabled,
  busy,
  busyLabel,
  icon,
  placeholder,
  onGenerate,
  className,
}: {
  disabled: boolean
  busy: boolean
  busyLabel: string
  icon: ReactNode
  placeholder: string
  onGenerate: (extraInstructions?: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const isDisabled = disabled || busy

  function generate(extra?: string) {
    setOpen(false)
    onGenerate(extra)
  }

  return (
    <div
      role="group"
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden rounded-lg",
        className,
      )}
    >
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={isDisabled}
        onClick={() => generate()}
        className={cn(
          "flex-1 rounded-none rounded-r-none border-0 pr-2.5",
          segmentFocus,
        )}
      >
        {busy ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          icon
        )}
        {busy ? busyLabel : "Générer avec l’IA"}
      </Button>
      <span
        aria-hidden
        className="w-px shrink-0 self-stretch bg-primary-foreground/25"
      />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          disabled={isDisabled}
          render={
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              aria-haspopup="dialog"
              aria-label="Ajouter une instruction complémentaire"
              className={cn(
                "rounded-none rounded-l-none border-0 px-0",
                segmentFocus,
              )}
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 min-w-80 p-3">
          <GenerateHintPanel
            placeholder={placeholder}
            disabled={disabled}
            busy={busy}
            onGenerate={generate}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
