import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PlusIcon, Trash2Icon } from "lucide-react"

// A bounded, ordered list of rows whose every field is a bounded string —
// the page editor's `geo.faq` ({question, answer}) and the settings
// screen's `socials` ({label, url}) are the same widget with different
// field names, labels and limits.
//
// It lived inside `routes/_authed/pages/$pageId.tsx` until the settings
// screen needed it too. Moved here rather than imported from that route:
// a route module is code-split by `@tanstack/router-plugin`, and reaching
// into one for a component is how two copies of the same tree end up in
// the bundle.

function LabeledInput({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        maxLength={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function LabeledTextarea({
  label,
  value,
  max,
  disabled,
  rows,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  rows?: number
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        value={value}
        maxLength={max}
        disabled={disabled}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

/**
 * `disabled` covers both refusals this widget has to express, and they are
 * deliberately not distinguished: a reader who may not edit at all, and an
 * editor who has reached the list's maximum. Either way there is nothing
 * to add and nothing to remove, so the same flag hides the same controls.
 * The *count* bound is re-checked in the mutation regardless — this only
 * stops an operator building a row that was going to be refused.
 */
export function RepeatableItems<T extends Record<string, string>>({
  items,
  disabled,
  addLabel,
  emptyItem,
  fields,
  onChange,
}: {
  items: T[]
  disabled: boolean
  addLabel: string
  emptyItem: T
  fields: { key: keyof T; label: string; max: number; multiline?: boolean }[]
  onChange: (items: T[]) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun élément pour le moment.
        </p>
      )}
      {items.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-lg border border-dashed border-input p-2.5"
        >
          {fields.map((field) =>
            field.multiline ? (
              <LabeledTextarea
                key={String(field.key)}
                label={field.label}
                // `T extends Record<string, string>` guarantees every
                // value is a real string — `noUncheckedIndexedAccess`
                // still widens a *generic* key's indexed access to
                // `| undefined`, a known TS limitation around index
                // signatures rather than a real possibility here.
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            ) : (
              <LabeledInput
                key={String(field.key)}
                label={field.label}
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            )
          )}
          {!disabled && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2Icon data-icon="inline-start" />
                Retirer
              </Button>
            </div>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, emptyItem])}
        >
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
      )}
    </div>
  )
}
