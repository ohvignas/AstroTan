import { useState } from "react"
import { ChampPixel, GroupeDataForSeo } from "@/components/seo-pixel-ligne"
import { SerpLieuSelect } from "@/components/serp-lieu-select"
import { SettingsGroup } from "@/components/settings-nav"
import type { SecretsBloc } from "@/components/settings-environment"
import { describeSettingsError } from "@/lib/settingsErrors"
import type { DataForSeoIssue } from "@astrotan/backend/convex/lib/dataforseo"

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

type PixelPatch = {
  metaPixelId?: string | null
  googleTagId?: string | null
  googleConversionLabel?: string | null
}

// SEO & Pixel : trois groupes qui s'enregistrent chacun de leur côté
// (DataForSEO, lieu SERP, pixels). Les pixels sont trois champs de même
// nature, grille `sm:grid-cols-2` comme Logo / Icône sur Identité.

export function SeoPixelPage({
  canWrite,
  secrets,
  dataForSeo,
  metaPixelId,
  googleTagId,
  googleConversionLabel,
  serpLocationCode,
  serpLanguageCode,
  onSaveDataForSeo,
  onClearSecret,
  onSavePixel,
  onSaveSerp,
}: {
  canWrite: boolean
  secrets: SecretsBloc
  /** Le login relu en clair, et si un mot de passe est rangé. */
  dataForSeo: { login: string | null; passwordPose: boolean } | undefined
  metaPixelId: string | null
  googleTagId: string | null
  googleConversionLabel: string | null
  serpLocationCode: number | null
  serpLanguageCode: string | null
  onSaveDataForSeo: (login: string, password: string) => Promise<{ verdict: DataForSeoIssue }>
  onClearSecret: (nom: string) => Promise<void>
  onSavePixel: (patch: PixelPatch) => Promise<unknown>
  onSaveSerp: (patch: {
    serpLocationCode: number
    serpLanguageCode: string
  }) => Promise<unknown>
}) {
  const [brouillonMeta, setBrouillonMeta] = useState(metaPixelId ?? "")
  const [brouillonGoogle, setBrouillonGoogle] = useState(googleTagId ?? "")
  const [brouillonLabel, setBrouillonLabel] = useState(googleConversionLabel ?? "")
  const [erreurMeta, setErreurMeta] = useState<string | null>(null)
  const [erreurGoogle, setErreurGoogle] = useState<string | null>(null)
  const [erreurLabel, setErreurLabel] = useState<string | null>(null)
  const [busy, setBusy] = useState<"repos" | "meta" | "google" | "label">("repos")

  async function ecrirePixel(
    champ: "metaPixelId" | "googleTagId" | "googleConversionLabel",
    valeur: string | null,
  ) {
    const lequel =
      champ === "metaPixelId" ? "meta" : champ === "googleTagId" ? "google" : "label"
    const setErreur =
      lequel === "meta" ? setErreurMeta : lequel === "google" ? setErreurGoogle : setErreurLabel
    setBusy(lequel)
    setErreur(null)
    try {
      await onSavePixel({ [champ]: valeur })
      if (valeur === null) {
        if (lequel === "meta") setBrouillonMeta("")
        else if (lequel === "google") setBrouillonGoogle("")
        else setBrouillonLabel("")
      }
    } catch (err) {
      setErreur(describeSettingsError(err))
    } finally {
      setBusy("repos")
    }
  }

  // Un objet par pixel plutôt que des tuples `as const` de huit éléments :
  // les deux lignes faisaient chacune plus de deux cents caractères, et
  // l'ordre des positions était le seul lien entre une valeur et son
  // champ.
  const pixels = [
    {
      id: "meta",
      champ: "metaPixelId" as const,
      titre: "Pixel Meta",
      aide: "L'ID du pixel, dans le gestionnaire d'événements Meta.",
      placeholder: "123456789012345",
      valeur: metaPixelId,
      brouillon: brouillonMeta,
      onBrouillon: setBrouillonMeta,
      erreur: erreurMeta,
    },
    {
      id: "google",
      champ: "googleTagId" as const,
      titre: "Google Ads",
      aide: "L'ID de balise. Un AW- sert les campagnes Ads ; un G- ne mesure que dans Analytics.",
      placeholder: "AW-… / G-…",
      valeur: googleTagId,
      brouillon: brouillonGoogle,
      onBrouillon: setBrouillonGoogle,
      erreur: erreurGoogle,
    },
    {
      id: "label",
      champ: "googleConversionLabel" as const,
      titre: "Label de conversion Ads",
      aide: "Dans Google Ads → Objectifs, le suffixe après AW-XXXX/. Sans lui, les pages vues partent, pas les leads.",
      placeholder: "AbC-D_efG",
      valeur: googleConversionLabel,
      brouillon: brouillonLabel,
      onBrouillon: setBrouillonLabel,
      erreur: erreurLabel,
    },
  ]

  return (
    <>
      <GroupeDataForSeo
        secrets={secrets}
        configure={estDataForSeoConfigure(secrets.etats)}
        canWrite={canWrite}
        identifiants={dataForSeo}
        onEnregistrer={onSaveDataForSeo}
        onEffacer={async () => {
          await onClearSecret("DATAFORSEO_LOGIN")
          await onClearSecret("DATAFORSEO_PASSWORD")
        }}
      />

      <SettingsGroup
        title="Relevé de positions"
        description="D'où les positions sont relevées. Enregistré dès le choix, sans passer par la barre en bas d'écran : c'est une autre mutation que les identifiants ci-dessus."
      >
        <SerpLieuSelect
          canWrite={canWrite}
          serpLocationCode={serpLocationCode}
          serpLanguageCode={serpLanguageCode}
          onSave={onSaveSerp}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Pixels publicitaires"
        description="Aucune balise n'entre dans le HTML du site avant une réponse au bandeau de consentement. Un ID saisi ici l'emporte sur celui figé au build de l'image ; le retirer rend la main à ce dernier."
      >
        {/* Deux choses de même nature, donc côte à côte au-delà de
            `sm` et empilées en dessous — le gabarit « Logo / Icône »
            d'Identité, au même `gap-4`. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {pixels.map((pixel) => (
            <ChampPixel
              key={pixel.id}
              id={pixel.id}
              titre={pixel.titre}
              aide={pixel.aide}
              valeur={pixel.valeur}
              brouillon={pixel.brouillon}
              onBrouillon={pixel.onBrouillon}
              placeholder={pixel.placeholder}
              erreur={pixel.erreur}
              canWrite={canWrite}
              onEnregistrer={() => void ecrirePixel(pixel.champ, pixel.brouillon.trim())}
              onRetirer={() => void ecrirePixel(pixel.champ, null)}
              enregistrement={busy === pixel.id}
            />
          ))}
        </div>
      </SettingsGroup>
    </>
  )
}
