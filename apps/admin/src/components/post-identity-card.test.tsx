import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { useForm } from "@tanstack/react-form"
import { EMPTY_POST_FORM } from "@/lib/postForm"
import { PostIdentityCard } from "./post-identity-card"

vi.mock("./cover-field", () => ({
  CoverField: () => <div>Sélecteur de couverture</div>,
}))

function Shell() {
  const form = useForm({ defaultValues: EMPTY_POST_FORM })
  return (
    <PostIdentityCard
      form={form}
      canWrite
      generatingCover={false}
      titlePlaceholder="Un titre"
      generateAction={<button type="button">Générer avec l’IA</button>}
      onGenerateCover={() => undefined}
    />
  )
}

test("une carte : titre, extrait, mot-clé, cover à droite ; Google dans Plus d’options", () => {
  const html = renderToStaticMarkup(<Shell />)
  expect(html).toContain("Titre (page / H1)")
  expect(html).toContain("Extrait")
  expect(html).toContain("Résumé des cartes du blog")
  expect(html).toContain("Mot-clé cible")
  expect(html).toContain("Image de couverture")
  expect(html).toContain("og:image")
  expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)]")
  expect(html).toContain("Plus d’options")
  expect(html).toContain("Visibilité sociale")
  expect(html).toContain("Titre Google")
  expect(html).toContain("Si vide, on utilise le titre.")
  expect(html).toContain("Méta description")
  expect(html).toContain("Si vide, on utilise l’extrait.")
  expect(html).toContain("Slug")
  expect(html).toContain("URL canonique")
  expect(html).toContain("noindex")
  expect(html).toContain("Moteurs de réponse (GEO)")
  expect(html.indexOf("Plus d’options")).toBeLessThan(html.indexOf("Visibilité sociale"))
  expect(html.indexOf("Visibilité sociale")).toBeLessThan(html.indexOf("Titre Google"))
  expect(html.indexOf("Méta description")).toBeLessThan(html.indexOf("Slug"))
  expect(html).not.toContain("Informations générales")
  expect(html).not.toContain("Titre SEO")
  expect(html).not.toContain("Image de partage")
})
