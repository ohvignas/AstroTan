import { useEffect, useRef, useState, type MouseEvent } from "react"
import { CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const COPIED_LABEL = "Copié"
export const COPY_RESET_MS = 2000

type CopyButtonProps = {
  value: string
  label: string
  className?: string
  iconClassName?: string
  variant?: "ghost" | "outline"
  size?: "icon" | "icon-xs" | "sm"
  /** Texte au repos à la place de l'icône (ex. « Copier »). */
  text?: string
}

export function CopyButton({
  value,
  label,
  className,
  iconClassName,
  variant = "ghost",
  size = "icon",
  text,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function onCopy(event: MouseEvent) {
    event.stopPropagation()
    void navigator.clipboard.writeText(value)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
  }

  const shown = copied ? COPIED_LABEL : (text ?? label)

  return (
    <Button
      type="button"
      variant={variant}
      size={copied && !text ? "sm" : size}
      className={cn(copied && "text-xs", className)}
      title={shown}
      aria-label={shown}
      aria-live="polite"
      onClick={onCopy}
    >
      {copied ? COPIED_LABEL : text ? text : <CopyIcon className={iconClassName} />}
    </Button>
  )
}
