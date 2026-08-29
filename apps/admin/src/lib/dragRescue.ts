// Le geste qui débloque un glissement dnd-kit resté en l'air.
//
// Extrait de l'écran des leads pour une seule raison : il a été livré faux
// une première fois, et un défaut de ce genre ne se voit dans aucun écran.
// Le glissement se terminait « correctement » à l'œil — le calque
// disparaissait — pendant que dnd-kit se croyait toujours en train de
// glisser et avalait le clic suivant.
//
// Ce que dnd-kit lit, dans `@dnd-kit/core` 6.3.1, `core.esm.js`,
// `AbstractPointerSensor` :
//
//     handleKeydown(event) {
//       if (event.code === KeyboardCode.Esc) { this.handleCancel() }
//     }
//
// `event.code`, pas `event.key`. Un `new KeyboardEvent("keydown", { key:
// "Escape" })` porte `code === ""` : il se déclenche, ne correspond à rien,
// et n'annule donc rien.

/** Le code que le capteur compare. Une constante, pour que le test le vise. */
export const CODE_ANNULATION_DND = "Escape"

/**
 * Les champs de l'événement, séparés de sa construction.
 *
 * Uniquement pour que le test puisse viser le champ oublié sans DOM : la
 * configuration vitest de cette application est en `environment: "node"`, et
 * ajouter jsdom pour une assertion sur trois clés coûterait plus que ce
 * qu'elle protège. Ce que le test couvre est donc la FORME, pas l'envoi —
 * et c'est exactement là qu'était le défaut.
 */
export const INIT_ANNULATION_DND: KeyboardEventInit = {
  key: CODE_ANNULATION_DND,
  code: CODE_ANNULATION_DND,
  bubbles: true,
}

/**
 * L'événement à envoyer sur `document` — c'est là que le capteur pose son
 * écouteur (`documentListeners.add(EventName.Keydown, …)`), pas sur la carte.
 *
 * `key` est renseigné en plus de `code` : il ne sert pas à dnd-kit, mais un
 * autre écouteur de la page pourrait le lire, et un événement clavier qui
 * annonce une touche par une moitié de son identité est un piège pour le
 * prochain qui s'en sert.
 */
export function evenementAnnulationDnd(): KeyboardEvent {
  return new KeyboardEvent("keydown", INIT_ANNULATION_DND)
}
