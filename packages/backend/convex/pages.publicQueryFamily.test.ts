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
      blocks: [],
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )

  let checked = 0
  for (const q of publicFamily) {
    const fn = (api as unknown as Record<string, Record<string, unknown>>)[q.file]?.[q.name]
    if (!fn) throw new Error(`no api.${q.file}.${q.name} reference — is the module path right?`)

    let args: Record<string, unknown>
    if (q.argFields.length === 0) {
      args = {}
    } else if (q.argFields.length === 1 && q.argFields[0] === "slug") {
      args = { slug: "brouillon-confidentiel" }
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
    } catch {
      continue
    }
    checked += 1
    assertNoDraftLeak(result, draftId, `${q.file}.${q.name}`)
  }

  expect(checked).toBeGreaterThan(0)
})
