// Le sommaire des réglages : la liste des pages, ce qui les relie aux
// fichiers de route, et l'en-tête d'une page.
//
// Ce que ce fichier ne teste PAS, et pourquoi : le rendu de `SettingsNav`.
// Il utilise `<Link>` et `useRouterState`, qui exigent un `RouterProvider`
// autour d'eux ; `vitest.config.ts` est en `environment: "node"` et rend
// avec `renderToStaticMarkup`. Monter un routeur complet pour vérifier
// qu'une liste s'affiche coûterait un harnais fragile pour une garantie
// que la bibliothèque donne déjà — `<Link>` rend un `<a href>` par
// construction.
//
// Ce qui est testé à la place est ce qui peut réellement casser en
// silence : la liste des pages, sa correspondance avec les fichiers de
// route (renommer l'un sans l'autre donne un lien mort), la règle qui
// décide de l'entrée active, et le plan des titres.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  SettingsPageHeader,
  findSettingsPage,
  isSettingsPathActive,
} from "./settings-nav"

describe("SETTINGS_PAGES", () => {
  test("porte les sept pages attendues, dans l'ordre du menu", () => {
    expect(SETTINGS_PAGES.map((page) => page.to)).toEqual([
      "/settings/identite",
      "/settings/referencement",
      "/settings/reseaux",
      "/settings/webhook",
      "/settings/domaine",
      "/settings/mesure",
      "/settings/ia",
    ])
  })

  test("aucun chemin en double", () => {
    const paths = SETTINGS_PAGES.map((page) => page.to)
    expect(new Set(paths).size).toBe(paths.length)
  })

  test("le titre de page commence par le libellé du menu", () => {
    // L'orientation, et c'est le reproche auquel tout ce découpage
    // répond : on doit pouvoir relier d'un coup d'œil l'entrée cliquée et
    // la page ouverte. Un `h1` sans rapport avec le libellé cliqué laisse
    // croire qu'on a atterri ailleurs.
    //
    // La conjonction est normalisée : le menu écrit « Domaine & emails »
    // faute de largeur, le titre « Domaine et emails ».
    for (const page of SETTINGS_PAGES) {
      const label = page.label.replace(" & ", " et ")
      expect(page.title.startsWith(label), `${page.title} / ${page.label}`).toBe(
        true
      )
    }
  })
})

describe("SETTINGS_GROUPS", () => {
  test("sépare ce qui s'enregistre de ce qui ne fait que décrire", () => {
    // La raison d'être des deux groupes : les pages du premier ont une
    // barre de sauvegarde, celles du second n'en ont aucune. Une page
    // rangée dans le mauvais groupe promettrait un formulaire absent, ou
    // cacherait celui qui existe.
    expect(SETTINGS_GROUPS).toHaveLength(2)
    const [reglable, lectureSeule] = SETTINGS_GROUPS
    expect(reglable?.pages.every((page) => page.readOnly === undefined)).toBe(true)
    expect(lectureSeule?.pages.every((page) => page.readOnly === true)).toBe(true)
    expect(lectureSeule?.caption).toBeTruthy()
  })

  test("la liste à plat est exactement la concaténation des groupes", () => {
    expect(SETTINGS_PAGES).toEqual(SETTINGS_GROUPS.flatMap((g) => g.pages))
  })
})

// `?raw` : on lit le TEXTE des fichiers de route, on ne les exécute pas.
// Les importer déclencherait `createFileRoute`, qui veut le registre du
// routeur.
const ROUTE_FILES = import.meta.glob("../routes/_authed/settings/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})

describe("les fichiers de route", () => {
  test("il en existe un par page déclarée, et pas un de plus", () => {
    // Le lien mort le plus facile à fabriquer : renommer
    // `reseaux.tsx` en `sociaux.tsx` et oublier `SETTINGS_GROUPS`. Rien
    // ne casse au typecheck, et l'entrée de menu mène à une 404.
    const fichiers = Object.keys(ROUTE_FILES)
      .map((path) => path.split("/").pop()?.replace(/\.tsx$/, ""))
      .filter((name): name is string => name !== undefined && name !== "index")
      .sort()
    const attendus = SETTINGS_PAGES.map((page) =>
      page.to.replace("/settings/", "")
    ).sort()
    expect(fichiers).toEqual(attendus)
  })

  test("chaque fichier déclare la route de son propre chemin", () => {
    for (const page of SETTINGS_PAGES) {
      const nom = page.to.replace("/settings/", "")
      const source = ROUTE_FILES[`../routes/_authed/settings/${nom}.tsx`]
      expect(source, `fichier manquant pour ${page.to}`).toBeTruthy()
      expect(source).toContain(`createFileRoute("/_authed/settings/${nom}")`)
    }
  })

  test("/settings ne montre rien : il redirige vers la première page", () => {
    // Une page d'accueil de réglages ne ferait que répéter le menu, et
    // c'est un clic de plus pour tout le monde.
    const index = ROUTE_FILES["../routes/_authed/settings/index.tsx"]
    expect(index).toBeTruthy()
    expect(index).toContain("redirect")
    expect(index).toContain(SETTINGS_PAGES[0]?.to ?? "")
  })
})

describe("isSettingsPathActive", () => {
  test("correspondance exacte, barre finale tolérée", () => {
    expect(isSettingsPathActive("/settings/reseaux", "/settings/reseaux")).toBe(true)
    expect(isSettingsPathActive("/settings/reseaux/", "/settings/reseaux")).toBe(true)
  })

  test("un préfixe n'allume pas une entrée", () => {
    // `startsWith` aurait marché aujourd'hui et allumé deux entrées à la
    // fois au premier chemin plus long.
    expect(isSettingsPathActive("/settings/reseaux-sociaux", "/settings/reseaux")).toBe(
      false
    )
    expect(isSettingsPathActive("/settings", "/settings/identite")).toBe(false)
  })

  test("findSettingsPage retrouve la page courante, ou rien", () => {
    expect(findSettingsPage("/settings/webhook")?.label).toBe("Webhook")
    expect(findSettingsPage("/pages")).toBeUndefined()
  })
})

describe("SettingsPageHeader", () => {
  function render(to: string, canWrite: boolean) {
    const page = SETTINGS_PAGES.find((candidate) => candidate.to === to)
    if (page === undefined) throw new Error(`page inconnue : ${to}`)
    return renderToStaticMarkup(
      <SettingsPageHeader page={page} canWrite={canWrite} />
    )
  }

  test("un seul h1, et aucun titre de rang inférieur dans l'en-tête", () => {
    // Le reproche d'origine : « Réglages » en `h1`, puis le nom de la
    // section répété en titre de carte juste sous l'entrée de menu du
    // même nom. Un `h1` par page, et les `h2` sont réservés aux pages qui
    // ont réellement plusieurs groupes de champs.
    const html = render("/settings/identite", true)
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1)
    expect(html).not.toContain("<h2")
    expect(html).toContain("Identité du site")
  })

  test("une page en lecture seule le dit deux fois : en pastille et en phrase", () => {
    const html = render("/settings/ia", true)
    expect(html).toContain("Lecture seule")
    expect(html).toMatch(/Rien ne se règle depuis cette page/)
  })

  test("une page réglable n'affiche aucune mention de lecture seule", () => {
    const html = render("/settings/identite", true)
    expect(html).not.toContain("Lecture seule")
    expect(html).not.toMatch(/propriétaire et les administrateurs/)
  })

  test("un editor lit pourquoi il ne peut rien changer", () => {
    const html = render("/settings/identite", false)
    expect(html).toMatch(/propriétaire et les administrateurs/)
  })
})
