import { describe, expect, test } from "vitest"
import {
  PREVIEW_POSITION_KEY,
  clampPreviewPosition,
  readPreviewPosition,
  writePreviewPosition,
} from "./previewDrag"

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    store,
  }
}

describe("clampPreviewPosition", () => {
  test("garde une position déjà dans le viewport", () => {
    expect(
      clampPreviewPosition(
        { x: 40, y: 80 },
        { width: 384, height: 560 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ x: 40, y: 80 })
  })

  test("ne sort pas à gauche ni en haut", () => {
    expect(
      clampPreviewPosition(
        { x: -20, y: -10 },
        { width: 100, height: 100 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })

  test("ne sort pas à droite ni en bas", () => {
    expect(
      clampPreviewPosition(
        { x: 900, y: 700 },
        { width: 200, height: 200 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 600, y: 400 })
  })

  test("si la carte dépasse le viewport, coin haut-gauche", () => {
    expect(
      clampPreviewPosition(
        { x: 10, y: 10 },
        { width: 900, height: 700 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })
})

describe("sessionStorage de la position d'aperçu", () => {
  test("clé dédiée, pas la session chat", () => {
    expect(PREVIEW_POSITION_KEY).toBe("astrotan.agentPreviewPosition")
  })

  test("lit et écrit un {x,y}", () => {
    const storage = memoryStorage()
    expect(readPreviewPosition(storage)).toBeNull()
    writePreviewPosition(storage, { x: 120, y: 48 })
    expect(storage.store.get(PREVIEW_POSITION_KEY)).toBe('{"x":120,"y":48}')
    expect(readPreviewPosition(storage)).toEqual({ x: 120, y: 48 })
  })

  test("refuse un JSON malformé ou incomplet", () => {
    expect(readPreviewPosition(memoryStorage({ [PREVIEW_POSITION_KEY]: "nope" }))).toBeNull()
    expect(readPreviewPosition(memoryStorage({ [PREVIEW_POSITION_KEY]: '{"x":1}' }))).toBeNull()
    expect(readPreviewPosition(null)).toBeNull()
  })
})
