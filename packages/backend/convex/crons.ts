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

crons.interval("demo-restore", { hours: 1 }, internal.demo.restaurer)

// La purge des données arrivées au terme de leur conservation — le seul
// endroit du dépôt qui APPLIQUE une durée. Les durées elles-mêmes, et le
// raisonnement qui les fixe, sont dans `retention.ts` ; ici il n'y a que le
// planning.
//
// Mensuel, pas quotidien : la granularité utile est celle de la promesse
// publiée (« 3 ans »), et un passage par mois suffit largement à la tenir —
// un délai de conservation dépassé de trois semaines sur trois ans n'est
// pas ce qu'un contrôle relève, une durée que RIEN n'applique l'est.
// `retention.purge` se replanifie d'elle-même tant qu'un lot est plein
// (voir `RETENTION_BATCH_SIZE`), donc un retard accumulé se résorbe dans le
// passage du mois, pas en autant de mois qu'il y a de lots.
//
// 3 h 15 UTC le 1er : à l'écart de l'heure ronde, où se bousculent les
// tâches planifiées de tout le monde.
crons.monthly(
  "retention-purge",
  { day: 1, hourUTC: 3, minuteUTC: 15 },
  internal.retention.purge,
)

crons.weekly(
  "seo-weekly",
  { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 15 },
  internal.seoRanks.refreshWeekly,
)

export default crons
