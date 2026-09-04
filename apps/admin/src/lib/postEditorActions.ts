export function postEditorActions(input: {
  status: "draft" | "published"
  hasUnpublishedChanges: boolean
  canPublish: boolean
  canWrite: boolean
}): { showPublish: boolean; showDiscard: boolean; showUnpublish: boolean } {
  const published = input.status === "published"
  return {
    showPublish: input.canPublish && (!published || input.hasUnpublishedChanges),
    showDiscard: input.canWrite && published && input.hasUnpublishedChanges,
    showUnpublish: input.canPublish && published,
  }
}
