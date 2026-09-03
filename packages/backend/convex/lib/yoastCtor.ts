export function asCtor<T>(mod: unknown): T {
  let current: unknown = mod
  for (let i = 0; i < 3; i++) {
    if (typeof current === "function") return current as T
    if (current !== null && typeof current === "object" && "default" in current) {
      current = (current as { default: unknown }).default
      continue
    }
    break
  }
  throw new TypeError("yoastseo export is not a constructor")
}
