export const RELEVER_THROTTLE_MS = 60 * 60 * 1000

export type RankRow = {
  keyword: string
  status: "ranked" | "out_of_top_100" | "other_url"
  position?: number
  previousPosition?: number
  rankedUrl?: string
  fetchedAt: number
}

export type RankUiState =
  | { state: "no_keyword" }
  | { state: "dfs_absent" }
  | { state: "never_ranked" }
  | { state: "keyword_changed"; previousKeyword: string }
  | { state: "ranked"; position: number; previousPosition?: number; gap?: number }
  | { state: "out_of_top_100" }
  | { state: "other_url"; rankedUrl: string }

export type DocumentRank = RankUiState & { canRelever: boolean }

export function gapRang(position: number, previous?: number): number | undefined {
  if (previous === undefined) return undefined
  return previous - position
}

export function decideRankState(input: {
  targetKeyword?: string
  dfsConfigured: boolean
  draft: boolean
  row: RankRow | null
}): RankUiState {
  const keyword = input.targetKeyword?.trim() ?? ""
  if (keyword.length === 0) return { state: "no_keyword" }
  if (!input.dfsConfigured) return { state: "dfs_absent" }
  if (input.row === null) return { state: "never_ranked" }
  if (input.row.keyword !== keyword) {
    return { state: "keyword_changed", previousKeyword: input.row.keyword }
  }
  if (input.row.status === "other_url") {
    return { state: "other_url", rankedUrl: input.row.rankedUrl ?? "" }
  }
  if (input.row.status === "out_of_top_100") return { state: "out_of_top_100" }
  const position = input.row.position
  if (position === undefined) return { state: "never_ranked" }
  return {
    state: "ranked",
    position,
    previousPosition: input.row.previousPosition,
    gap: gapRang(position, input.row.previousPosition),
  }
}

export function canRelever(input: {
  state: RankUiState["state"]
  draft: boolean
  fetchedAt?: number
  now: number
}): boolean {
  if (
    input.draft ||
    input.state === "no_keyword" ||
    input.state === "dfs_absent"
  ) {
    return false
  }
  if (input.fetchedAt === undefined) return true
  return input.now - input.fetchedAt >= RELEVER_THROTTLE_MS
}

export function documentRank(input: {
  targetKeyword?: string
  dfsConfigured: boolean
  draft: boolean
  row: RankRow | null
  now: number
}): DocumentRank {
  const state = decideRankState(input)
  return {
    ...state,
    canRelever: canRelever({
      state: state.state,
      draft: input.draft,
      fetchedAt: input.row?.fetchedAt,
      now: input.now,
    }),
  }
}
