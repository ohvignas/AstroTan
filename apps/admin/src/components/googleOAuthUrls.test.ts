import { expect, test } from "vitest"
import {
  googleOAuthRedirectUri,
  publicSiteIfRelevant,
  resolveAdminOrigin,
} from "./googleOAuthUrls"

test("URI de redirection = origine admin + callback", () => {
  expect(googleOAuthRedirectUri("http://localhost:3001")).toBe(
    "http://localhost:3001/api/connectors/google/callback",
  )
  expect(googleOAuthRedirectUri("https://admin.example.com/")).toBe(
    "https://admin.example.com/api/connectors/google/callback",
  )
})

test("origine admin : fenêtre en premier, SITE_URL en repli, jamais un localhost figé", () => {
  expect(
    resolveAdminOrigin({
      windowOrigin: "http://localhost:3001",
      siteUrl: "https://admin.exemple.fr",
    }),
  ).toBe("http://localhost:3001")
  expect(resolveAdminOrigin({ siteUrl: "https://admin.exemple.fr/" })).toBe(
    "https://admin.exemple.fr",
  )
  expect(resolveAdminOrigin({})).toBe("")
})

test("site public : affiché tel que stocké, seulement s'il diffère de l'admin", () => {
  expect(
    publicSiteIfRelevant({
      adminOrigin: "https://admin.exemple.fr",
      declaredDomain: "exemple.fr",
    }),
  ).toBe("exemple.fr")
  expect(
    publicSiteIfRelevant({
      adminOrigin: "https://admin.exemple.fr",
      declaredDomain: "www.exemple.fr",
    }),
  ).toBe("www.exemple.fr")
  expect(
    publicSiteIfRelevant({
      adminOrigin: "https://admin.boutique.fr",
      webSiteUrl: "https://boutique.fr/",
    }),
  ).toBe("https://boutique.fr")
  expect(
    publicSiteIfRelevant({
      adminOrigin: "https://admin.exemple.fr",
      declaredDomain: "admin.exemple.fr",
    }),
  ).toBeNull()
  expect(
    publicSiteIfRelevant({
      adminOrigin: "http://localhost:3001",
      webSiteUrl: "http://localhost:4321",
    }),
  ).toBeNull()
  expect(publicSiteIfRelevant({ adminOrigin: "https://admin.exemple.fr" })).toBeNull()
})
