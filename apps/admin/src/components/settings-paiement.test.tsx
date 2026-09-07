import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  SectionPaiementStripe,
  webhookUrlDepuisConvexCloud,
} from "./settings-paiement"
import type { SecretsBloc } from "./settings-environment"

function bloc(over: Partial<SecretsBloc> = {}): SecretsBloc {
  return {
    cleMaitresse: "posee",
    etats: {
      STRIPE_SECRET_KEY: {
        nom: "STRIPE_SECRET_KEY",
        environnement: true,
        base: false,
        illisible: false,
        source: "environnement",
      },
    },
    canWrite: true,
    onSave: async () => undefined,
    onClear: async () => undefined,
    ...over,
  }
}

describe("webhookUrlDepuisConvexCloud", () => {
  test("dérive l'URL site Convex, jamais un secret", () => {
    expect(
      webhookUrlDepuisConvexCloud("https://happy-animal-123.convex.cloud"),
    ).toBe("https://happy-animal-123.convex.site/api/stripe")
  })

  test("sur un Convex auto-hébergé, garde l'origine publique", () => {
    expect(webhookUrlDepuisConvexCloud("https://astrotan.illith.com")).toBe(
      "https://astrotan.illith.com/api/stripe",
    )
  })

  test("refuse une URL mal formée", () => {
    expect(webhookUrlDepuisConvexCloud("pas-une-url")).toBeNull()
  })
})

describe("SectionPaiementStripe", () => {
  test("affiche Configuré sans la valeur de la clé", () => {
    const html = renderToStaticMarkup(
      <SectionPaiementStripe
        secrets={bloc()}
        webhookUrl="https://x.convex.site/api/stripe"
      />,
    )
    expect(html).toContain("Connecté")
    expect(html).toContain("Environnement")
    expect(html).not.toContain("sk_live")
    expect(html).not.toContain("sk_test")
    expect(html).not.toContain("whsec")
    expect(html).toContain("https://x.convex.site/api/stripe")
  })

  test("un editor sans clé maîtresse ne voit pas les champs", () => {
    const html = renderToStaticMarkup(
      <SectionPaiementStripe
        secrets={bloc({ cleMaitresse: null, canWrite: false })}
        webhookUrl={null}
      />,
    )
    expect(html).toContain("Réservée au propriétaire")
    expect(html).not.toContain("STRIPE_SECRET_KEY")
  })
})
