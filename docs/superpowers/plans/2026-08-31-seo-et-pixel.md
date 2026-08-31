# SEO et Pixel — écran de clés Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `/settings/mesure` par l'écran **SEO & Pixel** : saisir / modifier / supprimer DataForSEO (secret chiffré) et les IDs Meta / Google (table `settings`), lus par `consentTags()` après fusion, jamais une balise avant consentement.

**Architecture:** Les identifiants DataForSEO rejoignent `SECRET_NOMS`. Les IDs de pixels sont deux champs optionnels de `settings`, projetés par `get` (publique). Le site fusionne base + `PUBLIC_*` dans `apps/web/src/lib/pixelIds.ts`. Umami quitte cet écran et reste branché sur le site. Aucun appel DataForSEO. `consentVersion` inchangé.

**Tech Stack:** Convex (schema expand, `secrets`, `settings.update`), Astro `apps/web`, TanStack Start `apps/admin`, skill `@.claude/skills/convex-function`, skill `@.claude/skills/consent-rgpd`, spec [`docs/superpowers/specs/2026-08-31-seo-et-pixel-design.md`](../specs/2026-08-31-seo-et-pixel-design.md).

**Spec:** [`docs/superpowers/specs/2026-08-31-seo-et-pixel-design.md`](../specs/2026-08-31-seo-et-pixel-design.md)

---

## Contraintes

- TDD. Fichiers < 200 lignes. Ne pas lancer `npx convex dev` (interactif).
- Ne pas committer les diffs déjà sales (IA, identité, leads, etc.).
- `settings.get` : `null` = jamais saisi (repli `PUBLIC_*`) ; `""` = retiré (aucun pixel). Jamais `|| null` sur ces champs.
- `consentVersion` reste `"1.0.0"`.
- Ne pas débrancher Umami (`script.js`, `analytics.ts`, `SECRET_NOMS` Umami).
- Commits Conventional Commits, messages en français.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/pixelId.ts` *(créer)* | Valider / normaliser un ID. Pur. `null` → `""`. |
| `packages/backend/convex/lib/pixelId.test.ts` *(créer)* | Bornes et formes. |
| `packages/backend/convex/secrets.ts` | `SECRET_NOMS` + `nomValidator` : `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`. |
| `packages/backend/.env.example` | Documenter les deux noms. |
| `packages/backend/convex/schema.ts` | `metaPixelId`, `googleTagId` optionnels ; `kind: "site"` sur l'outbox. |
| `packages/backend/convex/settings.ts` | Projection, `update`, invalidation. |
| `packages/backend/convex/revalidate.ts` | `OutboxTarget` + `kind: "site"`. |
| `apps/web/src/lib/pixelIds.ts` *(créer)* | `choisirIdentifiant` + `fusionnerPixels`. |
| `apps/web/src/lib/pixelIds.test.ts` *(créer)* | Les trois valeurs + ligne `null`. |
| `apps/web` ConsentBanner, GoogleConsentMode, cookies, middleware | Passer par la fusion. |
| `apps/admin/src/components/settings-seo-pixel.tsx` *(créer)* | Corps de l'écran. |
| `apps/admin/src/components/settings-nav.tsx` | Libellé SEO & Pixel. |
| `apps/admin/src/components/settings-environment.tsx` | Retirer `MeasurementPage`. |

---

## Chunk 1: Backend — secrets, schéma, projections, update

### Task 1: Validateur d'ID pixel

**Files:**
- Create: `packages/backend/convex/lib/pixelId.ts`
- Test: `packages/backend/convex/lib/pixelId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  MAX_GOOGLE_TAG_ID_LENGTH,
  MAX_META_PIXEL_ID_LENGTH,
  normaliserPixelId,
} from "./pixelId"

function codeDe(fn: () => unknown): { code: string; field?: string; max?: number } {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string; field?: string; max?: number }>).data
  }
}

test("un ID Meta de chiffres passe, trimé ; 5 chiffres minimum, 4 refusés", () => {
  expect(normaliserPixelId("metaPixelId", " 12345 ")).toBe("12345")
  expect(codeDe(() => normaliserPixelId("metaPixelId", "1234")).code).toBe("INVALID_PIXEL_ID")
})

