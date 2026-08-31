import { expect, test } from "vitest"
import { envDepuisBandeau } from "./consentClientEnv"

const BUILD = {
  PUBLIC_UMAMI_URL: "https://stats.exemple.fr",
  PUBLIC_UMAMI_WEBSITE_ID: "site-1",
  PUBLIC_META_PIXEL_ID: "build-meta",
  PUBLIC_GOOGLE_TAG_ID: "G-BUILD",
}

test("un attribut vide est un retrait, pas un repli sur le build", () => {
  const env = envDepuisBandeau({ metaPixelId: "", googleTagId: "" }, BUILD)
  expect(env.PUBLIC_META_PIXEL_ID).toBeUndefined()
  expect(env.PUBLIC_GOOGLE_TAG_ID).toBeUndefined()
  expect(env.PUBLIC_UMAMI_URL).toBe(BUILD.PUBLIC_UMAMI_URL)
})

test("un attribut posé est l'ID effectif", () => {
  const env = envDepuisBandeau({ metaPixelId: "123", googleTagId: "AW-1" }, BUILD)
  expect(env.PUBLIC_META_PIXEL_ID).toBe("123")
  expect(env.PUBLIC_GOOGLE_TAG_ID).toBe("AW-1")
})
