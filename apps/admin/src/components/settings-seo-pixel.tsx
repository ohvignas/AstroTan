import { useState } from "react"
import { actionSurLigne, type ActionLigne } from "@/components/email-templates"
import {
  DialogueConfirmation,
  LigneDataForSeo,
  LignePixel,
} from "@/components/seo-pixel-ligne"
import { SettingsGroup } from "@/components/settings-nav"
import { SerpLieuSelect } from "@/components/serp-lieu-select"
import type { SecretsBloc } from "@/components/settings-environment"
import { describeSettingsError } from "@/lib/settingsErrors"

export function estDataForSeoConfigure(
  etats: Record<string, { source?: string } | undefined>,
): boolean {
  const login = etats.DATAFORSEO_LOGIN?.source
  const password = etats.DATAFORSEO_PASSWORD?.source
  return (
    login !== undefined &&
    login !== "aucune" &&
    password !== undefined &&
    password !== "aucune"
  )
}

type PixelPatch = { metaPixelId?: string | null; googleTagId?: string | null }

export function SeoPixelPage({
  canWrite,
  secrets,
  metaPixelId,
  googleTagId,
  serpLocationCode,
  serpLanguageCode,
  onSaveSecret,
  onClearSecret,
  onSavePixel,
  onSaveSerp,
}: {
  canWrite: boolean
  secrets: SecretsBloc
  metaPixelId: string | null
  googleTagId: string | null
  serpLocationCode: number | null
  serpLanguageCode: string | null
  onSaveSecret: (nom: string, valeur: string) => Promise<void>
  onClearSecret: (nom: string) => Promise<void>
  onSavePixel: (patch: PixelPatch) => Promise<unknown>
  onSaveSerp: (patch: {
    serpLocationCode: number
    serpLanguageCode: string
  }) => Promise<unknown>
}) {
  const bloc: SecretsBloc = { ...secrets, onSave: onSaveSecret, onClear: onClearSecret }
  const [ouverte, setOuverte] = useState<string | null>(null)
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)
  const [retraitDataForSeo, setRetraitDataForSeo] = useState(false)
  const [brouillonMeta, setBrouillonMeta] = useState(metaPixelId ?? "")
  const [brouillonGoogle, setBrouillonGoogle] = useState(googleTagId ?? "")
  const [secretsModifies, setSecretsModifies] = useState(false)
  const [erreurMeta, setErreurMeta] = useState<string | null>(null)
  const [erreurGoogle, setErreurGoogle] = useState<string | null>(null)
  const [busy, setBusy] = useState<"repos" | "meta" | "google" | "retrait">("repos")

  const modifie =
    ouverte === "dataforseo"
      ? secretsModifies
      : ouverte === "meta"
        ? brouillonMeta !== (metaPixelId ?? "")
        : ouverte === "google"
          ? brouillonGoogle !== (googleTagId ?? "")
          : false

  function appliquer(action: ActionLigne, cible: string) {
    if (action === "confirmer") return
    if (action === "replier") {
      setOuverte(null)
      return
    }
    setOuverte(cible)
    setSecretsModifies(false)
    if (cible === "meta") {
      setBrouillonMeta(metaPixelId ?? "")
      setErreurMeta(null)
    }
    if (cible === "google") {
      setBrouillonGoogle(googleTagId ?? "")
      setErreurGoogle(null)
    }
  }

  function cliquer(cible: string) {
    const action = actionSurLigne({ ouverte, cible, modifie })
    if (action === "confirmer") {
      setAConfirmer(cible)
      return
    }
    appliquer(action, cible)
  }

  async function ecrirePixel(champ: "metaPixelId" | "googleTagId", valeur: string | null) {
    const lequel = champ === "metaPixelId" ? "meta" : "google"
    const setErreur = lequel === "meta" ? setErreurMeta : setErreurGoogle
    setBusy(lequel)
    setErreur(null)
    try {
      await onSavePixel({ [champ]: valeur })
      if (valeur === null) {
        if (lequel === "meta") setBrouillonMeta("")
        else setBrouillonGoogle("")
      }
      setOuverte(null)
    } catch (err) {
      setErreur(describeSettingsError(err))
    } finally {
      setBusy("repos")
    }
  }

  async function retirerDataForSeo() {
    setBusy("retrait")
    try {
      await onClearSecret("DATAFORSEO_LOGIN")
      await onClearSecret("DATAFORSEO_PASSWORD")
      setRetraitDataForSeo(false)
      setOuverte(null)
    } finally {
      setBusy("repos")
    }
  }

  return (
    <SettingsGroup>
      <ul className="divide-y divide-foreground/10">
        <LigneDataForSeo
          secrets={bloc}
          configure={estDataForSeoConfigure(bloc.etats)}
          ouvert={ouverte === "dataforseo"}
          canWrite={canWrite}
          onToggle={() => cliquer("dataforseo")}
          onModifie={() => setSecretsModifies(true)}
          onDemanderRetrait={() => setRetraitDataForSeo(true)}
          retraitEnCours={busy === "retrait"}
        />
        <SerpLieuSelect
          canWrite={canWrite}
          serpLocationCode={serpLocationCode}
          serpLanguageCode={serpLanguageCode}
          onSave={onSaveSerp}
        />
        {([
          ["meta", "Pixel Meta", metaPixelId, brouillonMeta, setBrouillonMeta, "123456789012345", erreurMeta, "metaPixelId"],
          ["google", "Google Ads", googleTagId, brouillonGoogle, setBrouillonGoogle, "AW-… / G-…", erreurGoogle, "googleTagId"],
        ] as const).map(([id, titre, valeur, brouillon, setBrouillon, placeholder, erreur, champ]) => (
          <LignePixel
            key={id}
            id={id}
            titre={titre}
            valeur={valeur}
            brouillon={brouillon}
            onBrouillon={setBrouillon}
            placeholder={placeholder}
            erreur={erreur}
            ouvert={ouverte === id}
            canWrite={canWrite}
            onToggle={() => cliquer(id)}
            onEnregistrer={() => void ecrirePixel(champ, brouillon.trim())}
            onRetirer={() => void ecrirePixel(champ, null)}
            enregistrement={busy === id}
          />
        ))}
      </ul>
      <DialogueConfirmation
        open={aConfirmer !== null}
        title="Modifications non enregistrées"
        body="Cette ligne n'a pas été enregistrée. Le refermer maintenant perdrait cette modification."
        cancel="Continuer à modifier"
        confirm="Abandonner la modification"
        onCancel={() => setAConfirmer(null)}
        onConfirm={() => {
          const cible = aConfirmer
          setAConfirmer(null)
          if (cible === null) return
          appliquer(actionSurLigne({ ouverte, cible, modifie: false }), cible)
        }}
      />
      <DialogueConfirmation
        open={retraitDataForSeo}
        title="Retirer DataForSEO"
        body="Ces identifiants ne serviront plus. Le site public ne casse pas."
        cancel="Annuler"
        confirm="Retirer"
        busy={busy === "retrait"}
        onCancel={() => setRetraitDataForSeo(false)}
        onConfirm={() => void retirerDataForSeo()}
      />
    </SettingsGroup>
  )
}
