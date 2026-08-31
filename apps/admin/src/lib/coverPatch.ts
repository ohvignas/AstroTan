export function coverPatch<T extends string>(coverId: T | null): { coverId: T | null } {
  return { coverId }
}
