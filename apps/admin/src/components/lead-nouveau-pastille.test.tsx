import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { LeadNouveauPastille } from "./lead-nouveau-pastille"

describe("LeadNouveauPastille", () => {
  test("une fiche jamais ouverte porte la pastille Nouveau", () => {
    const html = renderToStaticMarkup(<LeadNouveauPastille seenAt={undefined} />)
    expect(html).toContain("Nouveau")
  })

  test("une fiche déjà ouverte n'a plus de pastille", () => {
    const html = renderToStaticMarkup(<LeadNouveauPastille seenAt={1} />)
    expect(html).toBe("")
  })
})
