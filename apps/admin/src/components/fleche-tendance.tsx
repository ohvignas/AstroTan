export type SensTendance = "up" | "down" | "flat"

export function FlecheTendance({ sens }: { sens: SensTendance }) {
  const glyphe = sens === "up" ? "↑" : sens === "down" ? "↓" : "→"
  const couleur =
    sens === "up"
      ? "text-emerald-600"
      : sens === "down"
        ? "text-red-600"
        : "text-muted-foreground"
  return (
    <span className={couleur} aria-hidden>
      {glyphe}
    </span>
  )
}

export function sensPourVolume(
  current: number,
  previous: number | null,
): SensTendance {
  if (previous === null || current === previous) return "flat"
  return current > previous ? "up" : "down"
}

export function sensPourRang(
  current: number,
  previous: number | null,
): SensTendance {
  if (previous === null || current === previous) return "flat"
  return current < previous ? "up" : "down"
}
