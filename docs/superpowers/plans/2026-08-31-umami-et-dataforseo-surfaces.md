# Umami et DataForSEO — fiches et dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatre indicateurs (Umami + rang) sur `$pageId` / `$postId`, pastilles et quatre listes sur l'accueil, cron lundi + bouton Relever — sans aucun appel DataForSEO à l'ouverture d'écran.

**Architecture:** `targetKeyword` frère de `seo` (expand). Trois tables nouvelles (`seoRanks`, `seoSiteKeywords`, `seoSiteBacklinks`). Les queries `seoRanks.forDocument` et `seoRanks.siteSnapshot` lisent la base ; seul `seoRanks.relever` (action manuelle) et `seoRanks.refreshWeekly` (cron) appellent DataForSEO via `lib/dataforseoSerp.ts`. Les secrets restent `lireSecret`. L'UI est une fonction pure de ses props.

**Tech Stack:** Convex (schema expand, actions, cron), TanStack Start / React 19, Umami `/stats?compare=prev`, DataForSEO SERP live + Labs + backlinks overview. Skills `@.claude/skills/convex-function`, `@.claude/skills/consent-rgpd`. Spec [`docs/superpowers/specs/2026-08-31-umami-et-dataforseo-surfaces-design.md`](../specs/2026-08-31-umami-et-dataforseo-surfaces-design.md).

**Spec:** [`docs/superpowers/specs/2026-08-31-umami-et-dataforseo-surfaces-design.md`](../specs/2026-08-31-umami-et-dataforseo-surfaces-design.md)

---

## Contraintes

- TDD. Fichiers nouveaux < 200 lignes. Helpers hors `convex/` si ce sont des fixtures ; helpers purs sous `convex/lib/` (deux points, déjà le cas).
- `requireRole` dans chaque mutation / action / query dashboard. Editor : `requireOwnDocument` sur Relever.
- Jamais d'appel DataForSEO au montage. `PageAnalytics` continue d'appeler `analytics.forPath` seulement.
- Secrets chiffrés, `lireSecret`, aucun mot de passe en argument d'action planifiée.
- `settings.get` ne gagne aucun champ. `targetKeyword` omis des quatre queries publiques / aperçu.
- `consentVersion` inchangé. Aucune ligne `processings`.
- Ne pas lancer `npx convex dev` interactif. `npx convex dev --once` seulement si le codegen doit suivre un schéma.
- Commits Conventional Commits, messages en français (style du dépôt : `feat(backend):`, `feat(admin):`).
- Ne pas committer les diffs déjà sales hors de cette livraison.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/content.ts` | `MAX_TARGET_KEYWORD_LENGTH = 80` + `assertTargetKeyword` |
| `packages/backend/convex/schema.ts:76-134, 306-406` | `targetKeyword` sur `pages`/`posts` ; `serpLocationCode`/`serpLanguageCode` sur `settings` ; tables `seoRanks`, `seoSiteKeywords`, `seoSiteBacklinks` |
| `packages/backend/convex/pages.ts:63-136, 429-512` | `update` accepte `targetKeyword` ; `getPublishedPage` / `previewPage` omettent le champ |
| `packages/backend/convex/posts.ts:195-270, 419-485` | idem `update` / `getPublishedPost` / `previewPost` |
| `packages/backend/convex/settings.ts:87-178, 381-411` | lieu SERP dans `getPrivate` + `update` ; **absent** de `get` |
| `packages/backend/convex/lib/dataforseo.ts` | inchangé (`authorizationHeader`, ping 8 s) |
| `packages/backend/convex/lib/dataforseoSerp.ts` *(créer)* | POST SERP / Labs / overview, parse, timeouts |
| `packages/backend/convex/lib/seoRankState.ts` *(créer)* | discriminant §3.3, pur |
| `packages/backend/convex/seoRanks.ts` *(créer)* | `forDocument`, `siteSnapshot`, `relever`, `refreshWeekly`, upsert |
| `packages/backend/convex/analytics.ts:29-184` | `pageviewsPrev` / `visitorsPrev` via `compare=prev` |
| `packages/backend/convex/crons.ts:16-41` | `seo-weekly` lundi 4 h 15 UTC |
| `packages/backend/convex/_dataRegistry.ts:91-112` | trois tables exemptées (pas de donnée visiteurs) |
| `packages/backend/testing/registryModules.ts:93` | `import "../convex/seoRanks"` |
| `apps/admin/src/components/fleche-tendance.tsx` *(créer)* | `↑` / `↓` / `→` |
| `apps/admin/src/components/indicateur.tsx` *(créer)* | libellé + chiffre + flèche |
| `apps/admin/src/components/analytics-panel.tsx` | quatre indicateurs + Relever |
| `apps/admin/src/components/pastille-seo.tsx` *(créer)* | pastille d'accueil |
| `apps/admin/src/components/site-dashboard.tsx` | pastilles + 2 ou 4 `Ranking` |
| `apps/admin/src/routes/_authed/pages/$pageId.tsx` | champ mot-clé + `PageAnalytics` enrichi |
| `apps/admin/src/routes/_authed/posts/$postId.tsx` | idem |
| `apps/admin/src/components/settings-seo-pixel.tsx` | `<Select>` France (Google) |
| `apps/web/src/lib/loadPage.ts:13-37` | `PageRecord` sans `targetKeyword` |

Chemins lus, ne pas les inventer :

- `MUTATION_REGISTRY` : `packages/backend/convex/_registry.ts:11`
- Enregistrement existant : `packages/backend/convex/dataforseo.ts:148-152`, `packages/backend/convex/analytics.ts:631-640`
- Barrel : `packages/backend/testing/registryModules.ts`
- Crons aujourd'hui : `revalidate-sweep` + `retention-purge` (`crons.ts:18-39`, test « exactement deux » `crons.test.ts:38-43`)
- `estDataForSeoConfigure` : `apps/admin/src/components/settings-seo-pixel.tsx:8-19`
- `CardAction` déjà importé : `$pageId.tsx:35`, `$postId.tsx:47`
- `publicPath` / `publicUrl` : `packages/backend/convex/lib/publicPath.ts:30-47`
- Projection publique settings : `settings.publicProjection.test.ts` `AUTORISES` / `AUTORISES_PRIVE`
- Famille publique : `pages.publicQueryFamily.test.ts` — enseigner toute query nouvelle sans `token`

---

## Chunk 1: Schéma, borne, écriture, omission

### Task 1: Constante et assertion `targetKeyword`

**Files:**
- Modify: `packages/backend/convex/content.ts`
- Test: `packages/backend/convex/content.test.ts` *(créer — le module n'a pas de test aujourd'hui)*

- [ ] **Step 1: Write the failing test**

```ts
import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  MAX_TARGET_KEYWORD_LENGTH,
  assertTargetKeyword,
} from "./content"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string; field?: string; max?: number }>).data
  }
}

