import { createFileRoute } from "@tanstack/react-router"
import { ChampSecret } from "@/components/settings-environment"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsPageShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"

export const Route = createFileRoute("/_authed/settings/paiement")({
  component: PaiementRoute,
})

function PaiementRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  if (loading || secrets === undefined) return <SettingsLoading />

  return (
    <SettingsPageShell to="/settings/paiement" canWrite={canWrite}>
      <SettingsGroup title="Stripe">
        <p className="text-sm text-muted-foreground">
          L'offre Complet (9,99 € une fois) s'ouvre depuis /tarifs. Le
          montant est figé côté serveur : trafiquer le formulaire ne change
          rien. Le webhook Stripe doit pointer
          {" "}
          <code className="text-xs">https://&lt;CONVEX_SITE_URL&gt;/stripe/webhook</code>
          .
        </p>
        <ChampSecret
          bloc={secrets}
          nom="STRIPE_SECRET_KEY"
          consequence="Sans cette clé, le bouton Payer de /tarifs ne peut pas ouvrir Stripe."
        >
          Clé secrète Stripe (sk_test_… ou sk_live_…). L'environnement gagne
          s'il en porte une.
        </ChampSecret>
        <ChampSecret
          bloc={secrets}
          nom="STRIPE_WEBHOOK_SECRET"
          consequence="Sans ce secret, les paiements confirmés ne s'enregistrent pas."
        >
          Secret de signature du webhook (whsec_…). Stripe le donne à la
          création de l'endpoint.
        </ChampSecret>
      </SettingsGroup>
    </SettingsPageShell>
  )
}
