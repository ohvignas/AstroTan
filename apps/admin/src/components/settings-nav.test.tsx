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
  SETTINGS_PAGES,
  SettingsPageHeader,
  findSettingsPage,
  isSettingsPathActive,
} from "./settings-nav"

describe("SETTINGS_PAGES", () => {
  test("porte les pages attendues, dans l'ordre du menu", () => {
    expect(SETTINGS_PAGES.map((page) => page.to)).toEqual([
      "/settings/identite",
      "/settings/webhook",
      "/settings/domaine",
      "/settings/emails",
      "/settings/mesure",
      "/settings/agent",
    ])
    expect(SETTINGS_PAGES.map((page) => page.to as string)).not.toContain(
      "/settings/ia",
    )
    expect(SETTINGS_PAGES.map((page) => page.to)).not.toContain("/settings/reseaux")
  })

  test("la page agent s'appelle Agent IA & Modèle IA", () => {
    expect(SETTINGS_PAGES.find((p) => p.to === "/settings/agent")).toMatchObject({
      label: "Agent IA & Modèle IA",
      title: "Agent IA & Modèle IA",
      description: "",
    })
  })

  test("/settings/ia redirige vers l'agent", () => {
    const source = ROUTE_FILES["../routes/_authed/settings/ia.tsx"]
    expect(source).toBeTruthy()
    expect(source).toContain("throw redirect")
    expect(source).toContain("/settings/agent")
    expect(source).not.toContain("AiPage")
    expect(source).not.toContain("SettingsFormShell")
  })

  test("n'offre plus l'écran de référencement par défaut", () => {
    // Titre, canonique et noindex site de cet écran n'étaient pas lus
    // par le site public. Le filet description + OG reste en base.
    expect(SETTINGS_PAGES.map((page) => page.to as string)).not.toContain(
      "/settings/referencement",
    )
  })

  test("aucun chemin en double", () => {
    const paths = SETTINGS_PAGES.map((page) => page.to)
    expect(new Set(paths).size).toBe(paths.length)
  })

  test("la page mesure s'appelle SEO & Pixel", () => {
    expect(SETTINGS_PAGES.find((p) => p.to === "/settings/mesure")).toMatchObject({
      label: "SEO & Pixel",
      title: "SEO & Pixel",
      description: "",
    })
  })

  test("la page webhook s'appelle API & webhook", () => {
    expect(SETTINGS_PAGES.find((p) => p.to === "/settings/webhook")).toMatchObject({
      label: "API & webhook",
      title: "API et webhook",
    })
  })

  test("la page emails s'appelle Email & notifications", () => {
    expect(SETTINGS_PAGES.find((p) => p.to === "/settings/emails")).toMatchObject({
      label: "Email & notifications",
      title: "Email & notifications",
      description: "",
    })
  })

  test("le titre de page commence par le libellé du menu", () => {
    // L'orientation, et c'est le reproche auquel tout ce découpage
    // répond : on doit pouvoir relier d'un coup d'œil l'entrée cliquée et
    // la page ouverte. Un `h1` sans rapport avec le libellé cliqué laisse
    // croire qu'on a atterri ailleurs.
    //
    // La conjonction est normalisée : le menu écrit « Domaine & DNS »
    // faute de largeur, le titre « Domaine et DNS ». Un libellé et un
    // titre identiques (« SEO & Pixel ») restent acceptés tels quels.
    for (const page of SETTINGS_PAGES) {
      const formes = [page.label, page.label.replace(" & ", " et ")]
      expect(
        formes.some((forme) => page.title.startsWith(forme)),
        `${page.title} / ${page.label}`
      ).toBe(true)
    }
  })
})

// `?raw` : on lit le TEXTE des fichiers de route, on ne les exécute pas.
// Les importer déclencherait `createFileRoute`, qui veut le registre du
// routeur.
//
// Le second motif exclut les fichiers de test co-localisés (`*.test.tsx`,
// par ex. `identite.test.tsx`) : `*.tsx` les capture aussi, puisque `*` ne
// s'arrête pas au point à l'intérieur d'un même segment de chemin.
const ROUTE_FILES = import.meta.glob(
  ["../routes/_authed/settings/*.tsx", "!../routes/_authed/settings/*.test.tsx"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  }
)

