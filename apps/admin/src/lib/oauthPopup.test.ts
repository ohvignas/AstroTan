import { expect, test } from "vitest"
import { OAUTH_POPUP_MESSAGE_TYPE, isOAuthPopupMessage } from "./oauthPopup"

test("n'accepte qu'un message same-shape", () => {
  expect(isOAuthPopupMessage({ type: OAUTH_POPUP_MESSAGE_TYPE, ok: true })).toBe(true)
  expect(isOAuthPopupMessage({ type: "autre", ok: true })).toBe(false)
  expect(isOAuthPopupMessage(null)).toBe(false)
})