test("80 caractères passent, 81 lèvent FIELD_TOO_LONG", () => {
  expect(assertTargetKeyword("a".repeat(80))).toBe("a".repeat(80))
  expect(codeDe(() => assertTargetKeyword("a".repeat(81)))).toEqual({
    code: "FIELD_TOO_LONG",
    field: "targetKeyword",
    max: MAX_TARGET_KEYWORD_LENGTH,
  })
})

test("trim à l'écriture ; vide = retrait (undefined)", () => {
  expect(assertTargetKeyword("  agence web lyon  ")).toBe("agence web lyon")
  expect(assertTargetKeyword("   ")).toBeUndefined()
  expect(assertTargetKeyword("")).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend exec vitest run convex/content.test.ts`
Expected: FAIL — `assertTargetKeyword` n'existe pas.

- [ ] **Step 3: Write minimal implementation**

Dans `content.ts`, après `MAX_CANONICAL_URL_LENGTH` :

```ts
export const MAX_TARGET_KEYWORD_LENGTH = 80

export function assertTargetKeyword(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_TARGET_KEYWORD_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "targetKeyword",
      max: MAX_TARGET_KEYWORD_LENGTH,
    })
  }
  return trimmed
}
```

Pas de minuscule forcée. N'entre **pas** dans `seoValidator` ni `assertPageTextWithinLimits`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend exec vitest run convex/content.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/content.ts packages/backend/convex/content.test.ts
git commit -m "$(cat <<'EOF'
feat(backend): borner targetKeyword à 80 caractères

EOF
)"
```

### Task 2: Schéma expand

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/_dataRegistry.ts` (trois tables **exemptées** : mot-clé et rangs d'opérateur, aucun visiteur)
- Modify: `packages/backend/convex/schema.test.ts` si le fichier assert les tables

- [ ] **Step 1: Write / extend the failing test**

Dans `_dataRegistry.test.ts` le scan échoue dès qu'une table n'est pas classée. Ajouter d'abord le test de forme des nouvelles tables dans `schema.test.ts` s'il existe un canari de tables ; sinon le test de registre suffit.

```ts
// _dataRegistry.ts — exempt, pas declaredAs
seoRanks: {
  exempt:
    "Rang d'un mot-clé cible choisi par l'opérateur. Aucun visiteur, " +
    "aucun cookie, aucune donnée qui désigne quelqu'un.",
},
seoSiteKeywords: {
  exempt:
    "Snapshot Labs des mots-clés du domaine. Contenu d'opérateur, pas un visiteur.",
},
seoSiteBacklinks: {
  exempt:
    "Compteurs de backlinks du domaine. Singleton site, aucun auteur.",
},
```

- [ ] **Step 2: Add optional fields and tables**

`pages` et `posts` (frère de `seo`, pas dedans) :

```ts
targetKeyword: v.optional(v.string()),
```

Pas d'index.

`settings` :

```ts
serpLocationCode: v.optional(v.number()),
serpLanguageCode: v.optional(v.string()),
```

Tables nouvelles (fin de `defineSchema`) :

```ts
seoRanks: defineTable({
  kind: v.union(v.literal("page"), v.literal("post")),
  pageId: v.optional(v.id("pages")),
  postId: v.optional(v.id("posts")),
  keyword: v.string(),
  url: v.string(),
  position: v.optional(v.number()),
  previousPosition: v.optional(v.number()),
  rankedUrl: v.optional(v.string()),
  status: v.union(
    v.literal("ranked"),
    v.literal("out_of_top_100"),
    v.literal("other_url"),
  ),
  fetchedAt: v.number(),
  previousFetchedAt: v.optional(v.number()),
})
  .index("by_page", ["pageId"])
  .index("by_post", ["postId"]),