test("null et blanc sont un retrait — chaîne vide, pas undefined", () => {
  expect(normaliserPixelId("metaPixelId", null)).toBe("")
  expect(normaliserPixelId("googleTagId", "   ")).toBe("")
})

test("un ID Meta hors forme lève INVALID_PIXEL_ID avec le champ", () => {
  expect(codeDe(() => normaliserPixelId("metaPixelId", "12a"))).toEqual({
    code: "INVALID_PIXEL_ID",
    field: "metaPixelId",
  })
})

test("un ID trop long lève FIELD_TOO_LONG aux deux champs", () => {
  expect(codeDe(() => normaliserPixelId("metaPixelId", "1".repeat(MAX_META_PIXEL_ID_LENGTH + 1)))).toEqual({
    code: "FIELD_TOO_LONG",
    field: "metaPixelId",
    max: MAX_META_PIXEL_ID_LENGTH,
  })
  expect(codeDe(() => normaliserPixelId("googleTagId", `G-${"A".repeat(MAX_GOOGLE_TAG_ID_LENGTH)}`)).code).toBe(
    "FIELD_TOO_LONG",
  )
})

test("les préfixes Google acceptés passent", () => {
  for (const id of ["G-ABC123", "AW-999", "GT-XYZ", "DC-1"]) {
    expect(normaliserPixelId("googleTagId", id)).toBe(id)
  }
})

test("un tag Google hors préfixe est refusé", () => {
  expect(codeDe(() => normaliserPixelId("googleTagId", "UA-123")).code).toBe("INVALID_PIXEL_ID")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test convex/lib/pixelId.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

`normaliserPixelId(field, valeur: string | null): string`
- `null` / trim vide → `""`
- Meta : `/^\d{5,20}$/`, max 20 (`MAX_META_PIXEL_ID_LENGTH`)
- Google : `/^(G|AW|GT|DC)-[A-Z0-9]+$/i`, max 64 (`MAX_GOOGLE_TAG_ID_LENGTH`)
- Hors forme : `throw new ConvexError({ code: "INVALID_PIXEL_ID", field })`
- Trop long : `throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test convex/lib/pixelId.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/pixelId.ts packages/backend/convex/lib/pixelId.test.ts
git commit -m "feat(backend): valider les identifiants de pixels Meta et Google"
```

### Task 2: Noms DataForSEO dans secrets

**Files:**
- Modify: `packages/backend/convex/secrets.ts` (`SECRET_NOMS` + `nomValidator`)
- Modify: `packages/backend/.env.example` (documenter les deux noms ; « sept jetons » → neuf)
- Test: `packages/backend/convex/secrets.test.ts`

- [ ] **Step 1: Write the failing test**

Dans `secrets.test.ts`, ajouter :

```ts
test("DATAFORSEO_LOGIN et DATAFORSEO_PASSWORD sont des noms autorisés", async () => {
  const { identity } = await seedActor("owner")
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
  await identity.action(api.secrets.set, { nom: "DATAFORSEO_LOGIN", valeur: "login@exemple.fr" })
  await identity.action(api.secrets.set, { nom: "DATAFORSEO_PASSWORD", valeur: "mot-de-passe-api" })
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("base")
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_PASSWORD")?.source).toBe("base")
  expect(JSON.stringify(etat)).not.toContain("mot-de-passe-api")
})
```

`seedActor` (déjà dans le fichier) crée son `makeTestConvex()`. `beforeEach` pose déjà `SECRETS_KEY`. Ne pas en créer un second ni réassigner la clé.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test convex/secrets.test.ts`
Expected: FAIL — `DATAFORSEO_LOGIN` hors union.

- [ ] **Step 3: Write minimal implementation**

Ajouter les deux littéraux dans `SECRET_NOMS` **et** dans `nomValidator` (les deux listes, à la main). Documenter dans `.env.example` sur le même modèle qu'`OPENROUTER_API_KEY`. Ne pas ajouter de vérificateur dans `secretCheck.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test convex/secrets.test.ts`
Expected: PASS.

Run: `node scripts/check-env-wiring.mjs`
Expected: PASS. Ce script parse `SECRET_NOMS` et exige chaque nom dans `.env.example`. Sans les deux lignes DataForSEO, il échoue. Mettre à jour le commentaire « seven tokens » / « sept jetons » du même fichier.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/secrets.ts packages/backend/convex/secrets.test.ts packages/backend/.env.example
git commit -m "feat(backend): secrets DataForSEO (login et mot de passe API)"
```

### Task 3: Schéma + projections publiques

**Files:**
- Modify: `packages/backend/convex/schema.ts` (`settings` : `metaPixelId`, `googleTagId` optionnels)
- Modify: `packages/backend/convex/settings.ts` (`get`, `getPrivate`, **`update`**)
- Modify: `packages/backend/convex/settings.publicProjection.test.ts` (`AUTORISES`, `AUTORISES_PRIVE`, `semerLaLigneEntiere`)
- Test: `packages/backend/convex/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Dans `settings.test.ts` :

```ts
test("get expose metaPixelId et googleTagId : null si jamais saisis, \"\" si retirés", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  const vide = await t.query(api.settings.get, {})
  expect(vide?.metaPixelId).toBeNull()
  expect(vide?.googleTagId).toBeNull()

  await owner.identity.mutation(api.settings.update, {
    metaPixelId: "123456789012345",
    googleTagId: "AW-999",
  })
  const plein = await t.query(api.settings.get, {})
  expect(plein?.metaPixelId).toBe("123456789012345")
  expect(plein?.googleTagId).toBe("AW-999")

  await owner.identity.mutation(api.settings.update, { metaPixelId: null })
  const retire = await t.query(api.settings.get, {})
  expect(retire?.metaPixelId).toBe("")
  expect(retire?.googleTagId).toBe("AW-999")
  const privee = await owner.identity.query(api.settings.getPrivate, {})
  expect(privee?.metaPixelId).toBe("")
  expect(privee?.googleTagId).toBe("AW-999")
})

test("un editor lit les IDs et ne peut pas les écrire", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, {
    siteName: "Exemple",
    metaPixelId: "123456789012345",
  })
  const editor = await seedActor(t, "editor")
  expect((await editor.identity.query(api.settings.getPrivate, {}))?.metaPixelId).toBe(
    "123456789012345",
  )
  await expect(
    editor.identity.mutation(api.settings.update, { metaPixelId: "99999" }),
  ).rejects.toThrow()
})
```

Dans `publicProjection.test.ts` : ajouter `metaPixelId` et `googleTagId` à `AUTORISES` et `AUTORISES_PRIVE`, les semer dans `semerLaLigneEntiere` (un ID réel, pas `""` — un second insert ou un `update` ensuite pose `""` et vérifie que `get` le rend tel quel).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @astrotan/backend test convex/settings.test.ts convex/settings.publicProjection.test.ts`
Expected: FAIL — champs inconnus / absents de la projection.

