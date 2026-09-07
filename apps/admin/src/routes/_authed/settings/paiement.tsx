import { createFileRoute } from "@tanstack/react-router"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"
import { SectionPaiementStripe, webhookUrlDepuisConvexCloud } from "@/components/settings-paiement"
import { useAutoSave } from "@/components/save-bar"

export const Route = createFileRoute("/_authed/settings/paiement")({
  component: PaiementRoute,
})

function PaiementRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  if (loading || secrets === undefined) return <SettingsLoading />

  return <PaiementForm canWrite={canWrite} secrets={secrets} />
}

function PaiementForm({
  canWrite,
  secrets,
}: {
  canWrite: boolean
  secrets: NonNullable<ReturnType<typeof useSecretsAccess>["secrets"]>
}) {
  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: {},
    manual: {},
    saveAuto: async () => {
      throw new Error("Paiement n'a aucun champ à sauvegarde automatique.")
    },
    saveAll: async () => {
      throw new Error("Paiement n'a aucun champ à enregistrer depuis la barre.")
    },
  })

  const webhookUrl = webhookUrlDepuisConvexCloud(
    import.meta.env.VITE_CONVEX_URL as string | undefined,
  )

  return (
    <SettingsFormShell
      to="/settings/paiement"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Les clés Stripe"
    >
      <SectionPaiementStripe secrets={secrets} webhookUrl={webhookUrl} />
    </SettingsFormShell>
  )
}
