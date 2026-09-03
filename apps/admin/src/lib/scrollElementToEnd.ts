export function scrollElementToEnd(
  node: Pick<HTMLElement, "scrollTop" | "scrollHeight"> | null,
): void {
  if (node == null) return
  node.scrollTop = node.scrollHeight
}
