import { Field, FieldLabel } from "@/components/ui/field"
import {
  DEFAULT_SERP_LANGUAGE_CODE,
  DEFAULT_SERP_LOCATION_CODE,
  SERP_LIEUX,
} from "@astrotan/backend/convex/lib/serpLocale"

function lieuKey(locationCode: number, languageCode: string): string {
  return `${languageCode}-${locationCode}`
}

function selectedKey(
  locationCode: number | null,
  languageCode: string | null,
): string {
  const code = locationCode ?? DEFAULT_SERP_LOCATION_CODE
  const known = SERP_LIEUX.some((lieu) => lieu.locationCode === code)
  if (!known) return lieuKey(DEFAULT_SERP_LOCATION_CODE, DEFAULT_SERP_LANGUAGE_CODE)
  return lieuKey(code, languageCode ?? DEFAULT_SERP_LANGUAGE_CODE)
}

export function SerpLieuSelect({
  canWrite,
  serpLocationCode,
  serpLanguageCode,
  onSave,
}: {
  canWrite: boolean
  serpLocationCode: number | null
  serpLanguageCode: string | null
  onSave: (patch: {
    serpLocationCode: number
    serpLanguageCode: string
  }) => Promise<unknown>
}) {
  const value = selectedKey(serpLocationCode, serpLanguageCode)
  const pays = SERP_LIEUX.filter((lieu) => lieu.kind === "country")
  const villes = SERP_LIEUX.filter((lieu) => lieu.kind === "city")

  // Un `Field` nu, sans conteneur ni gap à lui : c'est le GROUPE qui porte
  // la carte et le titre (`settings-seo-pixel.tsx`). Il rendait un `<li
  // className="flex flex-col gap-6">`, hérité d'une liste à filets qui
  // n'existe plus, et ces 24 px étaient plus larges que ce qui sépare deux
  // groupes entiers ailleurs dans les réglages.
  return (
    <Field>
      <FieldLabel htmlFor="serp-lieu">Lieu SERP</FieldLabel>
      {/* Un `<select>` natif, pour ses `<optgroup>` — mais habillé des
          mêmes jetons qu'un `Input` : même hauteur, même rayon, même
          anneau de focus. Sans quoi le seul contrôle non-shadcn de la page
          était aussi le seul sans focus visible. */}
      <select
        id="serp-lieu"
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
        data-location={serpLocationCode ?? DEFAULT_SERP_LOCATION_CODE}
        data-language={serpLanguageCode ?? DEFAULT_SERP_LANGUAGE_CODE}
        value={value}
        disabled={!canWrite}
        onChange={(event) => {
          const choix = SERP_LIEUX.find(
            (lieu) =>
              lieuKey(lieu.locationCode, lieu.languageCode) === event.target.value,
          )
          if (choix === undefined) return
          void onSave({
            serpLocationCode: choix.locationCode,
            serpLanguageCode: choix.languageCode,
          })
        }}
      >
        <optgroup label="Pays">
          {pays.map((lieu) => (
            <option
              key={lieu.locationCode}
              value={lieuKey(lieu.locationCode, lieu.languageCode)}
            >
              {lieu.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Villes">
          {villes.map((lieu) => (
            <option
              key={lieu.locationCode}
              value={lieuKey(lieu.locationCode, lieu.languageCode)}
            >
              {lieu.label}
            </option>
          ))}
        </optgroup>
      </select>
    </Field>
  )
}