- [ ] **Step 3: Write minimal implementation**

Schema :

```ts
metaPixelId: v.optional(v.string()),
googleTagId: v.optional(v.string()),
```

`get` / `getPrivate` :

```ts
metaPixelId: settings.metaPixelId ?? null,
googleTagId: settings.googleTagId ?? null,
```

`??` et non `||`. `update` : args `metaPixelId` / `googleTagId` en `v.optional(v.union(v.string(), v.null()))`.

**Extraire ces deux champs de `...rest`**, comme `logoId` / `declaredDomain` : `db.patch` refuse `null`. Après extraction, si `!== undefined`, `normaliserPixelId(...)` puis poser le `string` (y compris `""`) dans le patch. **Ne pas** copier le motif logo (`?? undefined`) : ça effacerait le champ et rouvrirait le repli `PUBLIC_*`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/settings.ts packages/backend/convex/settings.test.ts packages/backend/convex/settings.publicProjection.test.ts
git commit -m "feat(backend): IDs pixels dans settings, projetés par get"
```

### Task 4: Invalidation site quand un pixel change

**Files:**
- Modify: `packages/backend/convex/schema.ts` (`kind` outbox : ajouter `v.literal("site")`)
- Modify: `packages/backend/convex/revalidate.ts` (`OutboxTarget`)
- Modify: `packages/backend/convex/settings.ts` (`update` : outbox + `drain` si pixel modifié)
- Test: `packages/backend/convex/settings.test.ts`

@`.claude/skills/convex-function`

- [ ] **Step 1: Write the failing test**

```ts
import { getFunctionName } from "convex/server"
import { internal } from "./_generated/api"

