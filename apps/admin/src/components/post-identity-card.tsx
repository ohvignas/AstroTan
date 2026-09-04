import type { ReactNode } from "react"
import type { FieldOf, PostFormApi } from "@/lib/postForm"
import { CoverField } from "@/components/cover-field"
import { PostAdvancedFields } from "@/components/post-advanced-fields"
import { PostIdentityFields } from "@/components/post-identity-fields"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronDownIcon } from "lucide-react"

export function PostIdentityCard({
  form,
  canWrite,
  generatingCover,
  titlePlaceholder,
  generateAction,
  onGenerateCover,
}: {
  form: PostFormApi
  canWrite: boolean
  generatingCover: boolean
  titlePlaceholder: string
  generateAction?: ReactNode
  onGenerateCover: (extraInstructions?: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Article</CardTitle>
        {generateAction ? <CardAction>{generateAction}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)]">
          <PostIdentityFields form={form} canWrite={canWrite} />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Image de couverture</p>
            <p className="text-xs text-muted-foreground">
              Carte du blog et partage social (og:image).
            </p>
            <form.Field
              name="coverId"
              children={(field: FieldOf<"coverId">) => (
                <CoverField
                  value={field.state.value}
                  disabled={!canWrite}
                  generating={generatingCover}
                  compact
                  onChange={field.handleChange}
                  onGenerate={onGenerateCover}
                />
              )}
            />
          </div>
        </div>
        <details className="group/more rounded-lg border border-input">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Plus d’options
            <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-open/more:rotate-180" />
          </summary>
          <div className="border-t border-input px-3 py-3">
            <PostAdvancedFields
              form={form}
              canWrite={canWrite}
              titlePlaceholder={titlePlaceholder}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
