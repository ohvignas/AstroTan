import { getFunctionName } from "convex/server"
import { expect, test } from "vitest"
import crons from "./crons"
import { internal } from "./_generated/api"

// Design spec §6.2, step 4, verbatim: "Un cron
// crons.interval("revalidate-sweep", { seconds: 60 },
// internal.revalidate.drain) rattrape toute action perdue." This is the
// safety net behind the fast path `publishPage` schedules directly
// (`pages.publishPage.test.ts`) — without it, a lost `runAfter(0)` job
// (Convex does not retry scheduled actions) would leave a "published"
// page stuck exactly as long as its outbox row sits unclaimed.

test("un unique cron 'revalidate-sweep' tourne toutes les 60 secondes et appelle internal.revalidate.drain", () => {
  const jobs = Object.entries(crons.crons)
  expect(jobs).toHaveLength(1)

  const [identifier, job] = jobs[0] as [string, (typeof crons.crons)[string]]
  expect(identifier).toBe("revalidate-sweep")
  expect(job.schedule).toEqual({ type: "interval", seconds: 60 })
  expect(job.name).toBe(getFunctionName(internal.revalidate.drain))
})
