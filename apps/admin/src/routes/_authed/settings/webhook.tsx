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

export const Route = createFileRoute("/_authed/settings/webhook")({
  component: WebhookRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

function WebhookRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || settings === undefined) return <SettingsLoading />
  return <WebhookForm settings={settings} canWrite={canWrite} />
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
  canWrite,
}: {
  settings: Settings
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [url, setUrl] = useState(settings?.leadWebhookUrl ?? "")
  const [secret, setSecret] = useState(settings?.leadWebhookSecret ?? "")

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
      <SettingsGroup>
        {canWrite && (
          <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <strong>Cette page ne s'enregistre jamais toute seule.</strong>{" "}
            <code className="text-xs">https://exemple.co</code> est une
            adresse valide en route vers{" "}
            <code className="text-xs">https://exemple.com</code> :
            enregistrée ne serait-ce qu'une seconde, elle enverrait à un
            inconnu les leads reçus pendant cette seconde. Rien ne part
            avant le clic sur « Enregistrer ».
          </p>
        )}

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
            En <code className="text-xs">https</code> uniquement, et jamais
            une adresse interne : un champ d'URL qui déclenche un appel
            sortant est refusé sur <code className="text-xs">localhost</code>,
            les plages privées et l'adresse de métadonnées de l'hébergeur.
            Vider le champ débranche le webhook.
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
            Chaque envoi porte un en-tête{" "}
            <code className="text-xs">x-astrotan-signature</code>,
            HMAC-SHA256 du corps avec ce secret. Il permet à votre scénario
            de vérifier que l'appel vient bien de vous — une URL de webhook
            traverse des journaux et des captures d'écran, elle n'est pas un
            secret. Laissé vide alors qu'une adresse est posée, le serveur
            en frappe un au hasard : envoyer sans signature serait le pire
            des deux mondes.
          </FieldDescription>
        </Field>

        {settings?.leadWebhookLastStatus && (
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