test("changer un pixel enfile une outbox site et planifie drain", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  await owner.identity.mutation(api.settings.update, { metaPixelId: "123456789012345" })
  const rows = await t.run(async (ctx) => ctx.db.query("revalidationOutbox").collect())
  const site = rows.filter((r) => r.kind === "site")
  expect(site).toHaveLength(1)
  expect(site[0]?.tags).toEqual(["pages", "posts"])
  const expectedName = getFunctionName(internal.revalidate.drain)
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  expect(scheduled.some((job) => job.name === expectedName)).toBe(true)
})

test("renommer le site n'enfile pas d'outbox site", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.settings.update, { siteName: "Exemple" })
  await owner.identity.mutation(api.settings.update, { siteName: "Autre nom" })
  const rows = await t.run(async (ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows.filter((r) => r.kind === "site")).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test convex/settings.test.ts`
Expected: FAIL — aucune ligne `site`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type OutboxTarget =
  | { kind: "page"; pageId: Id<"pages"> | undefined }
  | { kind: "post"; postId: Id<"posts"> }
  | { kind: "site" }
```

`insertOutboxRow` : `pageId` / `postId` restent `undefined` pour `site`. `latestOutboxRow` : `if (target.kind === "site") return null` — pas de retry UI, mais le `else` actuel suppose `kind === "post"` et le typecheck casse sans cette branche.

Dans `settings.update`, après le patch, si `metaPixelId` ou `googleTagId` figure dans `champsModifies` : `insertOutboxRow(ctx, { kind: "site" }, ["pages", "posts"])` puis `ctx.scheduler.runAfter(0, internal.revalidate.drain, {})`.

`pages.publicationStatus` ne doit pas scanner `kind === "site"`. Vérifier le filtre existant ; ne pas y mêler ces lignes.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @astrotan/backend test convex/settings.test.ts convex/revalidate.test.ts convex/pages.publishPage.test.ts`
Expected: PASS. Pas de régression publication.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/revalidate.ts packages/backend/convex/settings.ts packages/backend/convex/settings.test.ts
git commit -m "feat(backend): invalider le cache public quand un pixel change"
```

---

## Chunk 2: Site public — fusion, bandeau, CSP

@`.claude/skills/consent-rgpd`

### Task 5: Helper `fusionnerPixels`

**Files:**
- Create: `apps/web/src/lib/pixelIds.ts`
- Test: `apps/web/src/lib/pixelIds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { choisirIdentifiant, fusionnerPixels } from "./pixelIds"

describe("choisirIdentifiant", () => {
  test("null ou undefined retombe sur le build", () => {
    expect(choisirIdentifiant(null, "123")).toBe("123")
    expect(choisirIdentifiant(undefined, "123")).toBe("123")
  })
  test("une chaîne vide gagne : le pixel est retiré, PUBLIC_* ignoré", () => {
    expect(choisirIdentifiant("", "123")).toBeUndefined()
  })
  test("un ID en base gagne", () => {
    expect(choisirIdentifiant("999", "123")).toBe("999")
  })
})

test("settings.get === null se lit comme jamais saisi", () => {
  const fused = fusionnerPixels(null, { PUBLIC_META_PIXEL_ID: "123", PUBLIC_GOOGLE_TAG_ID: "G-1" })
  expect(fused.PUBLIC_META_PIXEL_ID).toBe("123")
  expect(fused.PUBLIC_GOOGLE_TAG_ID).toBe("G-1")
})

test("fusionnerPixels : null / \"\" / ID sur l'objet projeté", () => {
  const env = { PUBLIC_META_PIXEL_ID: "build-meta", PUBLIC_GOOGLE_TAG_ID: "G-BUILD" }
  expect(fusionnerPixels({ metaPixelId: null, googleTagId: null }, env).PUBLIC_META_PIXEL_ID).toBe(
    "build-meta",
  )
  expect(fusionnerPixels({ metaPixelId: "", googleTagId: "AW-1" }, env).PUBLIC_META_PIXEL_ID).toBeUndefined()
  expect(fusionnerPixels({ metaPixelId: "", googleTagId: "AW-1" }, env).PUBLIC_GOOGLE_TAG_ID).toBe("AW-1")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/web test src/lib/pixelIds.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

`choisirIdentifiant(enBase, auBuild)` selon la spec §3. `fusionnerPixels` recopie `env` (Umami inchangé) et remplace les deux `PUBLIC_*` pixels. Fichier < 80 lignes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/web test src/lib/pixelIds.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/pixelIds.ts apps/web/src/lib/pixelIds.test.ts
git commit -m "feat(web): fusionner IDs pixels settings et PUBLIC_*"
```

### Task 6: Brancher le bandeau, Consent Mode, cookies

**Files:**
- Create: `apps/web/src/lib/consentClientEnv.ts`
- Create: `apps/web/src/lib/consentClientEnv.test.ts`
- Modify: `apps/web/src/components/consent/ConsentBanner.astro`
- Modify: `apps/web/src/components/consent/GoogleConsentMode.astro`
- Modify: `apps/web/src/pages/cookies.astro`

`ConsentBanner.astro` a déjà 650+ lignes : on n'y extrait pas pour « passer sous 200 », on extrait `envDepuisBandeau` pour que le script client soit testable. **Ne pas** poser les IDs sur `[data-consent-meta]` (il porte déjà l'horodatage du choix). Les poser sur `[data-consent-banner]`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest"
import { envDepuisBandeau } from "./consentClientEnv"

