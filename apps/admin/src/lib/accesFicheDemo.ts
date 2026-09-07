export function accesFicheDemo(input: {
  role: string
  isOwn: boolean
  published: boolean
  isDemo: boolean
}): {
  canPersist: boolean
  canTry: boolean
  canPublish: boolean
  canDelete: boolean
} {
  const staff = input.role === "owner" || input.role === "admin"
  const canPersist = staff || (input.isOwn && !input.published)
  return {
    canPersist,
    canTry: canPersist || input.isDemo,
    canPublish: staff && !input.isDemo,
    canDelete: input.isDemo
      ? input.isOwn && !input.published
      : staff || input.isOwn,
  }
}
