import { describe, expect, test } from "vitest"
import { assertSafeHref, isSafeHref } from "./safeHref"

// Chaque cas refusé ci-dessous est une chaîne qui ressemble à un lien
// légitime et qui, placée dans un attribut `href`, emmène le visiteur
// ailleurs que là où l'opérateur croyait l'envoyer.

describe("ce qui est accepté", () => {
  test.each([
    "/tarifs",
    "/blog/mon-article",
    "/",
    "https://exemple.fr/page",
    "http://exemple.test",
    "mailto:contact@exemple.fr",
    "tel:+33100000000",
  ])("%s", (value) => {
    expect(isSafeHref(value)).toBe(true)
  })
})

describe("les schémas exécutables", () => {
  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
  ])("%s est refusé", (value) => {
    expect(isSafeHref(value)).toBe(false)
  })
})

describe("les chemins qui n'en sont pas", () => {
  test("une URL protocol-relative sort du site en ressemblant à un chemin", () => {
    // `//evil.example` a l'air d'un chemin absolu et n'en est pas : le
    // navigateur le résout vers un autre hôte, en conservant le schéma.
    expect(isSafeHref("//evil.example")).toBe(false)
    expect(isSafeHref("//evil.example/phishing")).toBe(false)
  })

  test("la variante à antislash est le même piège", () => {
    // Plusieurs navigateurs normalisent `\` en `/` dans une autorité, donc
    // `/\evil.example` se comporte comme `//evil.example`.
    expect(isSafeHref("/\\evil.example")).toBe(false)
    expect(isSafeHref("\\\\evil.example")).toBe(false)
  })

  test("un chemin relatif sans slash de tête est refusé", () => {
    // Ambigu : résolu contre la page courante, il désigne une cible
    // différente selon l'URL depuis laquelle on le lit.
    expect(isSafeHref("tarifs")).toBe(false)
  })
})

describe("les caractères de contrôle", () => {
  test("un octet nul ou un saut de ligne inséré casse l'analyse du schéma", () => {
    // `java\0script:` et `java\nscript:` sont normalisés par certains
    // analyseurs en `javascript:` — c'est la façon classique de faire
    // passer un schéma refusé devant une vérification naïve.
    expect(isSafeHref("java\0script:alert(1)")).toBe(false)
    expect(isSafeHref("java\nscript:alert(1)")).toBe(false)
    expect(isSafeHref("/tarifs\r\n")).toBe(false)
  })
})

describe("assertSafeHref", () => {
  test("lève avec le champ fautif, et laisse passer ce qui est sûr", () => {
    expect(() => assertSafeHref("/tarifs", "to")).not.toThrow()
    expect(() => assertSafeHref("javascript:alert(1)", "to")).toThrow()
    try {
      assertSafeHref("javascript:alert(1)", "seo.canonicalUrl")
    } catch (error) {
      expect((error as { data: { code: string; field: string } }).data).toEqual({
        code: "UNSAFE_HREF",
        field: "seo.canonicalUrl",
      })
    }
  })
})
