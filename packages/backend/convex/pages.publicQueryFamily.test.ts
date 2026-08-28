import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"

// Step 6 of this task's brief, close to verbatim: "a parameterised test
// over the list of public queries: each one, handed a draft, must return
// nothing. That test is the point of the task — it is the guard that will
// catch the seventh public query someone adds in Lot 3 and forgets to
// filter." A hand-written list of query names would itself be exactly the
// kind of thing that goes stale unnoticed — so *membership* in "the public
// family" is derived here from a structural property of each query's own
// declared arguments, the same way `_registry.test.ts` derives "is this a
// public mutation" from `fn.isMutation && fn.isPublic` rather than from a
// name list.
//
// The discriminant: the public family accepts **no token parameter of any
// kind** (this task's brief, verbatim) and the preview family's whole
// reason to exist is that it does. So "does this public query's own args
// validator declare a `token` field" is not a proxy for family membership
// — restated from pages.ts's own header comment, it *is* the definition
// this codebase uses. A future preview-style query that forgot to name its
// argument `token` would misclassify here — flagged below as this test's
// one acknowledged trade-off, not hidden.

const modules = import.meta.glob("./**/*.ts")

type DiscoveredQuery = { file: string; name: string; argFields: string[] }

// Mirrors `_registry.test.ts`'s own scan of `convex/**/*.ts` — same skip
// list, same reasoning for each entry (see that file's header for the
// full account of why `_generated/`/`betterAuth/`/`convex.config.ts`/
// `http.ts`/`schema.ts` are excluded without reducing coverage) — but
// collecting **public queries** (`fn.isQuery && fn.isPublic`) instead of
// public mutations, and additionally recording each one's declared
// argument field names via `fn.exportArgs()` (the same JSON-serialized
// validator shape Convex itself derives function schemas from), so the
// classification below has something structural to key off.
async function discoverPublicQueries(): Promise<DiscoveredQuery[]> {
  const SKIP_PREFIXES = ["_generated/", "betterAuth/"]
  const SKIP_FILES = new Set(["convex.config.ts", "http.ts"])
  const found: DiscoveredQuery[] = []
  for (const [path, load] of Object.entries(modules)) {
    const rel = path.replace(/^\.\//, "")
    if (rel.endsWith(".test.ts") || SKIP_FILES.has(rel)) continue
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue
    const mod = (await load()) as Record<string, unknown>
    const file = rel.replace(/\.ts$/, "")
    if (file === "schema") continue
    for (const [name, exported] of Object.entries(mod)) {
      const fn = exported as { isQuery?: boolean; isPublic?: boolean; exportArgs?: () => string }
      if (!fn?.isQuery || !fn?.isPublic) continue
      if (typeof fn.exportArgs !== "function") {
        throw new Error(`${file}.${name} is a public query with no exportArgs() — cannot classify it`)
      }
      const argsJson = JSON.parse(fn.exportArgs()) as { type: string; value?: Record<string, unknown> }
      const argFields = argsJson.type === "object" ? Object.keys(argsJson.value ?? {}) : []
      found.push({ file, name, argFields })
    }
  }
  return found
}

function assertNoDraftLeak(result: unknown, draftId: string, label: string) {
  if (result === null || result === undefined) return
  if (Array.isArray(result)) {
    const leaked = result.some((item) => (item as { _id?: unknown })?._id === draftId)
    expect(leaked, `${label} returned the draft page inside a list`).toBe(false)
    return
  }
  if (typeof result === "object" && result !== null && "_id" in (result as Record<string, unknown>)) {
    expect((result as { _id?: unknown })._id, `${label} returned the draft page directly`).not.toBe(
      draftId,
    )
    return
  }
  throw new Error(
    `${label}: unexpected result shape while checking for a draft leak — extend assertNoDraftLeak: ${JSON.stringify(result)}`,
  )
}

test("aucune query publique (sans paramètre token) ne sert un brouillon", async () => {
  const discovered = await discoverPublicQueries()

  const previewFamily = discovered.filter((q) => q.argFields.includes("token"))
  const publicFamily = discovered.filter((q) => !q.argFields.includes("token"))
  const publicNames = publicFamily.map((q) => `${q.file}.${q.name}`)
  const previewNames = previewFamily.map((q) => `${q.file}.${q.name}`)

  // Canary on the classification itself, not just on the loop below: if
  // this ever reports zero public queries at all, or if `previewPage`
  // itself is ever misclassified as public (its own `token` arg dropped,
  // renamed, or made optional in a way `exportArgs()` stops reporting),
  // something upstream is broken and the loop below would otherwise
  // iterate over the wrong set — or zero queries — and report success
  // having tested the wrong thing, or nothing. Not asserting the *full*
  // contents of `previewFamily`: `invitations.preview` also declares a
  // `token` arg (a different, unrelated token — an invitation-acceptance
  // one) and correctly lands here too; this scan's discriminant is
  // deliberately codebase-wide, not page-specific, so any token-gated
  // query is presumed to have its own dedicated revalidation and is out
  // of scope for *this* invariant (which is specifically "no draft page
  // leaks through a query that takes no token").
  expect(previewNames).toContain("pages.previewPage")
  expect(publicNames).not.toContain("pages.previewPage")
  expect(publicFamily.length).toBeGreaterThan(0)

  const t = convexTest(schema, modules)
  const draftId = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "brouillon-confidentiel",
      title: "Brouillon confidentiel",
      status: "draft",
      body: "",
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )

  // M6 (whole-lot review): of the eight public (no-token) queries this
  // scan discovers today, six are session-gated (`requireRole`) and throw
  // for the unauthenticated caller this loop always is — landing in the
  // blanket `catch { continue }` below and never reaching
  // `assertNoDraftLeak` at all. Only these two actually run to
  // completion unauthenticated. `expect(checked).toBeGreaterThan(0)`
  // alone would still pass if one of these two were lost (a regression
  // that made `getPublishedPage` newly session-gated, say) as long as the
  // other kept running — this list is what turns "at least one query was
  // checked" into "specifically the two queries this test actually knows
  // how to exercise unauthenticated were checked."
  const KNOWN_UNGATED_PUBLIC_QUERIES = ["pages.getPublishedPage", "pages.listPublishedPages"]

  let checked = 0
  const checkedNames: string[] = []
  // A skip must be visible, not silent — this task's own brief: "the
  // blanket catch would also silently skip a future unauthenticated
  // query that failed argument validation," indistinguishable from the
  // expected "this query requires a session" case. Recording the error
  // alongside the name (printed below, and inspectable on a failed
  // `checkedNames` assertion via the array's own contents) means a
  // wrongly-skipped query surfaces its actual failure reason instead of
  // just vanishing from the count.
  const skipped: { name: string; error: string }[] = []

  for (const q of publicFamily) {
    const fn = (api as unknown as Record<string, Record<string, unknown>>)[q.file]?.[q.name]
    if (!fn) throw new Error(`no api.${q.file}.${q.name} reference — is the module path right?`)

    let args: Record<string, unknown>
    if (q.argFields.length === 0) {
      args = {}
    } else if (q.argFields.length === 1 && q.argFields[0] === "slug") {
      args = { slug: "brouillon-confidentiel" }
    } else if (q.argFields.length === 1 && q.argFields[0] === "id") {
      // Task 8's `pages.get`/`pages.publicationStatus`: both session-gated
      // (`requireRole`), so calling them with no identity at all (this
      // loop never authenticates, matching `apps/web`, which carries no
      // session — see this test's own header) throws before `args.id` is
      // ever inspected, the same "excluded from the leak check, not
      // silently skipped" path already documented above for
      // session-gated queries in general. `draftId` is reused rather than
      // a second insert, purely so this branch doesn't need its own id.
      args = { id: draftId }
    } else {
      // Not a permissive default (e.g. silently calling with `{}`
      // regardless of shape): a public query whose argument shape this
      // test doesn't yet know how to drive must fail loudly here and
      // force a human to teach it, rather than being silently skipped —
      // silently skipping it would reopen exactly the gap this whole test
      // exists to close. See this file's own header for the acknowledged
      // trade-off this represents.
      throw new Error(
        `public query ${q.file}.${q.name} has an argument shape this test doesn't know how to ` +
          `drive yet: [${q.argFields.join(", ")}]. Teach discoverPublicQueries's caller this shape ` +
          `before trusting this test's coverage of it.`,
      )
    }

    // `fn` is a dynamically-resolved `anyApi` reference (see
    // `discoverPublicQueries`'s header), not a statically-typed
    // `FunctionReference` — `as any` here matches this codebase's own
    // established idiom for exactly this situation (`_registry.test.ts`'s
    // `t.mutation`/`t.query` calls through `MUTATION_REGISTRY.invoke`,
    // typed `(t: any) => ...`, for the identical reason).
    //
    // Called with no identity at all (`t.query`, not `t.withIdentity(...)
    // .query`) — matching `apps/web`, which CLAUDE.md invariant #1 says
    // carries no session. A query that refuses to run for an
    // unauthenticated caller at all (`invitations.list`, `profiles.me`,
    // … — session-gated public queries behind `requireRole`, a wholly
    // different security boundary already covered by
    // `lib/authz.test.ts`'s own matrix) throws here rather than
    // returning; a thrown error has no return value to leak the draft
    // through, so it is excluded from the leak check below, not silently
    // passed — `checked` only counts queries that actually ran to
    // completion, and the canary after this loop fails if that count is
    // ever zero (every discovered "public" query turning out to require a
    // session would make this whole test check nothing, unnoticed,
    // exactly the vacuous-pass shape this task's brief warns about).
    let result: unknown
    try {
      result = await t.query(fn as any, args)
    } catch (err) {
      skipped.push({
        name: `${q.file}.${q.name}`,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    checked += 1
    checkedNames.push(`${q.file}.${q.name}`)
    assertNoDraftLeak(result, draftId, `${q.file}.${q.name}`)
  }

  // Printed unconditionally (not just on failure) — a skip is expected
  // for the six session-gated queries, but "expected" must still mean
  // "visible", not "silent". Anyone reading this test's own output can
  // see exactly which queries were excluded and why, rather than having
  // to trust the blanket catch got it right.
  if (skipped.length > 0) {
    console.info(
      `pages.publicQueryFamily.test.ts: ${skipped.length} public quer${skipped.length === 1 ? "y" : "ies"} excluded from the leak check (threw when called unauthenticated):\n` +
        skipped.map((s) => `  - ${s.name}: ${s.error}`).join("\n"),
    )
  }

  expect(checked).toBeGreaterThan(0)
  // `arrayContaining`, not exact equality: a future Lot that adds another
  // genuinely-ungated public query should extend `checkedNames`, not
  // force an edit here — but losing either of these two specific,
  // already-known-ungated queries must fail this test by name, not just
  // by a falling count some other addition could mask.
  expect(checkedNames).toEqual(expect.arrayContaining(KNOWN_UNGATED_PUBLIC_QUERIES))
})
