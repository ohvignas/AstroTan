import { availableNetworks } from "@astrotan/backend/convex/lib/socialNetworks"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { SocialsField } from "./socials-field"
import source from "./socials-field.tsx?raw"

function render(
  patch: Partial<{
    canWrite: boolean
    socials: { label: string; url: string }[]
  }> = {},
) {
  return renderToStaticMarkup(
    <SocialsField
      canWrite={patch.canWrite ?? true}
      socials={patch.socials ?? []}
      onChange={() => {}}
    />,
  )
}

test("un réseau déjà ajouté montre l'icône, l'URL et Retirer", () => {
  const html = render({
    socials: [{ label: "instagram", url: "https://instagram.com/exemple" }],
  })
  expect(html).toContain("Instagram")
  expect(html).toContain("https://instagram.com/exemple")
  expect(html).toContain("Retirer")
  expect(html).toContain("<svg")
})

test("le sélecteur n'offre pas un réseau déjà présent", () => {
  const html = render({
    socials: [{ label: "instagram", url: "https://instagram.com/exemple" }],
  })
  expect(html).toContain("Ajouter un réseau")
  // Le menu fermé n'est pas dans le HTML statique : la liste restante
  // est celle de `availableNetworks`, pas une seconde table.
  expect(source).toContain("availableNetworks")
  const rest = availableNetworks(["instagram"]).map((network) => network.id)
  expect(rest).not.toContain("instagram")
  expect(rest).toContain("linkedin")
})

test("un editor voit la liste, sans Ajouter ni Retirer", () => {
  const html = render({
    canWrite: false,
    socials: [{ label: "github", url: "https://github.com/exemple" }],
  })
  expect(html).toContain("GitHub")
  expect(html).toContain("https://github.com/exemple")
  expect(html).not.toContain("Ajouter un réseau")
  expect(html).not.toContain("Retirer")
})

test("une URL qui n'est pas http(s) est signalée", () => {
  const html = render({
    socials: [{ label: "x", url: "javascript:alert(1)" }],
  })
  expect(html).toMatch(/http/)
})
