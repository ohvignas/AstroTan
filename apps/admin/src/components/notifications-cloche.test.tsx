import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  ClochePanneau,
  aDesNonLues,
  hrefDeNotification,
  iconeDeNotification,
} from "./notifications-cloche"
import { MailIcon, MessageCircleIcon, NewspaperIcon } from "lucide-react"

test("aDesNonLues : booléen, jamais un chiffre affiché dans le panneau", () => {
  expect(aDesNonLues(0)).toBe(false)
  expect(aDesNonLues(12)).toBe(true)

  const vide = renderToStaticMarkup(
    <ClochePanneau lignes={[]} onChoisir={() => {}} onRetirer={() => {}} onLireTous={() => {}} />,
  )
  expect(vide).toContain("Aucune notification")
  expect(vide).not.toContain("9+")
  expect(vide).not.toContain("Lire tous")

  const plein = renderToStaticMarkup(
    <ClochePanneau
      lignes={[
        {
          _id: "n1",
          cle: "leadNotification",
          titre: "Nouveau message de contact",
          _creationTime: Date.now(),
        },
        {
          _id: "n2",
          cle: "leadNotification",
          titre: "Nouveau chat sur le site",
          _creationTime: Date.now() - 10 * 60_000,
        },
      ]}
      onChoisir={() => {}}
      onRetirer={() => {}}
      onLireTous={() => {}}
    />,
  )
  expect(plein).not.toContain("9+")
  expect(plein).not.toMatch(/>12</)
  expect(plein).toContain("Nouveau message de contact")
  expect(plein).toContain("Nouveau chat sur le site")
  expect(plein).toContain("Lire tous")
  expect(plein).toContain('data-slot="alert"')
  expect(plein).toContain("Marquer comme lue")
  expect(plein).toContain('data-slot="alert-action"')
})

test("une ligne déjà lue disparaît du panneau", () => {
  const html = renderToStaticMarkup(
    <ClochePanneau
      lignes={[
        {
          _id: "n1",
          cle: "leadNotification",
          titre: "Nouveau message de contact",
          readAt: Date.now(),
          _creationTime: Date.now(),
        },
      ]}
      onChoisir={() => {}}
      onRetirer={() => {}}
      onLireTous={() => {}}
    />,
  )
  expect(html).toContain("Aucune notification")
  expect(html).not.toContain("Nouveau message de contact")
  expect(html).not.toContain("Lire tous")
})

test("iconeDeNotification selon le type", () => {
  expect(iconeDeNotification({ cle: "leadNotification", titre: "Nouveau message de contact" })).toBe(
    MailIcon,
  )
  expect(iconeDeNotification({ cle: "leadNotification", titre: "Nouveau chat sur le site" })).toBe(
    MessageCircleIcon,
  )
  expect(iconeDeNotification({ cle: "postPublished", titre: "Un collègue a publié un article" })).toBe(
    NewspaperIcon,
  )
})

test("hrefDeNotification : lead → /leads, article → /posts/$id", () => {
  expect(hrefDeNotification({ cle: "leadNotification" })).toBe("/leads")
  expect(hrefDeNotification({ cle: "postPublished", postId: "p1" })).toBe("/posts/p1")
})