describe("les fichiers de route", () => {
  test("il en existe un par page déclarée", () => {
    // Le lien mort le plus facile à fabriquer : renommer
    // `webhook.tsx` et oublier `SETTINGS_PAGES`. Rien
    // ne casse au typecheck, et l'entrée de menu mène à une 404.
    const fichiers = Object.keys(ROUTE_FILES)
      .map((path) => path.split("/").pop()?.replace(/\.tsx$/, ""))
      .filter((name): name is string => name !== undefined && name !== "index")
    const attendus = SETTINGS_PAGES.map((page) =>
      page.to.replace("/settings/", "")
    )
    for (const attendu of attendus) {
      expect(fichiers, `fichier manquant pour /settings/${attendu}`).toContain(
        attendu
      )
    }
  })

  test("un fichier hors menu n'est qu'une redirection de signet", () => {
    // `referencement.tsx` reste pour ne pas 404 un bookmark ; il n'a
    // plus d'entrée de menu. Tout autre fichier extra doit faire pareil.
    const fichiers = Object.keys(ROUTE_FILES)
      .map((path) => path.split("/").pop()?.replace(/\.tsx$/, ""))
      .filter((name): name is string => name !== undefined && name !== "index")
    const menu = SETTINGS_PAGES.map((page) => page.to.replace("/settings/", ""))
    for (const extra of fichiers.filter((name) => !menu.includes(name))) {
      const source = ROUTE_FILES[`../routes/_authed/settings/${extra}.tsx`]
      expect(source, `${extra}.tsx hors menu sans redirect`).toContain(
        "throw redirect"
      )
    }
  })

  test("/settings/referencement redirige vers l'identité", () => {
    const source = ROUTE_FILES["../routes/_authed/settings/referencement.tsx"]
    expect(source).toBeTruthy()
    expect(source).toContain("throw redirect")
    expect(source).toContain("/settings/identite")
    expect(source).not.toContain("defaultSeo")
  })

  test("/settings/reseaux redirige vers l'identité", () => {
    const source = ROUTE_FILES["../routes/_authed/settings/reseaux.tsx"]
    expect(source).toBeTruthy()
    expect(source).toContain("throw redirect")
    expect(source).toContain("/settings/identite")
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

const SETTINGS_NAV_SOURCE = import.meta.glob("./settings-nav.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["./settings-nav.tsx"] as string

describe("SettingsNav — séparateur et onglet courant", () => {
  test("le trait va du haut au bas de la colonne, token border-border", () => {
    // Miroir de la sidebar : le filet est sur la COLONNE étirée, pas sur
    // la liste. `self-start` recollerait le trait à la hauteur des
    // libellés. `lg:` seulement — sous ce seuil le menu est une bande
    // horizontale. `-my-4` mange le `p-4` de l'inset, pour toucher le
    // `border-b` du header et le bas de la zone, comme le `h-svh` de
    // la barre latérale.
    expect(SETTINGS_NAV_SOURCE).toContain("lg:border-r")
    expect(SETTINGS_NAV_SOURCE).toContain("lg:border-border")
    expect(SETTINGS_NAV_SOURCE).toContain("lg:self-stretch")
    expect(SETTINGS_NAV_SOURCE).toContain("lg:-my-4")
    expect(SETTINGS_NAV_SOURCE).not.toContain("lg:self-start")
    expect(SETTINGS_NAV_SOURCE).toMatch(/<ul className="[^"]*lg:sticky/)
  })

  test("l'onglet courant se distingue par bg-muted et text-foreground", () => {
    // Couleur + graisse : la couleur ne porte pas l'info seule
    // (`aria-current` est déjà posé). Mêmes tokens que le reste de l'admin.
    expect(SETTINGS_NAV_SOURCE).toMatch(
      /active[\s\S]*\?[\s\S]*bg-muted[\s\S]*text-foreground/,
    )
  })
})

describe("isSettingsPathActive", () => {
  test("correspondance exacte, barre finale tolérée", () => {
    expect(isSettingsPathActive("/settings/webhook", "/settings/webhook")).toBe(true)
    expect(isSettingsPathActive("/settings/webhook/", "/settings/webhook")).toBe(true)
  })

  test("un préfixe n'allume pas une entrée", () => {
    // `startsWith` aurait marché aujourd'hui et allumé deux entrées à la
    // fois au premier chemin plus long.
    expect(isSettingsPathActive("/settings/webhook-leads", "/settings/webhook")).toBe(
      false
    )
    expect(isSettingsPathActive("/settings", "/settings/identite")).toBe(false)
  })

  test("findSettingsPage retrouve la page courante, ou rien", () => {
    expect(findSettingsPage("/settings/webhook")?.label).toBe("API & webhook")
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

  test("aucune page ne s'annonce en lecture seule : il n'y en a plus", () => {
    // Les trois pages d'environnement portaient une pastille « Lecture
    // seule » et un paragraphe qui l'expliquait. Elles portent maintenant
    // les champs de saisie des jetons, et la mention serait fausse.
    for (const page of SETTINGS_PAGES) {
      expect(render(page.to, true)).not.toContain("Lecture seule")
    }
  })

  test("une page ne parle des rôles que pour dire à un editor ce qu'il ne peut pas", () => {
    expect(render("/settings/identite", true)).not.toMatch(
      /propriétaire et les administrateurs/
    )
  })

  test("un editor lit pourquoi il ne peut rien changer", () => {
    const html = render("/settings/identite", false)
    expect(html).toMatch(/propriétaire et les administrateurs/)
  })
})