const BUILD = {
  PUBLIC_UMAMI_URL: "https://stats.exemple.fr",
  PUBLIC_UMAMI_WEBSITE_ID: "site-1",
  PUBLIC_META_PIXEL_ID: "build-meta",
  PUBLIC_GOOGLE_TAG_ID: "G-BUILD",
}

test("un attribut vide est un retrait, pas un repli sur le build", () => {
  const env = envDepuisBandeau({ metaPixelId: "", googleTagId: "" }, BUILD)
  expect(env.PUBLIC_META_PIXEL_ID).toBeUndefined()
  expect(env.PUBLIC_GOOGLE_TAG_ID).toBeUndefined()
  expect(env.PUBLIC_UMAMI_URL).toBe(BUILD.PUBLIC_UMAMI_URL)
})

test("un attribut posé est l'ID effectif", () => {
  const env = envDepuisBandeau({ metaPixelId: "123", googleTagId: "AW-1" }, BUILD)
  expect(env.PUBLIC_META_PIXEL_ID).toBe("123")
  expect(env.PUBLIC_GOOGLE_TAG_ID).toBe("AW-1")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/web test src/lib/consentClientEnv.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Wire**

`envDepuisBandeau` : pixels **uniquement** depuis le dataset (chaîne vide → `undefined`). Umami depuis `build`.

Frontmatter de `ConsentBanner.astro` (aujourd'hui `import.meta.env` aux lignes 29–33) :

```ts
const settings = await getConvexClient().query(api.settings.get, {})
const fused = fusionnerPixels(settings, import.meta.env)
const categories = activeCategories(fused, consentConfig.googleConsentMode.enabled)
const ask = shouldAskConsent(fused, consentConfig.googleConsentMode.enabled)
```

Sur `[data-consent-banner]` : `data-meta-pixel-id={fused.PUBLIC_META_PIXEL_ID ?? ""}` et `data-google-tag-id={fused.PUBLIC_GOOGLE_TAG_ID ?? ""}`.

Dans le `<script>` : remplacer le bloc `PUBLIC_META_PIXEL_ID: import.meta.env…` par `envDepuisBandeau(banner.dataset, { PUBLIC_UMAMI_*: import.meta.env… })`. Sans ça le bandeau s'affiche et le clic n'injecte rien.

`GoogleConsentMode.astro` : `enabled` si Consent Mode **et** `fusionnerPixels(…).PUBLIC_GOOGLE_TAG_ID`. `cookies.astro` : `consentTags(fused, …)`. **Ne pas** incrémenter `consentVersion`.

- [ ] **Step 4: Run**

`pnpm --filter @astrotan/web test src/lib/consent.test.ts src/lib/pixelIds.test.ts src/lib/consentClientEnv.test.ts`
Expected: PASS. `consentVersion` toujours `"1.0.0"` dans `config/consent.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/consentClientEnv.ts apps/web/src/lib/consentClientEnv.test.ts apps/web/src/components/consent/ConsentBanner.astro apps/web/src/components/consent/GoogleConsentMode.astro apps/web/src/pages/cookies.astro
git commit -m "feat(web): le bandeau lit les IDs pixels depuis settings"
```

### Task 7: CSP middleware

**Files:**
- Modify: `apps/web/src/middleware.ts` (mémo pixels 60 s, passer l'env fusionné à `enTetesSecurite`)
- Modify: `apps/web/src/pages/api/revalidate.ts` (`purgePixelMemo` à côté de `purgeRedirectMemo`)
- Test: `apps/web/src/middleware.test.ts` et / ou `apps/web/src/lib/securityHeaders.test.ts`

`enTetesSecurite` ne change pas de contrat : il lit déjà `PUBLIC_META_PIXEL_ID` / `PUBLIC_GOOGLE_TAG_ID`. C'est l'`env` qu'on lui passe qui devient fusionné.

- [ ] **Step 1: Write the failing tests**

Dans `securityHeaders.test.ts` (importer `fusionnerPixels`) :

```ts
test("un ID venu de settings ouvre la CSP Meta, le PUBLIC_* vide ne compte pas", () => {
  const fused = fusionnerPixels({ metaPixelId: "123456789012345", googleTagId: null }, ENV)
  const csp = enTetesSecurite("abc123", fused)["Content-Security-Policy"]!
  expect(csp).toContain("facebook")
  expect(csp).not.toContain("google")
})
```

Dans `middleware.test.ts` : le mock actuel est `query: listActive` pour **toutes** les queries. `settings.get` recevrait alors un tableau de redirections. Dispatcher :

```ts
import { api } from "@astrotan/backend/convex/_generated/api"
query: (fn: unknown) => {
  if (fn === api.settings.get) return Promise.resolve(null)
  return listActive()
}
```

Comparer les références (`api.settings.get`, `api.redirects.listActive`), jamais `includes("get")`. Défaut settings = `null` (pas de pixel → CSP inchangée, les tests de redirection restent vrais).

Dans `apps/web/src/pages/api/_tests/revalidate.test.ts` : après un POST valide, `purgePixelMemo` a été appelé (spy sur l'export, même motif que `purgeRedirectMemo` s'il est déjà testé).

- [ ] **Step 2: Run**

`pnpm --filter @astrotan/web test src/lib/securityHeaders.test.ts src/middleware.test.ts src/pages/api/_tests/revalidate.test.ts`
Expected: FAIL sur le nouveau test CSP settings ; les redirections peuvent casser si le mock n'est pas encore dispatché — c'est le signal de l'étape 3.

- [ ] **Step 3: Implement memo + purge**

Même TTL que les redirections (60 s). `onRequest` : lire `settings.get` (mémo), `fusionnerPixels`, `enTetesSecurite(nonce, fused, https)`. Exporter `purgePixelMemo`. L'appeler dans `/api/revalidate` à côté de `purgeRedirectMemo`.

- [ ] **Step 4: Run tests**

Expected: PASS. Le test « sans identifiant, ni Google ni Meta » reste vrai pour `ENV` sans settings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/middleware.ts apps/web/src/pages/api/revalidate.ts apps/web/src/lib/securityHeaders.test.ts apps/web/src/middleware.test.ts apps/web/src/pages/api/_tests/revalidate.test.ts
git commit -m "feat(web): la CSP suit les IDs pixels saisis à l'écran"
```

---

## Chunk 3: Dashboard — écran SEO & Pixel

### Task 8: Libellé nav + erreurs

**Files:**
- Modify: `apps/admin/src/components/settings-nav.tsx`
- Modify: `apps/admin/src/lib/settingsErrors.ts`
- Test: `apps/admin/src/components/settings-nav.test.tsx`
- Test: créer `apps/admin/src/lib/settingsErrors.test.ts` s'il n'existe pas

- [ ] **Step 1: Write the failing tests**

```ts
// settings-nav : le chemin reste /settings/mesure
expect(SETTINGS_PAGES.find((p) => p.to === "/settings/mesure")).toMatchObject({
  label: "SEO & Pixel",
  title: "SEO & Pixel",
  description: "",
})
```

```ts
import { ConvexError } from "convex/values"
import { describeSettingsError } from "./settingsErrors"

test("INVALID_PIXEL_ID a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_PIXEL_ID", field: "metaPixelId" })),
  ).toMatch(/pixel|identifiant/i)
})
```

- [ ] **Step 2: Run to verify fail**

`pnpm --filter @astrotan/admin test src/components/settings-nav.test.tsx src/lib/settingsErrors.test.ts`
Expected: FAIL — ancien libellé / code inconnu → « Une erreur inattendue ».

- [ ] **Step 3: Implement**

Nav : label/title `SEO & Pixel`, description `""`. Erreur : `INVALID_PIXEL_ID` → « Cet identifiant n'a pas la forme attendue (chiffres pour Meta, G-/AW-/GT-/DC- pour Google). »

- [ ] **Step 4: Pass**

Expected: PASS. Le test « titre commence par le libellé » reste vert (` & ` identique).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/settings-nav.tsx apps/admin/src/components/settings-nav.test.tsx apps/admin/src/lib/settingsErrors.ts apps/admin/src/lib/settingsErrors.test.ts
git commit -m "feat(admin): libellé SEO & Pixel et erreur d'identifiant"
```

