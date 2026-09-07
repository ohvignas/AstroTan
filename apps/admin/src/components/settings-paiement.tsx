import { ExternalLinkIcon } from "lucide-react"
import { Field, FieldLabel } from "@/components/ui/field"
import { SettingsGroup } from "@/components/settings-nav"
import { ChampSecret, type SecretsBloc } from "@/components/settings-environment"
import { CleMaitresseBandeau } from "@/components/settings-secrets"

export const STRIPE_WEBHOOK_PATH = "/stripe/webhook"

export function webhookUrlDepuisConvexCloud(convexUrl: string | undefined): string | null {
  if (!convexUrl) return null
  try {
    const url = new URL(convexUrl)
    if (!url.hostname.endsWith(".convex.cloud")) return null
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site")
    url.pathname = STRIPE_WEBHOOK_PATH
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export function SectionPaiementStripe({
  secrets,
  webhookUrl,
}: {
  secrets: SecretsBloc
  webhookUrl: string | null
}) {
  if (secrets.cleMaitresse === null) {
    return (
      <SettingsGroup title="Stripe">
        <p className="text-sm text-muted-foreground">
          Réservée au propriétaire et aux administrateurs.
        </p>
      </SettingsGroup>
    )
  }
  return (
    <SettingsGroup title="Stripe">
      {secrets.cleMaitresse === "posee" ? null : (
        <CleMaitresseBandeau etat={secrets.cleMaitresse} />
      )}
      <Field>
        <FieldLabel>Clé secrète</FieldLabel>
        <ChampSecret
          bloc={secrets}
          nom="STRIPE_SECRET_KEY"
          consequence="Le bouton Payer des tarifs ne pourra plus ouvrir Stripe Checkout."
        >
          <a
            href="https://dashboard.stripe.com/apikeys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            dashboard.stripe.com/apikeys
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
        </ChampSecret>
      </Field>
      <Field>
        <FieldLabel>Secret du webhook</FieldLabel>
        <ChampSecret
          bloc={secrets}
          nom="STRIPE_WEBHOOK_SECRET"
          consequence="Les paiements réussis ne seront plus enregistrés."
        >
          <a
            href="https://dashboard.stripe.com/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            dashboard.stripe.com/webhooks
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
        </ChampSecret>
      </Field>
      {webhookUrl ? (
        <p className="text-sm text-muted-foreground">
          Endpoint à déclarer chez Stripe :{" "}
          <code className="text-xs">{webhookUrl}</code>
          {" — événement "}
          <code className="text-xs">checkout.session.completed</code>.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Endpoint :{" "}
          <code className="text-xs">https://&lt;déploiement&gt;.convex.site/stripe/webhook</code>
          , événement <code className="text-xs">checkout.session.completed</code>.
        </p>
      )}
    </SettingsGroup>
  )
}
