import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function CoverPreview({
  url,
  alt,
  title,
  compact,
}: {
  url: string
  alt: string
  title?: string
  compact?: boolean
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className={
              compact
                ? "block w-full max-w-md overflow-hidden rounded-lg border border-input bg-muted text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                : "block w-full max-w-xl overflow-hidden rounded-lg border border-input bg-muted text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            }
            aria-label="Voir l'image en entier"
          />
        }
      >
        <span className="relative block aspect-video w-full">
          <img
            src={url}
            alt={alt}
            title={title}
            className="size-full object-cover"
          />
        </span>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] w-full max-w-[min(96vw,64rem)] overflow-auto p-3 sm:max-w-5xl"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>Image en entier</DialogTitle>
          <DialogDescription>{alt}</DialogDescription>
        </DialogHeader>
        <img
          src={url}
          alt={alt}
          title={title}
          className="max-h-[80vh] w-full object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}
