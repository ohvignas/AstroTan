// Source : icône produit Google Calendar 2020, Wikimedia Commons
// (Google Brand Resource). Do not redraw.
import mark from "@/assets/google-calendar.svg"

export function GoogleCalendarMark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-md bg-white ring-1 ring-foreground/10">
      <img src={mark} width={size} height={size} alt="Google Agenda" />
    </span>
  )
}
