import { createFileRoute, Link } from "@tanstack/react-router"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { useQuery } from "convex/react"
import { usePostEditor } from "@/lib/usePostEditor"
import { GenerateSeoGeoButton } from "@/components/generate-seo-geo-button"
import { PageAnalytics } from "@/components/analytics-panel"
import { PostBodyCard } from "@/components/post-body-card"
import { PostEditorHeader } from "@/components/post-editor-header"
import { PostIdentityCard } from "@/components/post-identity-card"
import { PostSaveBar } from "@/components/post-save-bar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PostDoc, PostFormValues, Profile } from "@/lib/postForm"

export const Route = createFileRoute("/_authed/posts/$postId")({
  component: PostEditorPage,
})

function PostEditorPage() {
  const { postId } = Route.useParams()
  const profile = useQuery(api.profiles.me)
  const post = useQuery(api.posts.get, { id: postId as Id<"posts"> })

  if (profile === undefined || post === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }
  if (post === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Article introuvable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Link to="/posts" className="underline">
            Retour à la liste des articles
          </Link>
        </CardContent>
      </Card>
    )
  }
  return <PostEditor post={post} profile={profile} />
}

function PostEditor({ post, profile }: { post: PostDoc; profile: Profile }) {
  const editor = usePostEditor(post, profile)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        editor.requestSave.current?.()
      }}
    >
      <PostEditorHeader
        title={post.title}
        slug={post.slug}
        status={post.status}
        publicationStatus={editor.publicationStatus}
        actions={editor.actions}
        busy={editor.busy}
        canDelete={editor.canPublish || editor.isOwn}
        canRetryPropagation={editor.canRetryPropagation}
        onPreview={() => void editor.handlePreview()}
        onPublish={() => void editor.handlePublish()}
        onDiscard={() => void editor.handleDiscard()}
        onUnpublish={() => void editor.handleUnpublish()}
        onRetry={() => void editor.handleRetry()}
        onDelete={() => void editor.handleDelete()}
      />

      {!editor.canWrite && (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Cet article appartient à un autre utilisateur : vous pouvez le
          consulter, pas le modifier.
        </p>
      )}
      {editor.error && (
        <p role="alert" className="text-sm text-destructive">
          {editor.error}
        </p>
      )}
      {editor.previewUrl && (
        <p className="text-xs text-muted-foreground">
          Le lien de prévisualisation expire dans 15 minutes.{" "}
          <a
            href={editor.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Rouvrir
          </a>
        </p>
      )}

      <PageAnalytics
        path={`/blog/${post.slug}`}
        kind="post"
        postId={post._id}
      />

      <PostIdentityCard
        form={editor.form}
        canWrite={editor.canWrite}
        generatingCover={editor.generatingCover}
        titlePlaceholder={post.title}
        generateAction={
          editor.canWrite ? (
            <GenerateSeoGeoButton
              disabled={!editor.canWrite}
              busy={editor.generating}
              onGenerate={(extra) => void editor.handleGenerate(extra)}
            />
          ) : undefined
        }
        onGenerateCover={(extra) => void editor.handleGenerateCover(extra)}
      />

      <PostBodyCard
        form={editor.form}
        post={post}
        canWrite={editor.canWrite}
      />

      {editor.canWrite && (
        <editor.form.Subscribe
          selector={(state: { values: PostFormValues }) => state.values}
          children={(values: PostFormValues) => (
            <PostSaveBar
              values={values}
              persist={editor.persist}
              onRequestSave={editor.requestSave}
            />
          )}
        />
      )}
    </form>
  )
}
