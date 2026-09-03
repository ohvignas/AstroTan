import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { canauxDeLigne, MesNotifications } from "./mes-notifications"

const PREFS = [
  {
    cle: "leadNotification" as const,
    titre: "Nouveau message de contact",
    cloche: true,
    email: false,
  },
  {
    cle: "postPublished" as const,
    titre: "Un collègue a publié un article",
    cloche: true,
    email: false,
  },
]

test("deux lignes, quatre interrupteurs Cloche et E-mail", () => {
  const html = renderToStaticMarkup(
    <MesNotifications prefs={PREFS} onChange={() => {}} />,
  )
  expect(html).toContain("Nouveau message de contact")
  expect(html).toContain("Un collègue a publié un article")
  expect(html.match(/Cloche/g)?.length).toBe(2)
  expect(html.match(/E-mail/g)?.length).toBe(2)
})

test("canauxDeLigne : Cloche et E-mail seulement sur une clé de notif", () => {
  expect(canauxDeLigne("invitation", PREFS, () => {})).toBeNull()
  expect(canauxDeLigne("passwordReset", PREFS, () => {})).toBeNull()

  const lead = canauxDeLigne("leadNotification", PREFS, () => {})
  expect(lead).not.toBeNull()
  const html = renderToStaticMarkup(lead!)
  expect(html).toContain("Cloche")
  expect(html).toContain("E-mail")
  expect(html).not.toContain("Nouveau message de contact")
})
