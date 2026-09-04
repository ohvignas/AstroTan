import type { ReactNode } from "react"
import type { FieldOf, PostFormApi, PostFormValues } from "@/lib/postForm"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type TextName = {
  [K in keyof PostFormValues]: PostFormValues[K] extends string ? K : never
}[keyof PostFormValues]

export function PostTextField({
  form,
  name,
  label,
  helper,
  maxLength,
  disabled,
  id,
  multiline,
  rows = 3,
  placeholder,
  showCount,
}: {
  form: PostFormApi
  name: TextName
  label: string
  helper?: ReactNode
  maxLength: number
  disabled: boolean
  id?: string
  multiline?: boolean
  rows?: number
  placeholder?: string
  showCount?: boolean
}) {
  return (
    <form.Field
      name={name}
      children={(field: FieldOf<TextName>) => {
        const controlId = id ?? field.name
        return (
          <Field>
            <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
            {multiline ? (
              <Textarea
                id={controlId}
                name={field.name}
                value={field.state.value}
                maxLength={maxLength}
                disabled={disabled}
                rows={rows}
                placeholder={placeholder}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            ) : (
              <Input
                id={controlId}
                name={field.name}
                value={field.state.value}
                maxLength={maxLength}
                disabled={disabled}
                placeholder={placeholder}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
            {(helper || showCount) && (
              <FieldDescription>
                {helper}
                {showCount
                  ? `${helper ? " " : ""}${field.state.value.length}/${maxLength}`
                  : null}
              </FieldDescription>
            )}
          </Field>
        )
      }}
    />
  )
}