seoSiteKeywords: defineTable({
  keyword: v.string(),
  position: v.number(),
  url: v.string(),
  fetchedAt: v.number(),
})
  .index("by_fetched_at", ["fetchedAt"]),

seoSiteBacklinks: defineTable({
  backlinks: v.number(),
  referringDomains: v.number(),
  backlinksPrev: v.optional(v.number()),
  referringDomainsPrev: v.optional(v.number()),
  fetchedAt: v.number(),
}),
```

- [ ] **Step 3: Run registry + schema tests**

Run: `pnpm --filter @astrotan/backend exec vitest run convex/_dataRegistry.test.ts convex/schema.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_dataRegistry.ts
git commit -m "$(cat <<'EOF'
feat(backend): tables seoRanks et champs targetKeyword (expand)

EOF
)"
```

### Task 3: `pages.update` / `posts.update` + projection

**Files:**
- Modify: `packages/backend/convex/pages.ts` (`update` args ~L429, handler ~L462-512 ; `getPublishedPage` L63-73 ; `previewPage` L120-136 ; `listPublishedPages` L85-94 — omettre aussi)
- Modify: `packages/backend/convex/posts.ts` (`update` L195-270 ; `getPublishedPost` L419-432 ; `previewPost` L470-485 ; `listPublishedPosts`)
- Modify: `packages/backend/convex/pages.crud.test.ts`
- Modify: `packages/backend/convex/posts.test.ts`
- Modify: `packages/backend/convex/pages.publicQueryFamily.test.ts`
- Modify: `packages/backend/convex/pages.test.ts` / `posts.test.ts` (getPublished*)

Helper local (pas un nouveau point d'entrée) — dans `lib/omitTargetKeyword.ts` :

```ts
export function omitTargetKeyword<T extends { targetKeyword?: string }>(
  doc: T,
): Omit<T, "targetKeyword"> {
  const { targetKeyword: _dropped, ...rest } = doc
  return rest
}
```

- [ ] **Step 1: Write the failing tests**

`pages.crud.test.ts` :

```ts
test("targetKeyword : 80 passent, 81 lèvent, vide retire", async () => {
  // seed page + owner comme les autres tests du fichier
  await owner.identity.mutation(api.pages.update, {
    id,
    targetKeyword: "a".repeat(80),
  })
  const row = await owner.identity.query(api.pages.get, { id })
  expect(row?.targetKeyword).toBe("a".repeat(80))

  await expect(
    owner.identity.mutation(api.pages.update, {
      id,
      targetKeyword: "a".repeat(81),
    }),
  ).rejects.toMatchObject({
    data: { code: "FIELD_TOO_LONG", field: "targetKeyword", max: 80 },
  })

  await owner.identity.mutation(api.pages.update, { id, targetKeyword: "  " })
  const cleared = await owner.identity.query(api.pages.get, { id })
  expect(cleared?.targetKeyword).toBeUndefined()
})
```

Même couple dans `posts.test.ts`.

`pages.publicQueryFamily.test.ts` — ajouter **après** le test existant :

```ts
test("aucune query publique sans token ne rend targetKeyword", async () => {
  const t = convexTest(schema, modules)
  await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "publiee-mot-cle",
      title: "Publiée",
      status: "published",
      targetKeyword: "agence web lyon",
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("posts", {
      slug: "article-mot-cle",
      title: "Article",
      body: "<p>ok</p>",
      status: "published",
      publishedAt: 1,
      tagIds: [],
      targetKeyword: "agence web lyon",
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )

  const page = await t.query(api.pages.getPublishedPage, { slug: "publiee-mot-cle" })
  const post = await t.query(api.posts.getPublishedPost, { slug: "article-mot-cle" })
  expect(page).not.toBeNull()
  expect(post).not.toBeNull()
  expect(JSON.stringify(page)).not.toContain("targetKeyword")
  expect(JSON.stringify(page)).not.toContain("agence web lyon")
  expect(JSON.stringify(post)).not.toContain("targetKeyword")
  expect(JSON.stringify(post)).not.toContain("agence web lyon")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @astrotan/backend exec vitest run convex/pages.crud.test.ts convex/posts.test.ts convex/pages.publicQueryFamily.test.ts`
Expected: FAIL — argument inconnu / champ encore présent.

- [ ] **Step 3: Implement**

`pages.update` args : `targetKeyword: v.optional(v.string())`. Si fourni : `patch.targetKeyword = assertTargetKeyword(args.targetKeyword)` — Convex `undefined` retire le champ optionnel via `replace` sur posts ; sur pages, `patch` avec `undefined` n'efface pas. Pour pages, si le trim est vide : `replace` sans la clé, **ou** le motif déjà utilisé par `coverId` des posts.

Préférer le même motif que `posts.update` `coverId` : `replace` sans `targetKeyword` quand l'assertion rend `undefined`. Sur `pages.update` qui fait `patch`, utiliser `replace` seulement pour ce champ, ou `ctx.db.patch` puis un second `replace` — le plus petit changement : extraire `{ targetKeyword, ...rest }` et `replace` comme posts.

`getPublishedPage` / `previewPage` / `listPublishedPages` :

```ts
if (page === null) return null
if (page.status !== "published") return null
return omitTargetKeyword(page)
```

`previewPage` omet aussi (spec : les quatre). `pages.get` et `posts.get` **gardent** le champ.

`listPublishedPages` map `omitTargetKeyword`. `listPublishedPosts` : omettre après `withCover` (`const { targetKeyword, ...rest } = enriched`).

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/pages.ts packages/backend/convex/posts.ts packages/backend/convex/lib/omitTargetKeyword.ts packages/backend/convex/pages.crud.test.ts packages/backend/convex/posts.test.ts packages/backend/convex/pages.publicQueryFamily.test.ts packages/backend/convex/pages.test.ts
git commit -m "$(cat <<'EOF'
feat(backend): écrire et omettre targetKeyword hors du site public

EOF
)"
```

---

## Chunk 2: Lieu SERP

### Task 4: `serpLocationCode` / `serpLanguageCode`

**Files:**
- Modify: `packages/backend/convex/settings.ts` (`get` L87-114 **inchangé** ; `getPrivate` L136-178 ; `update` L381-411)
- Modify: `packages/backend/convex/settings.publicProjection.test.ts` (`AUTORISES` inchangé ; `AUTORISES_PRIVE` + les deux champs ; `semerLaLigneEntiere` les pose)
- Test: `packages/backend/convex/settings.test.ts`

Défauts (lecture, pas schéma) : `2250` et `"fr"`. Exporter de `lib/serpLocale.ts` :

```ts
export const DEFAULT_SERP_LOCATION_CODE = 2250
export const DEFAULT_SERP_LANGUAGE_CODE = "fr"
export const MAX_SERP_LANGUAGE_CODE_LENGTH = 8

export function assertSerpLocale(input: {
  serpLocationCode?: number | null
  serpLanguageCode?: string | null
}): { serpLocationCode?: number; serpLanguageCode?: string } {
  // absent = ne pas patcher ; null = effacer
  // location : entier > 0 sinon INVALID_SERP_LOCALE
  // language : trim, vide = effacer, sinon /^[a-z]{2}$/ sinon INVALID_SERP_LOCALE
}
```

- [ ] **Step 1: Failing tests**

```ts
test("settings.get ne porte ni serpLocationCode ni serpLanguageCode", async () => {
  // semer les deux champs via ctx.db.insert (comme publicProjection)
  const pub = await t.query(api.settings.get, {})
  expect(pub).not.toHaveProperty("serpLocationCode")
  expect(pub).not.toHaveProperty("serpLanguageCode")
})

test("un language_code hors [a-z]{2} lève INVALID_SERP_LOCALE", async () => {
  await expect(
    owner.identity.mutation(api.settings.update, { serpLanguageCode: "FR" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SERP_LOCALE" } })
})

test("un location_code ≤ 0 lève INVALID_SERP_LOCALE", async () => {
  await expect(
    owner.identity.mutation(api.settings.update, { serpLocationCode: 0 }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SERP_LOCALE" } })
})
```

`settings.publicProjection.test.ts` : ajouter les deux clés à `AUTORISES_PRIVE` et à `ligne` dans `semerLaLigneEntiere`. **Ne pas** les ajouter à `AUTORISES`.

- [ ] **Step 2: Run — FAIL** (champs inconnus / projection)

- [ ] **Step 3: Implement** — `getPrivate` rend `serpLocationCode: settings.serpLocationCode ?? null`, `serpLanguageCode: settings.serpLanguageCode ?? null`. `update` args optionnels `| null`. Owner / admin déjà.

- [ ] **Step 4: PASS** — `vitest run convex/settings.test.ts convex/settings.publicProjection.test.ts`

- [ ] **Step 5: Commit** `feat(backend): lieu SERP France dans getPrivate seulement`

---

## Chunk 3: Client DataForSEO (parse, pas d'écriture)

### Task 5: `lib/dataforseoSerp.ts`

**Files:**
- Create: `packages/backend/convex/lib/dataforseoSerp.ts`
- Test: `packages/backend/convex/lib/dataforseoSerp.test.ts`

Réutiliser `authorizationHeader` de `lib/dataforseo.ts`. Timeouts : SERP `30_000`, Labs / overview `DATAFORSEO_TIMEOUT_MS` (8 s).

```ts
export const DATAFORSEO_SERP_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced"
export const DATAFORSEO_LABS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live"
export const DATAFORSEO_BACKLINKS_URL =
  "https://api.dataforseo.com/v3/backlinks/overview/live"
export const DATAFORSEO_SERP_TIMEOUT_MS = 30_000
export const SERP_DEPTH = 100
```

Parse organique (pur, testé sans fetch) :

```ts
export type SerpVerdict =
  | { status: "ranked"; position: number }
  | { status: "other_url"; rankedUrl: string }
  | { status: "out_of_top_100" }

export function normalizeHostPath(url: string): { host: string; path: string } {
  // URL parse, lowercase host, strip query/hash, collapse trailing slash except "/"
}

export function interpretOrganic(args: {
  items: unknown[]
  targetUrl: string // publicUrl
  ourHost: string  // declaredDomain sans schéma, ou host de targetUrl
}): SerpVerdict {
  // 1. host+path === target → ranked, rank_absolute
  // 2. sinon premier item organique dont host === ourHost → other_url
  // 3. sinon out_of_top_100
  // other_url l'emporte sur out_of_top_100
}

export function interpretLabs(items: unknown[]): {
  keyword: string
  position: number
  url: string
}[] {
  // limit 50 déjà côté requête ; jeter etv / cpc / search_volume
  // position = rank_absolute ?? rank_group
}

export function interpretOverview(body: unknown): {
  backlinks: number
  referringDomains: number
} | null
```

`match_value` SERP : `${host}${publicPath}` sans schéma (`exemple.fr/blog/welcome`, accueil `exemple.fr/`).

- [ ] **Step 1: Tests purs** — ranked / other_url / out_of_top_100 ; Labs jette `etv` ; overview lit `backlinks` + `referring_domains` seulement.

- [ ] **Step 2: FAIL** puis implémentation minimale.

- [ ] **Step 3: Commit** `feat(backend): parser SERP, Labs et overview DataForSEO`

---

## Chunk 4: Queries, Relever, cron

### Task 6: Discriminant `seoRankState`

**Files:**
- Create: `packages/backend/convex/lib/seoRankState.ts`
- Test: `packages/backend/convex/lib/seoRankState.test.ts`

```ts
export type RankUiState =
  | { state: "no_keyword" }
  | { state: "dfs_absent" }
  | { state: "draft"; rank: RankPayload | { state: "never_ranked" } }
  | { state: "never_ranked" }
  | { state: "keyword_changed"; previousKeyword: string }
  | { state: "ranked"; position: number; previousPosition?: number; gap?: number }
  | { state: "out_of_top_100" }
  | { state: "other_url"; rankedUrl: string }

// Priorité (spec §3.3) :
// no_keyword > dfs_absent > (ensuite) keyword_changed > other_url > ranked / out_of_top_100
// draft : Umami reste ; Relever off ; si ligne existante on la montre
```

`gap = previousPosition - position` (négatif = on a gagné). `canRelever` : pas `no_keyword` / `dfs_absent` / `draft`, et `fetchedAt` absent ou ≥ 1 h. Le cron n'écrit pas un `fetchedAt` qui bloquerait Relever : le throttle ne s'applique qu'à l'action `relever`.

- [ ] Tests : chaque état, priorités, `canRelever` 59 min / 61 min.
- [ ] Commit `feat(backend): discriminant des états de rang`

### Task 7: `seoRanks.forDocument` + `siteSnapshot`

**Files:**
- Create: `packages/backend/convex/seoRanks.ts` (< 200 lignes : queries + thin wrappers)
- Create: `packages/backend/convex/seoRanksWrite.ts` si l'écriture dépasse — **non** : garder upsert dans `seoRanks.ts` et `refreshWeekly` dans le même module seulement s'il tient ; sinon `seoWeekly.ts` point d'entrée à nom simple, appelé `internal.seoWeekly.refresh` **interdit par la spec** (`internal.seoRanks.refreshWeekly`). Donc extraire les helpers, pas l'export.

`forDocument` query, `requireRole(["owner","admin","editor"])` :

```ts
args: {
  kind: v.union(v.literal("page"), v.literal("post")),
  pageId: v.optional(v.id("pages")),
  postId: v.optional(v.id("posts")),
}
```

Lit le document, la ligne `by_page` / `by_post`, et si DFS est configuré **sans rendre de secret** : même règle que `estDataForSeoConfigure` — les deux noms ont une source ≠ `aucune`. Helper query-side : lire `process.env.DATAFORSEO_*` + existence d'une ligne `secrets` `by_nom` (pas `lireSecret`, qui est `ActionCtx`). Extraire `dataforseoEstConfigure(ctx)` dans `lib/dataforseoConfigured.ts` (QueryCtx : env + row). Ne pas déchiffrer.

`siteSnapshot` query, mêmes rôles :

```ts
{
  configured: boolean
  declaredDomain: string | null
  averagePosition: number | null
  averagePositionPrev: number | null
  backlinks: { value: number; prev: number | null; fetchedAt: number } | null
  referringDomains: { value: number; prev: number | null } | null
  keywords: { keyword: string; position: number }[]  // 5, position croissante
  rankingPages: { path: string; position: number }[] // 5, notre hôte, meilleure pos
}
```

Moyenne : uniquement les `seoRanks` `status === "ranked"` dont le document publié a encore **ce** `targetKeyword`. Sans aucun `ranked` : `averagePosition === null` (l'UI affiche « — »).

- [ ] Tests Convex (convex-test + seedActor) : `no_keyword`, `never_ranked`, moyenne, listes vides, `configured: false` sans secrets.
- [ ] Enseigner `pages.publicQueryFamily` si les args (`kind`+id) sont découverts : ce sont des queries **session-gated** — elles lèvent sans identité (comme `pages.get`). Si le scan échoue sur la forme, ajouter une branche `kind` dans `pages.publicQueryFamily.test.ts`.
- [ ] Commit `feat(backend): queries seoRanks.forDocument et siteSnapshot`

### Task 8: Upsert + `relever` + registre

**Files:**
- Modify: `packages/backend/convex/seoRanks.ts`
- Test: `packages/backend/convex/seoRanks.test.ts`
- Modify: `packages/backend/testing/registryModules.ts` — `import "../convex/seoRanks"`
- Modify: `packages/backend/convex/_registry` via `MUTATION_REGISTRY.push` dans `seoRanks.ts`

`upsertRank` = `internalMutation` : une ligne par `pageId`/`postId` ; refuse une seconde insert ; copie `position → previousPosition`, `fetchedAt → previousFetchedAt` ; borne `url`/`rankedUrl` à `MAX_CANONICAL_URL_LENGTH`, `keyword` à 80.

`relever` = `action` publique :

1. `requireRole(["owner","admin","editor"])` + charger le doc + `requireOwnDocument` + `requirePublishedPageWritable` **non** — spec : Relever refuse un brouillon, pas un editor sur publié. Editor : `requireOwnDocument` seulement. Brouillon → `{ ok: false, reason: "draft" }`.
2. DFS absent → `{ ok: false, reason: "dfs_absent" }`.
3. Pas de mot-clé → `{ ok: false, reason: "no_keyword" }`.
4. Ligne existante et `Date.now() - fetchedAt < 3_600_000` → `{ ok: false, reason: "throttled" }`.
5. `lireSecret` login + password ; `publicUrl` via `declaredDomain` / origines (`lib/origines` ou `settings.declaredDomain` + `WEB_SITE_URL`).
6. SERP §7.1. Échec (timeout, 429, refuse) : **n'écrit pas**, `{ ok: false, reason: "unreachable" | "refuse" }`.
7. Succès : une seule `runMutation(internal.seoRanks.upsertRank, …)`.

```ts
MUTATION_REGISTRY.push({
  name: "seoRanks.relever",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) =>
    t.action(api.seoRanks.relever, {
      kind: "page",
      pageId: "jd7am0k1e0x000000000000000000000" as never,
    }),
})
```

Un `pageId` inexistant lève `NOT_FOUND` **après** `requireRole` — la matrice s'exerce. Mieux : args valides d'un id Convex factice ; `requireRole` passe, handler refuse NOT_FOUND avant le fetch (comme `dataforseo.enregistrer` login vide).

- [ ] Tests : throttle 1 h, brouillon, upsert copie `previous*`, échec HTTP n'écrit pas, editor sur document d'autrui FORBIDDEN.
- [ ] Commit `feat(backend): action seoRanks.relever (throttle 1 h)`

### Task 9: Cron `seo-weekly`

**Files:**
- Modify: `packages/backend/convex/crons.ts`
- Modify: `packages/backend/convex/crons.test.ts:38-43` — liste = `retention-purge`, `revalidate-sweep`, `seo-weekly`
- Modify: `packages/backend/convex/seoRanks.ts` — `internalAction refreshWeekly`

```ts
crons.weekly(
  "seo-weekly",
  { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 15 },
  internal.seoRanks.refreshWeekly,
)
```

`refreshWeekly` :

1. DFS absent → return.
2. Si `declaredDomain` : Labs + overview ; remplacer `seoSiteKeywords` (delete `by_fetched_at` puis insert ≤ 50) ; singleton backlinks (copy * → *Prev).
3. Pages `by_status` published + posts `by_status_published` avec `targetKeyword` non vide : SERP **en série**. Item N échoue → N+1 continue. Mot-clé **courant**. Pas de throttle.

- [ ] Tests : cron déclaré ; refresh saute brouillons ; Labs jette etv (déjà Task 5) ; sans DFS n'écrit pas de zéro. `fetch` stubbé.
- [ ] Commit `feat(backend): cron seo-weekly (Labs, overview, SERP publiés)`

---

## Chunk 5: Umami `compare=prev` sur `forPath`

### Task 10: `pageviewsPrev` / `visitorsPrev`

**Files:**
- Modify: `packages/backend/convex/analytics.ts:29-100, 128-184`
- Modify: `packages/backend/convex/analytics.test.ts:95-133` (et tout `toEqual` de `last7`)

```ts
interface Stats {
  pageviews: number
  visitors: number
  pageviewsPrev: number | null
  visitorsPrev: number | null
}
```

`fetchStats` : ajouter `compare=prev` aux params (comme `siteSummary` L482). Mapper `comparison` → `*Prev`, `null` si absent.

- [ ] Test : URL `/stats` contient `compare=prev` ; corps avec `comparison` remplit les Prev ; sans `comparison` → `null`.
- [ ] Mettre à jour les `toEqual({ pageviews, visitors })` existants : ajouter `pageviewsPrev: null, visitorsPrev: null` (le mock actuel n'a pas `comparison`).
- [ ] Commit `feat(backend): forPath expose la période précédente Umami`

---

## Chunk 6: Fiches admin

### Task 11: `FlecheTendance` + `Indicateur`

**Files:**
- Create: `apps/admin/src/components/fleche-tendance.tsx` + `.test.tsx`
- Create: `apps/admin/src/components/indicateur.tsx` + `.test.tsx`

```ts
export type SensTendance = "up" | "down" | "flat"

export function FlecheTendance({ sens }: { sens: SensTendance }) {
  // up: ↑ text-emerald-600 ; down: ↓ text-red-600 ; flat: → text-muted-foreground
}

export function sensPourVolume(current: number, previous: number | null): SensTendance {
  if (previous === null || current === previous) return "flat"
  return current > previous ? "up" : "down"
}

export function sensPourRang(current: number, previous: number | null): SensTendance {
  if (previous === null || current === previous) return "flat"
  return current < previous ? "up" : "down" // 12 → 7 = amélioration
}
```

`Indicateur` : `label`, `value: ReactNode` (`tabular-nums`), `sens`.

- [ ] Commit `feat(admin): Indicateur et FlecheTendance partagés`

### Task 12: `AnalyticsPanel` — quatre cases + Relever

**Files:**
- Modify: `apps/admin/src/components/analytics-panel.tsx`
- Modify: `apps/admin/src/components/analytics-panel.test.tsx`
- `CardAction` : `apps/admin/src/components/ui/card.tsx:59`

Props nouvelles (pures) :

```ts
export function AnalyticsPanel({
  result,
  rank,
  onRelever,
  releverBusy,
  releverError,
}: {
  result: AnalyticsResult | undefined
  rank: DocumentRank | undefined // retour de forDocument
  onRelever?: () => void
  releverBusy?: boolean
  releverError?: string | null
})
```

Grille `sm:grid-cols-4`. Cases 1–2 : Umami (`Vues 7 j` = `last7.pageviews`, flèche vs `pageviewsPrev` ; `Visiteurs 30 j` = `last30.visitors` vs `visitorsPrev`). Umami muet : phrase `LIBELLES_ETAT`, **pas** de zéro. Zéro mesuré : chiffre 0.

Cases 3–4 : états §3.3 (libellés FR de la spec). Relever dans `CardHeader` / `CardAction`, inactif si `!rank.canRelever`.

`PageAnalytics` :

```ts
export function PageAnalytics({
  path,
  kind,
  pageId,
  postId,
}: {
  path: string | null
  kind: "page" | "post"
  pageId?: Id<"pages">
  postId?: Id<"posts">
}) {
  // useAction forPath — inchangé, useEffect
  // useQuery api.seoRanks.forDocument — PAS d'action DFS
  // useAction api.seoRanks.relever — au clic seulement
}
```

Réécrire les tests qui attendent « 7 derniers jours » / deux fenêtres.

- [ ] Commit `feat(admin): quatre indicateurs et Relever sur la fiche`

### Task 13: Champ mot-clé sur `$pageId` et `$postId`

**Files:**
- Modify: `apps/admin/src/routes/_authed/pages/$pageId.tsx` (state ~L111, save ~L168, section SEO L461-513)
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx` (form SEO + `PageAnalytics` L521)
- Import `MAX_TARGET_KEYWORD_LENGTH` depuis `content.ts` (déjà le motif des autres MAX).
- `GenerateSeoGeoButton` / `ai.generateSeoGeo` : **ne pas** remplir ce champ.

Section « Dans les résultats de recherche » : un `Input` `id="target-keyword"` à côté de titre / description, `maxLength={MAX_TARGET_KEYWORD_LENGTH}`, envoyé à `pages.update` / `posts.update` comme `targetKeyword`, **pas** dans `buildSeo`.

Passer `kind` + id à `PageAnalytics`.

- [ ] Tests route existants s'il y en a (`identite.test` n'est pas le sujet). Ajouter un test de formulaire posts/pages seulement si un fichier de test de l'éditeur existe déjà et casse. Sinon le contrat est côté mutation.
- [ ] Commit `feat(admin): champ mot-clé cible sur les fiches page et article`

---

## Chunk 7: Dashboard et réglages

### Task 14: `SiteDashboard` — pastilles + 4 listes

**Files:**
- Create: `apps/admin/src/components/pastille-seo.tsx`
- Modify: `apps/admin/src/components/site-dashboard.tsx` (déjà 276 lignes — **sortir** pastilles, ne pas avaler le fichier)
- Modify: `apps/admin/src/components/site-dashboard.test.tsx`
- `CourbeAudience` : `apps/admin/src/components/audience-chart.tsx` — **contrat inchangé** (aucun `--color-rank`)

`SiteDashboard` gagne `snapshot: SiteSnapshot | undefined | null`. `null` / `configured: false` : pas de colonne pastilles, `grid sm:grid-cols-2` Umami only.

`configured: true` : `lg:grid-cols` courbe + colonne de 3 `PastilleSeo` ; bas `lg:grid-cols-4`. Position moyenne `null` → « — » + `→`. Backlinks absents → « Pas encore relevé » + `→`. Domaine vide → « Déclarez le domaine » + lien `/settings/domaine` sur pastilles backlinks et listes 3–4.

`SiteDashboardPanel` : `useQuery(api.seoRanks.siteSnapshot)` **à côté** de `siteSummary`. Pas d'`useEffect` DataForSEO.

Tests (spec §10) :

- pastilles absentes sans DFS
- présentes avec
- `Ranking` × 2 vs × 4
- `--color-pageviews` toujours, aucun `--color-rank`

- [ ] Commit `feat(admin): pastilles DataForSEO et quatre listes sur l'accueil`

### Task 15: Select lieu SERP sur `/settings/mesure`

**Files:**
- Modify: `apps/admin/src/components/settings-seo-pixel.tsx` (103 lignes — une ligne de plus tient ; si ça dépasse, extraire `SerpLieuSelect`)
- Modify: `apps/admin/src/components/settings-seo-pixel.test.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/mesure.tsx` — passer `serpLocationCode` / `serpLanguageCode` depuis `getPrivate` et `update`

Une seule option livrée : « France (Google) » → `{ serpLocationCode: 2250, serpLanguageCode: "fr" }`. Owner / admin (`canWrite`). Editor : lecture.

- [ ] Commit `feat(admin): lieu SERP France sous DataForSEO`

---

## Chunk 8: Garde-fous site public

### Task 16: `PageRecord` / `PageHead` sans mot-clé

**Files:**
- `apps/web/src/lib/loadPage.ts:13-37` — ne **pas** ajouter `targetKeyword` à `PageRecord`
- Test: `apps/web/src/lib/loadPage.test.ts` ou étendre un test existant de `PageHead` / `getPublishedPage`

Si aucun test HTML Astro n'existe pour une page publiée, le test Convex de la Task 3 **est** le garde-fou « la chaîne n'apparaît pas ». Ajouter tout de même un test unitaire unit `PageRecord` / sérialisation : `expect(Object.keys(page)).not.toContain("targetKeyword")` déjà couvert backend.

Ne pas toucher `consent.ts` / `legal.ts`.

- [ ] `pnpm --filter @astrotan/backend test` + `pnpm --filter @astrotan/admin test` ciblés.
- [ ] Commit seulement s'il y a un fichier de test web nouveau : `test(web): le mot-clé cible n'entre pas dans PageRecord`

---

## Ordre d'exécution et livrable

1. Chunks 1–5 (backend) puis Chunk 6 (fiches) — **livrable intermédiaire** : 4 tuiles + mot-clé + Relever.
2. Chunk 7 (dashboard + select) dans la foulée.
3. Chunk 8 si pas déjà tenu par Task 3.

Vérification manuelle (spec §10) : pas de fetch `api.dataforseo.com` à l'ouverture ; Relever une fois ; throttle ; brouillon ; accueil 2 vs 4 listes. Ne **pas** relancer une 2e pile Vite. Admin down ≠ bloquant.

Après tout changement `convex/` : `pnpm --filter @astrotan/backend exec tsc --noEmit` et `pnpm --filter @astrotan/backend test`. `npx convex dev --once` seulement si `_generated` doit suivre le schéma.

## Hors périmètre (spec §2)

GSC, score /100, AI visibility, trafic estimé DFS, backlinks par URL, courbe sur la fiche, dual-axis rang, mot-clé dans `seo` / HTML, bump `consentVersion`.

---

## Addendum 2026-09-01 — génération SEO/GEO, extrait et image de une

Complète Task 13 (`GenerateSeoGeoButton` / `ai.generateSeoGeo`) : le bouton remplit aussi l'extrait d'un article, et une action séparée génère la couverture.

### Cause du « L'IA a renvoyé une réponse inutilisable »

`draftFromModel` ne lisait que des clés plates (`seoTitle`, `geoSummary`). Les flagships (Grok 4.6, etc.) renvoient souvent `{ seo: { title }, geo: { summary } }` — JSON valide, brouillon vide, `OPENROUTER_BAD_RESPONSE`. Second piège : timeout chat à 8 s, trop court pour un flagship. Correctifs : parser plat **et** imbriqué, extraction d'un fence markdown / virgules finales / `content` en parties, timeout chat 60 s, messages d'erreur plus précis (`reason: parse | empty`).

### Prompts par type de page

`lib/seoGeoPageKind.ts` + `lib/seoGeoPrompt.ts`. Templates : accueil, contact, mentions/légal, service, index blog, article, générique. Contexte injecté : identité (`siteName`, domaine, SEO par défaut, réseaux), URL, mot-clé cible, SEO/GEO déjà saisis, lieu SERP, corps d'article tronqué (jamais le HTML d'une `page`). Objectif : n°1 Google + formulations citables (GEO / AI Overviews). Interdit d'inventer SIRET / raison sociale.

### Extrait IA

Le contrat JSON gagne `excerpt` (≤ 300). `applyDraft` sur `$postId` le pose dans le champ chapô existant — **pas** un 3e bouton. Les pages n'ont pas d'extrait.

### Image IA

- Action `aiImage.generatePostCover` : OpenRouter `POST /api/v1/images`, blob Convex, `media.register`, `posts.update.coverId`.
- Bouton FR près de la couverture : « Générer une image avec l'IA ».
- **Modèle retenu (défaut)** : `google/gemini-3-pro-image` — Nano Banana Pro, flagship Gemini image réellement servi le 2026-09-01.
  - Preuve : https://openrouter.ai/google/gemini-3-pro-image
  - Doc Image API : https://openrouter.ai/docs/guides/overview/multimodal/image-generation
  - Collection (classement usage) : https://openrouter.ai/collections/image-models
- Allowlist aussi : `google/gemini-3.1-flash-image` (Nano Banana 2, plus rapide), `google/gemini-2.5-flash-image` (Nano Banana GA).
- Prompt image : titre + extrait + mot-clé + marque, photo éditoriale 16:9, **aucun texte dans l'image**.

### Réglages `/settings/ia`

Champ privé `settings.openRouterImageModel` (expand-only, `getPrivate` seulement, jamais `settings.get`). Sélecteur « Modèle d'image », même pattern que le modèle texte.

### Fichiers

`convex/lib/parseModelJson.ts`, `seoGeoDraft.ts`, `seoGeoPrompt.ts`, `seoGeoPageKind.ts`, `openRouterImage.ts`, `openRouterImageModels.ts`, `coverPrompt.ts`, `aiSiteContext.ts`, `ai.ts`, `aiImage.ts` ; admin : `generate-cover-button`, `ai-model-select`, `$postId`, `/settings/ia`.
