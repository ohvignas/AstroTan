import { useEffect } from "react"
import { describeContentProblem } from "@/lib/contentGuards"
import {
  autoFieldsOf,
  describePostError,
  type PostFormValues,
} from "@/lib/postForm"
import { SaveBar, useAutoSave } from "@/components/save-bar"

export function PostSaveBar({
  values,
  persist,
  onRequestSave,
}: {
  values: PostFormValues
  persist: (
    values: PostFormValues,
    options: { withSlug: boolean },
  ) => Promise<void>
  onRequestSave: { current: (() => void) | null }
}) {
  const autoSave = useAutoSave({
    enabled: true,
    auto: autoFieldsOf(values),
    manual: { slug: values.slug },
    saveAuto: async () => {
      await persist(values, { withSlug: false })
    },
    saveAll: async () => {
      await persist(values, { withSlug: true })
    },
    validate: ({ auto }) =>
      describeContentProblem({
        title: auto.title,
        entities: auto.geo.entities,
        faq: auto.geo.faq,
      }),
    describeError: describePostError,
  })

  useEffect(() => {
    onRequestSave.current = autoSave.saveNow
    return () => {
      onRequestSave.current = null
    }
  }, [onRequestSave, autoSave.saveNow])

  return (
    <SaveBar
      status={autoSave.status}
      lastSavedAt={autoSave.lastSavedAt}
      error={autoSave.error}
      canSave={autoSave.canSave}
      onSave={autoSave.saveNow}
    />
  )
}
