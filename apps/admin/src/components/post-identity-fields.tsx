import {
  MAX_EXCERPT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "@astrotan/backend/convex/content"
import type { PostFormApi } from "@/lib/postForm"
import { PostTextField } from "@/components/post-text-field"

export function PostIdentityFields({
  form,
  canWrite,
}: {
  form: PostFormApi
  canWrite: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <PostTextField
        form={form}
        name="title"
        label="Titre (page / H1)"
        maxLength={MAX_PAGE_TITLE_LENGTH}
        disabled={!canWrite}
      />
      <PostTextField
        form={form}
        name="excerpt"
        label="Extrait"
        maxLength={MAX_EXCERPT_LENGTH}
        disabled={!canWrite}
        multiline
        showCount
        helper="Résumé des cartes du blog, pas le texte Google. Laissé vide, le début du corps est utilisé."
      />
      <PostTextField
        form={form}
        name="targetKeyword"
        id="target-keyword"
        label="Mot-clé cible"
        maxLength={MAX_TARGET_KEYWORD_LENGTH}
        disabled={!canWrite}
      />
    </div>
  )
}
