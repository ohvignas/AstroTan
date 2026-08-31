export function omitTargetKeyword<T extends { targetKeyword?: string }>(
  doc: T,
): Omit<T, "targetKeyword"> {
  const { targetKeyword: _dropped, ...rest } = doc
  return rest
}
