import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { CoachItem } from "./coach-buckets"
import { CoachGroup, scoreFromItems, worstTone } from "./coach-buckets"

const items: CoachItem[] = [
  {
    id: "keyphraseLength",
    tone: "bad",
    title: "Longueur du mot-clé",
    phrase: "Le mot-clé cible est absent ou trop long.",
  },
  {
    id: "textLength",
    tone: "ok",
    title: "Longueur du texte",
    phrase: "Le corps est trop court pour ce mot-clé.",
  },
  {
    id: "images",
    tone: "good",
    title: "Images",
    phrase: "C’est en ordre.",
  },
]

describe("CoachGroup", () => {
  test("accordéons Problèmes / Améliorations / Bons résultats, pas un score", () => {
    const html = renderToStaticMarkup(<CoachGroup items={items} />)
    expect(html).toContain("Problèmes")
    expect(html).toContain("Améliorations")
    expect(html).toContain("Bons résultats")
    expect(html).toContain("Longueur du mot-clé")
    expect(html).toContain("border-input")
    expect(html).toContain("text-destructive")
    expect(html).toContain("text-warning")
    expect(html).toContain("text-success")
    expect(html).not.toContain("/100")
    expect(html).not.toContain("baguette")
  })

  test("« Bons résultats » est replié, « Problèmes » est ouvert", () => {
    const html = renderToStaticMarkup(<CoachGroup items={items} />)
    expect(html).toContain("Le mot-clé cible est absent ou trop long.")
    expect(html).not.toContain("C’est en ordre.")
  })

  test("vide : phrase d'état, pas une note inventée", () => {
    const html = renderToStaticMarkup(<CoachGroup items={[]} />)
    expect(html).toContain("Rien à signaler pour le moment")
  })
})

describe("worstTone", () => {
  test("le pire état l'emporte, et le vide reste neutre", () => {
    expect(worstTone(items)).toBe("bad")
    expect(worstTone(items.slice(1))).toBe("ok")
    expect(worstTone(items.slice(2))).toBe("good")
    expect(worstTone([])).toBe("info")
  })
})

describe("scoreFromItems", () => {
  test("un problème pèse plus qu'une amélioration", () => {
    expect(scoreFromItems([])).toBe(0)
    expect(scoreFromItems(items.slice(2))).toBe(100)
    expect(scoreFromItems(items.slice(1))).toBe(78)
    expect(scoreFromItems(items)).toBe(52)
  })
})
