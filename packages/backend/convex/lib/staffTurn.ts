/** Tour invisible : incrémente `order` pour qu'un message staff ne fusionne pas. */
export const STAFF_TURN_ANCHOR = "\u2060"

export function isStaffTurnAnchor(text: string): boolean {
  return text === STAFF_TURN_ANCHOR
}
