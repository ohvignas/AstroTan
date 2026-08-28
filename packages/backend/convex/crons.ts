import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

// Design spec §6.2, step 4, verbatim: "Un cron crons.interval(
// 'revalidate-sweep', { seconds: 60 }, internal.revalidate.drain)
// rattrape toute action perdue." `pages.publishPage` already schedules
// `drain` immediately for the fast path (`convex/revalidate.ts`'s own
// header comment) — this cron exists for the case that scheduled call
// itself never runs to completion (Convex does not retry scheduled
// actions), or for any `revalidationOutbox` row that somehow ends up
// `pending` and due without ever having been scheduled at all: claiming
// is a query on `status`/`nextAttemptAt` (`revalidate.ts`'s
// `listDueRows`), not tied to which invocation is calling `drain`, so a
// sweep 60 seconds later finds the same rows a lost fast-path call would
// have.
const crons = cronJobs()

crons.interval("revalidate-sweep", { seconds: 60 }, internal.revalidate.drain)

export default crons
