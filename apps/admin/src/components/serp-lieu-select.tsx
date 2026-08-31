import { Field, FieldLabel } from "@/components/ui/field"

const FRANCE = "fr-2250"

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
  const value = FRANCE

  return (
    <li>
      <div className="py-2.5">
        <Field>
          <FieldLabel htmlFor="serp-lieu">Lieu SERP</FieldLabel>
          <select
            id="serp-lieu"
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            data-location={serpLocationCode ?? 2250}
            data-language={serpLanguageCode ?? "fr"}
            value={value}
            disabled={!canWrite}
            onChange={() => {
              void onSave({ serpLocationCode: 2250, serpLanguageCode: "fr" })
            }}
          >
            <option value={FRANCE}>France (Google)</option>
          </select>
        </Field>
      </div>
    </li>
  )
}