### Task 9: Corps de page `SeoPixelPage` + retrait Umami

**Files:**
- Create: `apps/admin/src/components/settings-seo-pixel.tsx` (liste + `estDataForSeoConfigure` + import `actionSurLigne`)
- Modify: `apps/admin/src/components/email-templates.tsx` (`ouverte` / `cible` élargis à `string` si besoin)
- Create: `apps/admin/src/components/seo-pixel-ligne.tsx` (`LigneDataForSeo`, `LignePixel` — un fichier, < 200 lignes)
- Create: `apps/admin/src/components/settings-seo-pixel.test.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/mesure.tsx`
- Modify: `apps/admin/src/components/settings-environment.tsx` (supprimer **toute** `MeasurementPage`)
- Modify: `apps/admin/src/components/settings-environment.test.tsx` — voir la liste exacte ci-dessous

UX = emails : trois lignes toujours visibles (DataForSEO, Pixel Meta, Google Ads), une dépliée, peu de texte. `ChampSecret` pour DataForSEO. IDs pixels = `<Input type="text">`. Placeholder Google : `AW-…` / `G-…`. Un « Retirer » sur la ligne DataForSEO appelle `onClear` des **deux** noms. Conséquence : « Ces identifiants ne serviront plus. Le site public ne casse pas. » Sans `SECRETS_KEY` : même phrase que Resend (`CleMaitresseBandeau`). Replier une ligne sale : **réutiliser `actionSurLigne`** de `email-templates.tsx` (déjà exporté et testé) — ne pas réécrire la décision.

