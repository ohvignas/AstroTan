import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  extractTextFromHtml,
  fetchPublishedText,
  publishedPageUrl,
} from "./publishedPageText"

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test("extrait le texte et ignore scripts, styles et balises", () => {
  const html = `
    <html><head><style>body{color:red}</style></head>
    <body>
      <script>alert("x")</script>
      <h1>Accueil</h1>
      <p>Bonjour&nbsp;le&nbsp;monde</p>
    </body></html>
  `
  expect(extractTextFromHtml(html)).toBe("# Accueil\n\nBonjour le monde")
})

test("nav, footer et bandeau cookies hors de <main> ne sont pas extraits", () => {
  const html = `
    <body>
      <header><nav>Menu Accueil Contact</nav></header>
      <main id="main-content">
        <h1>Cabinet</h1>
        <p>Nous recevons sur rendez-vous du lundi au vendredi.</p>
      </main>
      <footer>Mentions légales — © AstroTan</footer>
      <div data-consent-banner>
        <h2>Cookies et traceurs</h2>
        <p>Ce site mesure son audience sans cookie.</p>
      </div>
    </body>
  `
  const text = extractTextFromHtml(html)
  expect(text).toContain("# Cabinet")
  expect(text).toContain("Nous recevons sur rendez-vous")
  expect(text).not.toContain("Menu Accueil Contact")
  expect(text).not.toContain("Mentions légales")
  expect(text).not.toContain("Cookies et traceurs")
})

test("fetch 200 rend le texte, sans jeton preview", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "<p>Page publiée</p>",
  })
  const text = await fetchPublishedText("https://exemple.fr", "contact")
  expect(text).toBe("Page publiée")
  const [url] = fetchMock.mock.calls[0] as [string]
  expect(url).toBe("https://exemple.fr/contact")
  expect(url).not.toContain("t=")
  expect(url).not.toContain("preview")
})

test("fetch 404 rend null", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "nope" })
  expect(await fetchPublishedText("https://exemple.fr", "absente")).toBeNull()
})

test("accueil et slug vide pointent sur /", () => {
  expect(publishedPageUrl("https://exemple.fr", "")).toBe("https://exemple.fr/")
  expect(publishedPageUrl("https://exemple.fr", "accueil")).toBe("https://exemple.fr/")
  expect(publishedPageUrl("https://exemple.fr/", "accueil", "accueil")).toBe(
    "https://exemple.fr/",
  )
})
