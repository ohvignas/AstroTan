import { expect, test } from "vitest"
import { deriverOrigines } from "./origines"

const ENV = { SITE_URL: "http://localhost:3001", WEB_SITE_URL: "http://localhost:4321" }

test("sans domaine déclaré, l'environnement continue de valoir", () => {
  expect(deriverOrigines(null, ENV)).toEqual({
    admin: "http://localhost:3001",
    web: "http://localhost:4321",
  })
  // `undefined` est ce que rend la base quand le champ n'a jamais été
  // écrit ; `null` ce que rend la query qui le normalise. Les deux
  // existent réellement, les deux doivent replier.
  expect(deriverOrigines(undefined, ENV)).toEqual(deriverOrigines(null, ENV))
})

test("un domaine déclaré l'emporte sur l'environnement, et entraîne le sous-domaine admin", () => {
  expect(deriverOrigines("exemple.fr", ENV)).toEqual({
    admin: "https://admin.exemple.fr",
    web: "https://exemple.fr",
  })
})

test("la casse, les espaces et le point final d'une zone DNS ne changent rien", () => {
  // Un copier-coller depuis une zone donne `Exemple.FR.` — le point final
  // est la forme absolue, légale en DNS. Sans normalisation, l'email
  // pointerait vers `https://admin.Exemple.FR.`, un hôte que Traefik ne
  // route pas.
  expect(deriverOrigines("  Exemple.FR. ", ENV).admin).toBe("https://admin.exemple.fr")
})

test("un domaine invalide en base REPLIE, il ne sort jamais dans un lien", () => {
  // `settings.update` valide à l'écriture, mais ce n'est pas le seul
  // chemin qui écrit dans cette table (migration, `npx convex run`,
  // restauration de sauvegarde). Ce qui compte ici : la valeur douteuse
  // n'apparaît pas dans le résultat, sous aucune forme.
  for (const douteux of [
    "",
    "pas un hôte",
    "https://exemple.fr",
    "exemple.fr:8080",
    "exemple.fr/chemin",
    "*.exemple.fr",
    "exemple.fr evil.fr",
  ]) {
    const origines = deriverOrigines(douteux, ENV)
    expect(origines).toEqual({ admin: ENV.SITE_URL, web: ENV.WEB_SITE_URL })
  }
})

test("sans domaine déclaré ET sans variable, l'origine vaut null — jamais une chaîne vide", () => {
  // `""` composerait `/accept-invite?token=…`, un chemin relatif que les
  // appelants prendraient pour une origine valide et qui partirait dans un
  // email. `null` est ce qui les fait lever.
  expect(deriverOrigines(null, {})).toEqual({ admin: null, web: null })
})
