import type {
  ContentField,
  PageContentDefinition,
} from "@astrotan/backend/convex/siteContent"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { RotateCcwIcon } from "lucide-react"

// The form is generated from the page's declared fields — never from the
// stored values, and never hand-written per page. That is what keeps the
// dashboard honest: a text the design does not expose cannot appear here,
// and a text it does expose cannot be forgotten here.

function groupFields(fields: ContentField[]): [string, ContentField[]][] {
  // Declaration order, not alphabetical: the field list follows the page
  // top to bottom, and reading the form should feel like reading the page.
  const groups = new Map<string, ContentField[]>()
  for (const field of fields) {
    const existing = groups.get(field.group)
    if (existing) existing.push(field)
    else groups.set(field.group, [field])
  }
  return [...groups.entries()]
}

export function PageContentForm({
  definition,
  values,
  disabled,
  onChange,
}: {
  definition: PageContentDefinition
  /** Only the keys actually saved. An absent key means "still the default". */
  values: Record<string, string>
  disabled: boolean
  onChange: (values: Record<string, string>) => void
}) {
  function setField(key: string, value: string) {
    onChange({ ...values, [key]: value })
  }

  function resetField(key: string) {
    // Deletes the key rather than writing the fallback into it. The two
    // look identical on the page, but only the deletion keeps following
    // the design: if the fallback text later changes in `siteContent.ts`,
    // a page that never overrode it should follow, and a page that copied
    // it into the database silently would not.
    const next = { ...values }
    delete next[key]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-8">
      {groupFields(definition.fields).map(([group, fields]) => (
        <section key={group} className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-muted-foreground">{group}</h3>
          {fields.map((field) => {
            const overridden = values[field.key] !== undefined
            const value = values[field.key] ?? ""
            const shared = {
              id: `content-${field.key}`,
              value,
              disabled,
              maxLength: field.max,
              // The declared text, shown as a placeholder rather than
              // prefilled: an operator can see what the page says today and
              // still tell at a glance that they have not changed it.
              placeholder: field.fallback,
              onChange: (
                event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
              ) => setField(field.key, event.target.value),
            }

            return (
              <Field key={field.key} className="min-w-0">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <FieldLabel htmlFor={shared.id}>{field.label}</FieldLabel>
                  {overridden && !disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-my-1 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                      onClick={() => resetField(field.key)}
                    >
                      <RotateCcwIcon aria-hidden className="size-3.5" />
                      Rétablir
                    </Button>
                  )}
                </div>
                {field.type === "line" ? (
                  <Input {...shared} />
                ) : (
                  <Textarea {...shared} className="min-h-20" />
                )}
                {(field.hint || field.type === "rich") && (
                  <FieldDescription>
                    {field.hint ??
                      "Gras et liens autorisés : **texte**, [libellé](https://…)."}
                  </FieldDescription>
                )}
              </Field>
            )
          })}
        </section>
      ))}
    </div>
  )
}
