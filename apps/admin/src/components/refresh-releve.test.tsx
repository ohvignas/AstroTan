import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { RefreshReleve } from "./refresh-releve"
import { MOTS_RELEVE } from "@/lib/refreshReleve"

function render(
  props: Partial<Parameters<typeof RefreshReleve>[0]> = {},
) {
  return renderToStaticMarkup(
    <RefreshReleve
      busy={false}
      disabled={false}
      onClick={() => undefined}
      {...props}
    />,
  )
}

describe("RefreshReleve", () => {
  test("icône accessible, pas un bouton texte Relever", () => {
    const html = render()
    expect(html).toContain("aria-label=\"Relever\"")
    expect(html).not.toMatch(/>Relever</)
    expect(html).not.toContain("animate-spin")
  })

  test("pendant l'appel : icône qui tourne et un mot gris", () => {
    const html = render({ busy: true })
    expect(html).toContain("animate-spin")
    expect(html).toContain("aria-busy")
    expect(html).toContain(MOTS_RELEVE[0])
    expect(html).toContain("text-muted-foreground")
    expect(html).toContain("disabled")
  })

  test("pendant Recharger : Actualisation… visible à côté, pas sr-only", () => {
    const html = render({ busy: true, pendingWords: ["Actualisation…"] })
    expect(html).toContain("Actualisation…")
    expect(html).not.toContain("sr-only")
    expect(html).toContain("text-muted-foreground")
  })

  test("échec : phrase FR à côté de l'icône, pas sr-only", () => {
    const html = render({
      error: "Le service d'audience n'a pas répondu.",
    })
    expect(html).toContain("audience n")
    expect(html).toContain("role=\"alert\"")
    expect(html).not.toContain("sr-only")
    expect(html).toContain("text-destructive")
  })

  test("la date du jeu affiché reste après succès, sans flash Actualisé à", () => {
    const html = render({
      justSucceeded: true,
      lastRefreshedAt: Date.UTC(2026, 8, 1, 11, 57, 0),
      now: Date.UTC(2026, 8, 1, 12, 0, 0),
    })
    expect(html).toContain("il y a 3 min")
    expect(html).not.toContain("Actualisé à")
    expect(html).not.toContain("À jour")
    expect(html).not.toContain("sr-only")
  })

  test("pendant l'actualisation : le mot ET la date restent", () => {
    const html = render({
      busy: true,
      pendingWords: ["Actualisation…"],
      lastRefreshedAt: Date.UTC(2026, 8, 1, 11, 57, 0),
      now: Date.UTC(2026, 8, 1, 12, 0, 0),
    })
    expect(html).toContain("Actualisation…")
    expect(html).toContain("il y a 3 min")
  })

  test("une fois fini : la date du dernier snapshot à côté", () => {
    const html = render({
      lastRefreshedAt: Date.UTC(2026, 8, 1, 11, 57, 0),
      now: Date.UTC(2026, 8, 1, 12, 0, 0),
    })
    expect(html).toContain("il y a 3 min")
    expect(html).not.toContain("Recherche")
  })

  test("jamais relevé : bouton actif", () => {
    const html = render({ disabled: false, lastRefreshedAt: undefined })
    expect(html).not.toMatch(/disabled=""/)
    expect(html).not.toContain("moins d")
  })

  test("throttle : inactif avec le titre qui dit pourquoi", () => {
    const html = render({
      disabled: true,
      disabledReason: "Déjà relevé il y a moins d'une heure.",
    })
    expect(html).toContain("disabled")
    expect(html).toContain("title=")
    expect(html).toContain("moins d")
    expect(html).toContain("une heure")
    expect(html).toContain("text-muted-foreground")
  })

  test("libellé aria remplaçable pour un autre relevé", () => {
    const html = render({ ariaLabel: "Actualiser l'audience" })
    expect(html).toContain("Actualiser l")
    expect(html).toContain("audience")
    expect(html).not.toContain("aria-label=\"Relever\"")
  })
})
