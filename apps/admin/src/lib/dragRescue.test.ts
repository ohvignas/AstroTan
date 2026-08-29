import { describe, expect, test } from "vitest"
import { CODE_ANNULATION_DND, INIT_ANNULATION_DND } from "./dragRescue"

describe("l'événement qui annule un glissement dnd-kit", () => {
  test("porte `code`, et pas seulement `key`", () => {
    // Le défaut exact livré une première fois. dnd-kit compare
    // `event.code === "Escape"` (`AbstractPointerSensor.handleKeydown`,
    // `@dnd-kit/core` 6.3.1) ; sans ce champ, l'événement porte la chaîne
    // vide, se déclenche, ne correspond à rien, et n'annule donc rien — en
    // silence, ce qui est le pire de tout.
    expect(INIT_ANNULATION_DND.code).toBe(CODE_ANNULATION_DND)
    expect(INIT_ANNULATION_DND.key).toBe(CODE_ANNULATION_DND)
  })

  test("remonte, parce que le capteur écoute sur `document`", () => {
    // `documentListeners.add(EventName.Keydown, …)` : l'écouteur n'est pas
    // sur la carte. Envoyé sans `bubbles`, l'événement resterait sur sa
    // cible et n'atteindrait jamais le capteur.
    expect(INIT_ANNULATION_DND.bubbles).toBe(true)
  })
})
