export function leadsBadge(count: number | undefined): number | undefined {
  return typeof count === "number" && count > 0 ? count : undefined
}
