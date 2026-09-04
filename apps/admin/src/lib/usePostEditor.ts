import { useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { SeoGeoDraft } from "@astrotan/backend/convex/lib/seoGeoDraft"
import {
  autoFieldsOf,
  describePostError,
  initialValues,
  type PostDoc,
  type PostFormValues,
  type Profile,
} from "@/lib/postForm"
import { postEditorActions } from "@/lib/postEditorActions"

export function usePostEditor(post: PostDoc, profile: Profile) {
  const generateSeoGeo = useAction(api.ai.generateSeoGeo)
  const generatePostCover = useAction(api.aiImage.generatePostCover)
  const updatePost = useMutation(api.posts.update)
  const removePost = useMutation(api.posts.remove)
  const publishPost = useMutation(api.posts.publishPost)
  const unpublishPost = useMutation(api.posts.unpublishPost)
  const discardWorkingCopy = useMutation(api.posts.discardWorkingCopy)
  const mintPreviewToken = useMutation(api.posts.mintPostPreviewToken)
  const retryPropagation = useMutation(api.posts.retryPropagation)
  const publicationStatus = useQuery(api.posts.publicationStatus, {
    id: post._id,
  })

  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingCover, setGeneratingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const requestSave = useRef<(() => void) | null>(null)

  async function persist(
    values: PostFormValues,
    options: { withSlug: boolean },
  ) {
    await updatePost({
      id: post._id,
      ...(options.withSlug ? { slug: values.slug } : {}),
      ...autoFieldsOf(values, { ogImageId: post.seo?.ogImageId }),
    })
  }

  const form = useForm({
    defaultValues: initialValues(post),
  })

  const isOwn = post.createdBy === profile.authUserId
  const canWrite = profile.role !== "editor" || isOwn
  const canPublish = profile.role === "owner" || profile.role === "admin"
  const canRetryPropagation = canPublish || isOwn
  const actions = postEditorActions({
    status: post.status,
    hasUnpublishedChanges: post.hasUnpublishedChanges === true,
    canPublish,
    canWrite,
  })

  async function runAction(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(describePostError(err))
    } finally {
      setBusy(false)
    }
  }

  function applyDraft(draft: SeoGeoDraft) {
    form.setFieldValue("seoTitle", draft.seo.title)
    form.setFieldValue("seoDescription", draft.seo.description)
    form.setFieldValue("geoSummary", draft.geo.summary)
    form.setFieldValue("geoEntities", draft.geo.entities.join(", "))
    form.setFieldValue("geoFaq", draft.geo.faq)
    form.setFieldValue("geoNoai", draft.geo.noai)
    if (draft.excerpt !== undefined && draft.excerpt.length > 0) {
      form.setFieldValue("excerpt", draft.excerpt)
    }
  }

  return {
    form,
    requestSave,
    persist,
    publicationStatus,
    busy,
    generating,
    generatingCover,
    error,
    previewUrl,
    isOwn,
    canWrite,
    canPublish,
    canRetryPropagation,
    actions,
    handlePublish: () => runAction(async () => {
      await publishPost({ id: post._id })
    }),
    handleUnpublish: () => runAction(async () => {
      await unpublishPost({ id: post._id })
    }),
    handleDiscard: () =>
      runAction(async () => {
        form.reset(initialValues(await discardWorkingCopy({ id: post._id })))
      }),
    handleRetry: () => retryPropagation({ id: post._id }),
    async handlePreview() {
      setError(null)
      setBusy(true)
      try {
        const base = import.meta.env.VITE_WEB_SITE_URL as string | undefined
        if (!base) {
          setError("VITE_WEB_SITE_URL n'est pas configuré côté admin.")
          return
        }
        const { token, slug } = await mintPreviewToken({ id: post._id })
        const url = `${base}/blog/${slug}?t=${encodeURIComponent(token)}`
        setPreviewUrl(url)
        window.open(url, "_blank", "noopener,noreferrer")
      } catch (err) {
        setError(describePostError(err))
      } finally {
        setBusy(false)
      }
    },
    async handleDelete() {
      setError(null)
      setBusy(true)
      try {
        await removePost({ id: post._id })
        window.location.assign("/posts")
      } catch (err) {
        setError(describePostError(err))
        setBusy(false)
      }
    },
    async handleGenerateCover(extraInstructions?: string) {
      setError(null)
      setGeneratingCover(true)
      try {
        const result = await generatePostCover({
          postId: post._id,
          extraInstructions,
        })
        form.setFieldValue("coverId", result.storageId)
      } catch (err) {
        setError(describePostError(err))
      } finally {
        setGeneratingCover(false)
      }
    },
    async handleGenerate(extraInstructions?: string) {
      setError(null)
      setGenerating(true)
      try {
        applyDraft(await generateSeoGeo({ postId: post._id, extraInstructions }))
      } catch (err) {
        setError(describePostError(err))
      } finally {
        setGenerating(false)
      }
    },
  }
}