`mesure.tsx` : `getPrivate` + `useSecretsAccess`. **Ne plus** appeler `settings.environment` : `umamiApi` n'a plus de lecteur.

**Dans `settings-environment.test.tsx`, tout ça casse si on ne le fait pas :**
1. Retirer l'entrée « Mesure & pixels » de `pages()`.
2. Supprimer `describe("MeasurementPage")` entier.
3. Supprimer `describe("les variables hors de portée")` entier (il rend `<MeasurementPage />` et exige les noms `PUBLIC_*` — ces IDs sont maintenant saisissables).
4. `chaque page qui liste plusieurs jetons` : `listes` = `pages()` sans emails. Après retrait, il ne reste que IA → `expect(listes.length).toBe(1)`.
5. Retirer l'import `MeasurementPage` et les constantes `UMAMI_CONFIGURE` / `UMAMI_ABSENT` devenues mortes.

- [ ] **Step 1: Write the failing tests** (`settings-seo-pixel.test.tsx`)

```ts
import { renderToStaticMarkup } from "react-dom/server"
import { actionSurLigne } from "./email-templates"
import { SeoPixelPage, estDataForSeoConfigure } from "./settings-seo-pixel"

test("les trois lignes sont là, Umami n'y est plus", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      canWrite
      secrets={blocVide}
      metaPixelId={null}
      googleTagId={null}
      onSaveSecret={async () => {}}
      onClearSecret={async () => {}}
      onSavePixel={async () => {}}
    />,
  )
  expect(html).toContain("DataForSEO")
  expect(html).toContain("Pixel Meta")
  expect(html).toContain("Google Ads")
  expect(html).not.toContain("UMAMI_API")
  expect(html).not.toContain("PUBLIC_UMAMI")
  expect(html).not.toContain("PUBLIC_META_PIXEL_ID")
})

test("DataForSEO n'est configuré que si les deux secrets ont une source", () => {
  expect(estDataForSeoConfigure({
    DATAFORSEO_LOGIN: { source: "base" },
    DATAFORSEO_PASSWORD: { source: "aucune" },
  })).toBe(false)
  expect(estDataForSeoConfigure({
    DATAFORSEO_LOGIN: { source: "base" },
    DATAFORSEO_PASSWORD: { source: "environnement" },
  })).toBe(true)
})

test("un editor voit l'ID et aucun bouton d'écriture", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      canWrite={false}
      secrets={{ cleMaitresse: null, etats: {}, canWrite: false, onSave: async () => {}, onClear: async () => {} }}
      metaPixelId="123"
      googleTagId={null}
      onSaveSecret={async () => {}}
      onClearSecret={async () => {}}
      onSavePixel={async () => {}}
    />,
  )
  expect(html).toMatch(/réservé/i)
  expect(html).toContain("123")
  expect(html).not.toContain("Enregistrer")
  expect(html).not.toContain("Supprimer")
})

test("settings-seo-pixel réutilise actionSurLigne, il ne le recopie pas", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(new URL("./settings-seo-pixel.tsx", import.meta.url), "utf8")
  expect(src).toContain("actionSurLigne")
  expect(src).toMatch(/email-templates/)
})
```

