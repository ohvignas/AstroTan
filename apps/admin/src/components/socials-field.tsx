import { MAX_SOCIALS, MAX_SOCIAL_URL_LENGTH } from "@astrotan/backend/convex/content"
import {
  availableNetworks,
  hydrateSocials,
  isSocialHttpUrl,
  socialLabel,
  type SocialNetworkId,
  type SocialRow,
} from "@astrotan/backend/convex/lib/socialNetworks"
import { SocialIcon } from "@/components/social-icon"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PlusIcon, Trash2Icon } from "lucide-react"

function toRows(socials: SocialRow[]): SocialRow[] {
  return hydrateSocials(socials).map((row) => ({ label: row.id, url: row.url }))
}

export function SocialsField({
  socials,
  canWrite,
  onChange,
}: {
  socials: SocialRow[]
  canWrite: boolean
  onChange: (socials: SocialRow[]) => void
}) {
  const rows = toRows(socials)
  const remaining = availableNetworks(rows.map((row) => row.label))
  const canAdd = canWrite && remaining.length > 0 && rows.length < MAX_SOCIALS
  const addItems = Object.fromEntries(
    remaining.map((network) => [network.id, network.label]),
  )

  function emit(next: SocialRow[]) {
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun réseau pour le moment.
        </p>
      )}
      {rows.map((row) => {
        const id = row.label as SocialNetworkId
        const invalid = row.url.trim() !== "" && !isSocialHttpUrl(row.url)
        return (
          <Field key={id} data-invalid={invalid}>
            <FieldLabel htmlFor={`social-${id}`}>{socialLabel(id)}</FieldLabel>
            <div className="flex items-center gap-2">
              <SocialIcon id={id} />
              <Input
                id={`social-${id}`}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://"
                value={row.url}
                maxLength={MAX_SOCIAL_URL_LENGTH}
                disabled={!canWrite}
                onChange={(event) =>
                  emit(
                    rows.map((item) =>
                      item.label === id ? { ...item, url: event.target.value } : item,
                    ),
                  )
                }
              />
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => emit(rows.filter((item) => item.label !== id))}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Retirer
                </Button>
              ) : null}
            </div>
            {invalid ? (
              <FieldError>
                Collez l'URL https du profil (http:// ou https://).
              </FieldError>
            ) : null}
          </Field>
        )
      })}
      {canAdd ? (
        <Select
          items={addItems}
          value={null}
          onValueChange={(value: unknown) => {
            if (typeof value !== "string" || value === "") return
            emit([...rows, { label: value, url: "" }])
          }}
        >
          <SelectTrigger className="w-full">
            <PlusIcon data-icon="inline-start" />
            <SelectValue placeholder="Ajouter un réseau" />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((network) => (
              <SelectItem key={network.id} value={network.id}>
                <SocialIcon id={network.id} />
                {network.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}
