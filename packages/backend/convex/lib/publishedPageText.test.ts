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
  expect(extractTextFromHtml(html)).toBe("Accueil Bonjour le monde")
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
