import { MAX_POST_BODY_LENGTH } from "@astrotan/backend/convex/content"
import type { FieldOf, PostDoc, PostFormApi } from "@/lib/postForm"
import type { CoachFields } from "@/components/post-coach-panel"
import { PostCoachPanel } from "@/components/post-coach-panel"
import { RichTextEditor } from "@/components/rich-text-editor"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription } from "@/components/ui/field"

export function PostBodyCard({
  form,
  post,
  canWrite,
}: {
  form: PostFormApi
  post: PostDoc
  canWrite: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contenu</CardTitle>
      </CardHeader>
      <CardContent className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <form.Field
          name="body"
          children={(field: FieldOf<"body">) => (
            <Field>
              <RichTextEditor
                id={field.name}
                value={field.state.value}
                maxLength={MAX_POST_BODY_LENGTH}
                disabled={!canWrite}
                onChange={field.handleChange}
              />
              <FieldDescription>
                Mise en forme par la barre d&apos;outils. Le bouton{" "}
                <code>&lt;/&gt;</code> montre le HTML tel qu&apos;il est stocké,
                et permet de le corriger à la main.
              </FieldDescription>
            </Field>
          )}
        />
        <form.Subscribe
          selector={(state: { values: CoachFields }) => ({
            title: state.values.title,
            excerpt: state.values.excerpt,
            body: state.values.body,
            targetKeyword: state.values.targetKeyword,
            seoTitle: state.values.seoTitle,
            seoDescription: state.values.seoDescription,
            slug: state.values.slug,
            geoSummary: state.values.geoSummary,
            geoEntities: state.values.geoEntities,
            geoFaq: state.values.geoFaq,
            geoNoai: state.values.geoNoai,
          })}
          children={(fields: CoachFields) => (
            <PostCoachPanel
              fields={fields}
              postId={post._id}
              path={`/blog/${post.slug}`}
              publishedAt={post.publishedAt}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}
