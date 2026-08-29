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
  const job = crons.crons["revalidate-sweep"]
  expect(job).toBeDefined()
  expect(job!.schedule).toEqual({ type: "interval", seconds: 60 })
  expect(job!.name).toBe(getFunctionName(internal.revalidate.drain))
})

// La purge est le SEUL endroit du dépôt où une durée de conservation est
// appliquée. Ce test est ce qui empêche qu'elle disparaisse du planning
// sans que personne ne le voie : une durée annoncée sur
// `/confidentialite` que rien n'exécute est le premier point qu'un
// contrôle vérifie, et il se vérifie en une requête.
test("un cron mensuel 'retention-purge' appelle internal.retention.purge", () => {
  const job = crons.crons["retention-purge"]
  expect(job).toBeDefined()
  expect(job!.schedule).toEqual({
    type: "monthly",
    day: 1,
    hourUTC: 3,
    minuteUTC: 15,
  })
  expect(job!.name).toBe(getFunctionName(internal.retention.purge))
})

test("le planning ne contient que ces deux tâches", () => {
  // Une tâche ajoutée sans test est une tâche que personne ne relit.
  expect(Object.keys(crons.crons).sort()).toEqual([
    "retention-purge",
    "revalidate-sweep",
  ])
})
