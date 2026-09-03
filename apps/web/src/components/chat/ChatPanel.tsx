import type { ReactNode } from "react"
import { MessageCircleDashedIcon, RotateCwIcon, XIcon } from "lucide-react"
import type { PreviewDragHandle } from "./previewDrag"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { MessageScrollerProvider } from "@/components/ui/message-scroller"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { EMPTY_THREAD_PROMPT } from "./chatWidgetState"

function presenceSubtitle(agentName?: string | null): string {
  const name = agentName?.trim()
  return name ? `${name} est en ligne` : "Un conseiller est en ligne"
}

function OnlineDot() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-3 shrink-0 items-center justify-center"
    >
      <span className="absolute size-3 rounded-full bg-emerald-400/50 animate-ping motion-reduce:hidden" />
      <span className="absolute size-4 rounded-full bg-emerald-400/30 animate-ping [animation-delay:400ms] motion-reduce:hidden" />
      <span className="relative size-2 rounded-full bg-emerald-500" />
    </span>
  )
}

export function ChatPanel({
  onReset,
  resetDisabled,
  onClose,
  dragHandle,
  dragging = false,
  banner,
  agentName,
  isEmpty = false,
  children,
  footer,
  overlay,
}: {
  onReset: () => void
  resetDisabled?: boolean
  onClose?: () => void
  dragHandle?: PreviewDragHandle
  dragging?: boolean
  banner?: string | null
  staffOnline?: boolean
  agentName?: string | null
  isEmpty?: boolean
  children: ReactNode
  footer?: ReactNode
  overlay?: ReactNode
}) {
  return (
    <TooltipProvider>
      <MessageScrollerProvider autoScroll>
        <Card
          aria-labelledby="chat-widget-title"
          className="mx-auto flex h-140 max-h-140 min-h-0 w-full max-w-sm flex-col gap-0 overflow-hidden border border-border shadow-md ring-1 ring-foreground/10"
        >
          <CardHeader
            className={
              dragHandle
                ? `shrink-0 gap-1 border-b touch-none select-none ${
                    dragging ? "cursor-grabbing" : "cursor-grab"
                  }`
                : "shrink-0 gap-1 border-b"
            }
            aria-label={dragHandle ? "Déplacer l'aperçu" : undefined}
            {...dragHandle}
          >
            <CardTitle id="chat-widget-title">Nouvelle conversation</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <OnlineDot />
              {presenceSubtitle(agentName)}
            </CardDescription>
            <CardAction
              className="flex items-center gap-2"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Réinitialiser la conversation"
                      disabled={resetDisabled}
                      onClick={onReset}
                    >
                      <RotateCwIcon />
                    </Button>
                  }
                />
                <TooltipContent>
                  <p>Réinitialiser</p>
                </TooltipContent>
              </Tooltip>
              {onClose ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Fermer"
                        onClick={onClose}
                      >
                        <XIcon />
                      </Button>
                    }
                  />
                  <TooltipContent>
                    <p>Fermer</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </CardAction>
          </CardHeader>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {banner ? (
                <p className="px-(--card-spacing) pt-3 text-sm text-destructive" role="alert">
                  {banner}
                </p>
              ) : null}
              {isEmpty ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageCircleDashedIcon />
                    </EmptyMedia>
                    <EmptyTitle>Bonjour !</EmptyTitle>
                    <EmptyDescription>{EMPTY_THREAD_PROMPT}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                children
              )}
            </CardContent>
            {footer ? (
              <CardFooter className="shrink-0 flex-col gap-2 border-t-0 bg-transparent">
                {footer}
              </CardFooter>
            ) : null}
            {overlay ? (
              <div
                data-slot="chat-email-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-email-card-title"
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/55 p-4 backdrop-blur-sm"
              >
                {/* prefers-reduced-motion : le flou n'est pas une animation, on le conserve. */}
                {overlay}
              </div>
            ) : null}
          </div>
        </Card>
      </MessageScrollerProvider>
    </TooltipProvider>
  )
}