`blocVide` : recopier le `bloc()` de `settings-environment.test.tsx` (`cleMaitresse: "posee"`). `actionSurLigne` reste typé `CleEmail` dans `email-templates.tsx` : élargir `ouverte` / `cible` à `string` (un seul changement, les tests emails restent vrais). Les cas confirmer / replier / ouvrir sont déjà dans `email-templates.test.tsx` — ne pas les dupliquer.

- [ ] **Step 2: Run to verify fail**

`pnpm --filter @astrotan/admin test src/components/settings-seo-pixel.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implement**

Route < 80 lignes. `settings-seo-pixel.tsx` + `seo-pixel-ligne.tsx` < 200 chacun. Confirmation au repli : `AlertDialog` comme `emails.tsx`, pas `window.confirm`. Editor : `cleMaitresse === null` → phrase « réservé », comme Resend — la route peut passer le bloc secrets même à un editor, c'est `cleMaitresse` qui décide. Un « Retirer » de ligne DataForSEO suffit (les deux noms) ; masquer les retraits unitaires de `ChampSecret` si trois gestes se marchent dessus.

- [ ] **Step 4: Run**

`pnpm --filter @astrotan/admin test src/components/settings-seo-pixel.test.tsx src/components/settings-environment.test.tsx src/components/settings-nav.test.tsx src/components/email-templates.test.tsx`
Expected: PASS. Si `settings-environment.test.tsx` ne compile plus (`MeasurementPage is not defined`), relire la liste des 5 suppressions plus haut.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/settings-seo-pixel.tsx apps/admin/src/components/seo-pixel-ligne.tsx apps/admin/src/components/settings-seo-pixel.test.tsx apps/admin/src/routes/_authed/settings/mesure.tsx apps/admin/src/components/settings-environment.tsx apps/admin/src/components/settings-environment.test.tsx apps/admin/src/components/email-templates.tsx
git commit -m "feat(admin): écran SEO & Pixel, Umami retiré des réglages"
```

---

## Recette manuelle (après toutes les tâches)

URL : `/settings/mesure`

1. Owner : ajouter un pixel Meta, enregistrer. Après invalidation, le HTML public n'a toujours pas `connect.facebook.net` ; le bandeau apparaît ; « Tout accepter » injecte le pixel.
2. Ajouter DataForSEO (login + mot de passe). Aucune query ne contient le mot de passe.
3. Supprimer le pixel. Le bandeau disparaît si Google n'est pas posé. Un `PUBLIC_META_PIXEL_ID` de build ne revient pas.
4. Editor : voit les IDs, ne les écrit pas, ne voit pas DataForSEO.
