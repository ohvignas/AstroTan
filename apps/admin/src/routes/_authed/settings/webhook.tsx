import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import { describeSettingsError } from "@/lib/settingsErrors"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiTokenCard } from "@/components/api-token-card"

export const Route = createFileRoute("/_authed/settings/webhook")({
  component: WebhookRoute,
})

export function shouldShowLastDelivery(
  lastStatus: string | undefined,
  lastAt: number | undefined,
): boolean {
  if (!lastStatus || lastAt == null) return false
  const match = /^Envoyé \((\d{3})\)$/.exec(lastStatus)
  if (match === null) return false
  const code = Number(match[1])
  return code >= 200 && code < 300
}

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

function WebhookRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  // Le secret ne voyage plus dans `getPrivate` : il en a été retiré parce
  // que cette query-là est ouverte aux editors, et qu'un editor muni du
  // secret HMAC et de l'adresse forge des appels signés vers le scénario
  // de l'opérateur. Il s'obtient désormais par une demande explicite,
  // réservée à owner/admin — d'où le `"skip"` pour tous les autres.
  const secret = useQuery(api.settings.webhookSecret, canWrite ? {} : "skip")
  if (loading || settings === undefined) return <SettingsLoading />
  if (canWrite && secret === undefined) return <SettingsLoading />
  return (
    <WebhookForm settings={settings} secret={secret ?? null} canWrite={canWrite} />
  )
}

// ---------------------------------------------------------------------
// La seule page de réglages où RIEN ne part tout seul.
//
// Le webhook est à cet écran ce que le slug est à l'éditeur de pages : un
// champ dont l'écriture a un effet au-delà de sa propre ligne, donc jamais
// automatique.
//
// Deux raisons, pas une. `settings.update` frappe un secret HMAC aléatoire
// dès qu'une URL est posée sans secret — une frappe par caractère en
// poserait un par valeur intermédiaire. Et surtout,
// `https://exemple.co` est une URL parfaitement valide en route vers
// `https://exemple.com` : enregistrée ne serait-ce qu'une seconde, tout
// lead reçu pendant cette seconde part chez l'hôte de passage.
//
// C'est aussi la page qui a motivé le choix de PRÉVENIR plutôt que
// d'enregistrer en quittant (voir `unsaved-changes-guard.tsx`) : ici,
// naviguer ailleurs perdrait toujours tout, et une sauvegarde
// automatique « de politesse » au départ serait exactement l'écriture que
// ce champ refuse.
// ---------------------------------------------------------------------

function WebhookForm({
  settings,
  secret: secretInitial,
  canWrite,
}: {
  settings: Settings
  secret: string | null
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [url, setUrl] = useState(settings?.leadWebhookUrl ?? "")
  const [secret, setSecret] = useState(secretInitial ?? "")

  // Chaîne vide = « débrancher » : `null` efface le réglage côté serveur,
  // là où `undefined` le laisserait tel quel. Sans cette distinction, un
  // webhook posé une fois ne pourrait plus être retiré.
  const manualFields = {
    leadWebhookUrl: url.trim() === "" ? null : url.trim(),
    leadWebhookSecret: secret.trim() === "" ? null : secret.trim(),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    // Une photo vide et constante : `snapshotChanged({}, {})` est toujours
    // faux, donc la temporisation de sauvegarde automatique n'est jamais
    // armée. C'est la façon dont `useAutoSave` exprime « cette page n'a
    // aucun champ sûr », et non un oubli.
    auto: {},
    manual: manualFields,
    saveAuto: async () => {
      // Inatteignable par construction (voir `auto` ci-dessus). Lever
      // plutôt que ne rien faire : si un changement futur de `useAutoSave`
      // arme quand même la temporisation, l'erreur s'affiche dans la barre
      // au lieu d'écrire l'URL en douce.
      throw new Error(
        "Le webhook n'a aucun champ à sauvegarde automatique : cet appel ne devrait pas exister."
      )
    },
    saveAll: async ({ manual }) => {
      await updateSettings(manual)
    },
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/webhook"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="L'adresse ou le secret du webhook"
    >
      <ApiTokenCard canWrite={canWrite} />

      <SettingsGroup>
        <Field>
          <FieldLabel htmlFor="webhook-url">Adresse du webhook</FieldLabel>
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://hook.eu2.make.com/…"
            value={url}
            disabled={!canWrite}
            onChange={(event) => setUrl(event.target.value)}
          />
          <FieldDescription>
            En <code className="text-xs">https</code>, jamais une adresse
            interne. Vider le champ débranche le webhook.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="webhook-secret">Secret de signature</FieldLabel>
          <Input
            id="webhook-secret"
            type="text"
            placeholder="une longue chaîne aléatoire"
            value={secret}
            disabled={!canWrite}
            onChange={(event) => setSecret(event.target.value)}
          />
          <FieldDescription>
            À recopier dans votre scénario : il signe chaque envoi
            (HMAC-SHA256, en-tête{" "}
            <code className="text-xs">x-astrotan-signature</code>). Laissé
            vide avec une adresse posée, le serveur en frappe un au hasard.
          </FieldDescription>
        </Field>

        {shouldShowLastDelivery(
          settings?.leadWebhookLastStatus,
          settings?.leadWebhookLastAt,
        ) && (
          <p className="text-sm text-muted-foreground">
            {/* L'état du dernier envoi, visible ici plutôt que dans des
                journaux : un webhook muet depuis trois semaines est le
                défaut le plus courant de ce genre d'intégration. */}
            Dernier envoi : {settings.leadWebhookLastStatus}
            {settings.leadWebhookLastAt &&
              ` — ${new Intl.DateTimeFormat("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(settings.leadWebhookLastAt))}`}
          </p>
        )}
      </SettingsGroup>
    </SettingsFormShell>
  )
}
