# Lisibilité SEO de l’article Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur `/posts/$postId`, un panneau à droite de la zone Contenu liste ce qui manque ou à améliorer (Yoast SEO + lisibilité), un bandeau de faits Labs/Umami/rang déjà en base, et une checklist GEO limitée aux champs existants — sans écrire dans le document.

**Architecture:** `yoastseo@3.6.0` (GPL-3.0) tourne uniquement dans l’action Convex `seoAnalyze.analyze` (`"use node"` + `externalPackages`), jamais dans le bundle admin. Le panneau React debounce 1,5 s et envoie titre, extrait, HTML Tiptap, mot-clé, titre/meta SEO, slug. H1 public = `post.title` (`textTitle`) ; le corps reste H2/H3. Labs, Umami et `seoRanks` restent un bandeau de faits à côté, jamais mélangés au score Yoast, jamais d’On-Page Instant Pages à la frappe, jamais de courbe inventée. La checklist GEO est une fonction pure côté admin sur `geo.*` déjà saisis. « Générer SEO/GEO » écrit ; ce panneau juge.

**Tech Stack:** Convex action Node, `yoastseo@3.6.0` (`Paper`, `SeoAssessor`, `ContentAssessor`, Researcher FR), TanStack Form + `useAction`/`useQuery` Convex (pas TanStack Query), React 19 / shadcn Card. Skills `@.claude/skills/convex-function`, `@.agents/skills/superpowers/subagent-driven-development`, `@.agents/skills/superpowers/test-driven-development`.

**Produit :** validé par Antoine, 2026-09-01. Pas de spec séparée — les décisions sont dans ce plan.

---

## Contraintes

- TDD. Fichiers nouveaux < 200 lignes. Helpers purs sous `convex/lib/` sauf le wrapper Yoast (voir plus bas).
- UI FR, code EN, commits Conventional Commits en français.
- `apps/web` inchangé. Pas de second CMS, pas de champ `posts` ajouté.
- Pas de TanStack Query / TanStack DB.
- Template : aucune URL/domaine en dur. Permalink = `WEB_SITE_URL` Convex + `/blog/${slug}` (même convention que `ai.generateSeoGeo`).
- Ne pas lancer `npx convex dev` interactif. Après `convex/seoAnalyze.ts`, un humain pousse (`npx convex dev --once`) — `tsc` et vitest ne voient pas ce que le runtime refuse.
- `$postId.tsx` fait déjà ~1188 lignes : n’y ajouter qu’un enfant et une classe de grille.

## Licence GPL-3.0

`yoastseo` est **GPL-3.0** (npm 3.6.0, 2026-02-13). Conséquences figées ici :

- Dépendance **backend only** : `packages/backend/package.json`. Jamais `apps/admin` ni `apps/web`.
- Le commentaire d’en-tête de `convex/lib/yoastRun.ts` mentionne GPL-3.0 et l’interdiction de l’importer depuis un bundle navigateur.
- Le dépôt publie déjà le source du wrapper. On ne redistribute pas le binaire Yoast hors de l’action Convex.
- Ne pas copier du code Yoast dans l’admin « pour aller plus vite ». Les libellés FR sont les nôtres, indexés par `identifier`.

## API Yoast réelle (npm 3.6.0 — pas le README GitHub)

Context7 n’indexe pas le package. Vérifié sur unpkg `yoastseo@3.6.0` (2026-09-01) :

| Surface GitHub `main` (plus récente) | npm **3.6.0** |
|---|---|
| `import getResearcher from "yoastseo/researcher"` | **404** — le dossier `researcher/` n’est pas publié |
| `import { toPaper, toResultDto } from "yoastseo/contract"` | **absent** |
| `runAssessment(...)` | **non exporté** du `build/index.js` |

API à utiliser :

```js
import { Paper, SeoAssessor, ContentAssessor, interpreters } from "yoastseo"
import FrenchResearcher from "yoastseo/build/languageProcessing/languages/fr/Researcher"

const paper = new Paper(html, {
  keyword, description, title, slug, permalink, locale: "fr_FR", textTitle,
})
const researcher = new FrenchResearcher(paper)
const seo = new SeoAssessor(researcher)
seo.assess(paper)
const results = seo.getValidResults()
// result.getIdentifier() / getScore() / getText()
// interpreters.scoreToRating(score) → "error" | "feedback" | "bad" | "ok" | "good"
```

`Paper` 3.6.0 accepte `textTitle` (H1 public) distinct de `title` (titre SEO). `url` est déprécié : on passe `slug`. `titleWidth` par défaut `0` → `hasTitleWidth()` est faux : on **écarte** l’identifier de largeur de titre (pas de canvas côté Convex ; le champ admin est déjà borné à `MAX_SEO_TITLE_LENGTH`).

Researcher FR : `constructor(paper)` puis `SeoAssessor(researcher)`. Inclusive language : anglais seulement — ne pas lancer cet assessor.

## Décisions GEO — seulement le modèle existant

Lu : `geoValidator` (`content.ts`), éditeur `$postId.tsx`, `generateSeoGeo` / `seoGeoDraft`, `articleJsonLd` / `faqJsonLd` / `PageHead.astro`.

| Critère évoqué | Champ / émission existante | Dans la checklist ? |
|---|---|---|
| Résumé pour machines | `geo.summary` | oui — vide = manque |
| Entités | `geo.entities` | oui — aucune = manque |
| FAQ | `geo.faq` (JSON-LD `FAQPage`) | oui — aucune paire complète = manque |
| `noai` | `geo.noai` coupe résumé, keywords et tout JSON-LD | oui — si vrai, avertir (pas un « manque ») |
| Schéma `FAQPage` | dérivé de `geo.faq` + `!noai` | oui — même signal que FAQ, libellé distinct |
| Schéma `Article` | émis si `publishedAt` et `!noai` | oui — info, pas un champ à saisir |
| Citations / faits vérifiables | **aucun champ** | **non** |
| Auteur | `createdBy` système ; retiré de `ArticleHero` ; `articleJsonLd` n’émet pas `author` | **non** — pas un champ éditable |

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/package.json` | dep `yoastseo@3.6.0` uniquement ici |
| `packages/backend/convex.json` | `node.externalPackages: ["yoastseo"]` |
| `packages/backend/types/yoastseo.d.ts` | types minimaux (3.6 ne publie pas `types/`) |
| `packages/backend/convex/lib/yoastPaper.ts` | champs formulaire → attributs `Paper` (sans importer yoastseo) |
| `packages/backend/convex/lib/yoastFindings.ts` | résultats bruts → findings (filtre rating, drop `titleWidth`) |
| `packages/backend/convex/lib/yoastRun.ts` | **seul** import `yoastseo` ; GPL en tête |
| `packages/backend/convex/seoAnalyze.ts` | action `"use node"` : rôle, bornes, permalink, stub registre |
| `packages/backend/convex/seoAnalyze.test.ts` | auth, bornes, stub — **sans** charger Yoast |
| `packages/backend/convex/lib/yoastPaper.test.ts` | mapping permalink / H1 |
| `packages/backend/convex/lib/yoastFindings.test.ts` | filtre ratings |
| `packages/backend/yoast/run.test.ts` | intégration Node réelle (hors `convex/` + `@vitest-environment node`) |
| `packages/backend/testing/registryModules.ts` | `import "../convex/seoAnalyze"` |
| `packages/backend/convex/_registry.test.ts` | SKIP `lib/yoastRun.ts` (edge-runtime) |
| `apps/admin/src/lib/useDebouncedValue.ts` | debounce 1500 ms |
| `apps/admin/src/lib/yoastLabels.ts` | identifier → libellé FR |
| `apps/admin/src/lib/geoChecklist.ts` | heuristiques GEO pures |
| `apps/admin/src/components/post-seo-findings.tsx` | liste manque / à améliorer |
| `apps/admin/src/components/post-seo-facts.tsx` | bandeau Labs / Umami / rang |
| `apps/admin/src/components/post-geo-checklist.tsx` | checklist GEO |
| `apps/admin/src/components/post-coach-panel.tsx` | orchestre debounce + action + les trois blocs |
| `apps/admin/src/routes/_authed/posts/$postId.tsx` | grille Contenu : éditeur \| panneau |

Chemins lus, ne pas les inventer :

- Éditeur : `apps/admin/src/routes/_authed/posts/$postId.tsx` (carte Contenu ~639–677)
- H1 public : `apps/web/src/components/blog/ArticleHero.astro` ; pas de H1 Tiptap : `rich-text-editor.tsx:446-449`
- Bornes : `packages/backend/convex/content.ts` (`MAX_*`)
- Permalink articles : `ai.ts:73-75` (`WEB_SITE_URL` + `/blog/${slug}`)
- Audience déjà queryable : `analytics-panel.tsx` (`analytics.forPath`, `seoRanks.forDocument`)
- Labs site : `seoRanks.siteSnapshot` / `assembleSiteSnapshot` (`keywords`, `rankingPages`)
- JSON-LD : `apps/web/src/lib/jsonLd.ts`, `PageHead.astro:123-139`
- Registre : `convex/_registry.ts`, `testing/registryModules.ts`, `lib/authz.test.ts`
- Vitest backend : `environment: "edge-runtime"` (`packages/backend/vitest.config.ts`)

---

## Chunk 1: Dépendance Yoast, Paper, findings, wrapper

### Task 1: Dépendance GPL et types

**Files:**
- Modify: `packages/backend/package.json` (via pnpm)
- Create: `packages/backend/convex.json`
- Create: `packages/backend/types/yoastseo.d.ts`
- Modify: `packages/backend/tsconfig.json`

- [ ] **Step 1: Installer yoastseo dans le backend seulement**

```bash
pnpm --filter @astrotan/backend add yoastseo@3.6.0
```

Expected: `packages/backend/package.json` contient `"yoastseo": "3.6.0"`. `apps/admin/package.json` et `apps/web/package.json` **n’ont pas** cette ligne.

- [ ] **Step 2: Vérifier l’absence côté admin**

```bash
rg -n '"yoastseo"' apps/admin/package.json apps/web/package.json
```

Expected: aucun match.

- [ ] **Step 3: `convex.json` — paquet externe Node**

Créer `packages/backend/convex.json` :

```json
{
  "node": {
    "externalPackages": ["yoastseo"]
  }
}
```

Sans ça, esbuild essaierait de bundler 5,2 Mo de CJS + JSON de langues.

- [ ] **Step 4: Types minimaux + include tsconfig**

`packages/backend/types/yoastseo.d.ts` (le package 3.6 annonce `"types": "types"` mais le dossier n’est pas dans `files`) :

```ts
declare module "yoastseo" {
  export class Paper {
    constructor(
      text: string,
      attributes?: {
        keyword?: string
        synonyms?: string
        description?: string
        title?: string
        titleWidth?: number
        slug?: string
        locale?: string
        permalink?: string
        textTitle?: string
      },
    )
  }
  export class SeoAssessor {
    constructor(researcher: unknown, options?: object)
    assess(paper: Paper): void
    getValidResults(): YoastAssessmentResult[]
  }
  export class ContentAssessor {
    constructor(researcher: unknown, options?: object)
    assess(paper: Paper): void
    getValidResults(): YoastAssessmentResult[]
  }
  export const interpreters: {
    scoreToRating: (
      score: number,
    ) => "error" | "feedback" | "bad" | "ok" | "good"
  }
}

declare module "yoastseo/build/languageProcessing/languages/fr/Researcher" {
  import type { Paper } from "yoastseo"
  export default class FrenchResearcher {
    constructor(paper: Paper)
  }
}

export type YoastAssessmentResult = {
  getIdentifier: () => string
  getScore: () => number
  getText: () => string
}
```

Dans `packages/backend/tsconfig.json`, ajouter `"types"` à `include` :

```json
"include": ["convex", "testing", "e2e", "types", "yoast", "vitest.config.ts", "vitest.e2e.config.ts"]
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/convex.json packages/backend/types/yoastseo.d.ts packages/backend/tsconfig.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(backend): ajouter yoastseo 3.6 en dépendance Node GPL-3

Le moteur SEO reste hors du bundle admin (~5 Mo). externalPackages
évite de faire bundler le CJS par esbuild.
EOF
)"
```

### Task 2: Mapping Paper (sans yoastseo)

**Files:**
- Create: `packages/backend/convex/lib/yoastPaper.ts`
- Test: `packages/backend/convex/lib/yoastPaper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { paperAttributes, postPermalink } from "./yoastPaper"

describe("postPermalink", () => {
  test("origine Convex + /blog/slug, sans slash double", () => {
    expect(postPermalink("https://exemple.fr/", "bonjour")).toBe(
      "https://exemple.fr/blog/bonjour",
    )
  })

  test("sans origine : pas d'URL inventée", () => {
    expect(postPermalink(undefined, "bonjour")).toBe("")
    expect(postPermalink("", "bonjour")).toBe("")
  })
})

describe("paperAttributes", () => {
  test("H1 public = title, titre SEO = seoTitle, locale fr_FR", () => {
    const attrs = paperAttributes({
      title: "Le vrai H1",
      seoTitle: "Titre SERP",
      seoDescription: "Meta.",
      targetKeyword: "astro",
      slug: "le-vrai-h1",
      webOrigin: "https://exemple.fr",
    })
    expect(attrs.textTitle).toBe("Le vrai H1")
    expect(attrs.title).toBe("Titre SERP")
    expect(attrs.description).toBe("Meta.")
    expect(attrs.keyword).toBe("astro")
    expect(attrs.slug).toBe("le-vrai-h1")
    expect(attrs.locale).toBe("fr_FR")
    expect(attrs.permalink).toBe("https://exemple.fr/blog/le-vrai-h1")
  })

  test("sans titre SEO, Paper.title retombe sur le H1", () => {
    const attrs = paperAttributes({
      title: "H1 seul",
      seoTitle: "  ",
      seoDescription: "",
      targetKeyword: "",
      slug: "h1-seul",
      webOrigin: undefined,
    })
    expect(attrs.title).toBe("H1 seul")
    expect(attrs.textTitle).toBe("H1 seul")
    expect(attrs.permalink).toBe("")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/lib/yoastPaper.test.ts
```

Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
export type PaperFields = {
  title: string
  seoTitle: string
  seoDescription: string
  targetKeyword: string
  slug: string
  webOrigin?: string
}

export type PaperAttributes = {
  keyword: string
  description: string
  title: string
  slug: string
  permalink: string
  locale: "fr_FR"
  textTitle: string
}

export function postPermalink(webOrigin: string | undefined, slug: string): string {
  const base = webOrigin?.trim().replace(/\/+$/, "") ?? ""
  if (base.length === 0 || slug.trim().length === 0) return ""
  return `${base}/blog/${slug.trim()}`
}

export function paperAttributes(fields: PaperFields): PaperAttributes {
  const title = fields.title.trim()
  const seoTitle = fields.seoTitle.trim()
  return {
    keyword: fields.targetKeyword.trim(),
    description: fields.seoDescription.trim(),
    title: seoTitle || title,
    slug: fields.slug.trim(),
    permalink: postPermalink(fields.webOrigin, fields.slug),
    locale: "fr_FR",
    textTitle: title,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/lib/yoastPaper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/yoastPaper.ts packages/backend/convex/lib/yoastPaper.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): mapper les champs article vers les attributs Paper Yoast

Le H1 public reste post.title ; le permalink lit WEB_SITE_URL, jamais
un domaine en dur.
EOF
)"
```

### Task 3: Filtre des findings

**Files:**
- Create: `packages/backend/convex/lib/yoastFindings.ts`
- Test: `packages/backend/convex/lib/yoastFindings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { toFindings, type RawAssessment } from "./yoastFindings"

function raw(
  identifier: string,
  rating: RawAssessment["rating"],
): RawAssessment {
  return { identifier, rating, score: 3 }
}

describe("toFindings", () => {
  test("garde bad/ok/error, ignore good/feedback, drop titleWidth", () => {
    const out = toFindings([
      raw("keyphraseLength", "bad"),
      raw("textLength", "ok"),
      raw("titleWidth", "bad"),
      raw("pageTitleWidth", "bad"),
      raw("introductionKeyword", "good"),
      raw("transitionWords", "feedback"),
      raw("singleH1", "error"),
    ])
    expect(out.map((f) => f.identifier)).toEqual([
      "keyphraseLength",
      "textLength",
      "singleH1",
    ])
    expect(out[0]).toEqual({
      identifier: "keyphraseLength",
      severity: "missing",
      rating: "bad",
    })
    expect(out[1]?.severity).toBe("improve")
    expect(out[2]?.severity).toBe("missing")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/lib/yoastFindings.test.ts
```

Expected: FAIL — module introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
export type YoastRating = "error" | "feedback" | "bad" | "ok" | "good"

export type RawAssessment = {
  identifier: string
  rating: YoastRating
  score: number
}

export type FindingSeverity = "missing" | "improve"

export type SeoFinding = {
  identifier: string
  severity: FindingSeverity
  rating: YoastRating
}

const DROPPED = new Set(["titleWidth", "pageTitleWidth"])

export function toFindings(raw: RawAssessment[]): SeoFinding[] {
  const findings: SeoFinding[] = []
  for (const item of raw) {
    if (DROPPED.has(item.identifier)) continue
    if (item.rating === "good" || item.rating === "feedback") continue
    if (item.rating !== "bad" && item.rating !== "ok" && item.rating !== "error") {
      continue
    }
    findings.push({
      identifier: item.identifier,
      severity: item.rating === "ok" ? "improve" : "missing",
      rating: item.rating,
    })
  }
  return findings
}
```

Pas de score agrégé dans le contrat. La liste est le produit.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/lib/yoastFindings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/yoastFindings.ts packages/backend/convex/lib/yoastFindings.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): filtrer les assessments Yoast vers manque / à améliorer

On n'expose pas un score unique. titleWidth est écarté : pas de
mesure en pixels côté Convex.
EOF
)"
```

### Task 4: Wrapper Yoast isolé

**Files:**
- Create: `packages/backend/convex/lib/yoastRun.ts`
- Create: `packages/backend/yoast/run.test.ts`
- Modify: `packages/backend/convex/_registry.test.ts`

- [ ] **Step 1: Write the failing Node integration test**

`packages/backend/yoast/run.test.ts` — **hors** `convex/` (invariant : un helper qui tire `import.meta` / un gros CJS ne vit pas comme fixture sous `convex/`). Le fichier de prod `yoastRun.ts` reste sous `lib/` parce que l’action Convex ne peut importer que `convex/` + `node_modules`.

```ts
/** @vitest-environment node */
import { expect, test } from "vitest"
import { runYoastAnalysis } from "../convex/lib/yoastRun"

test("un article FR sans mot-clé ni meta produit des findings", async () => {
  const { findings } = runYoastAnalysis({
    bodyHtml: "<h2>Section</h2><p>Un court paragraphe sans mot-clé cible.</p>",
    title: "Titre public de l article",
    seoTitle: "",
    seoDescription: "",
    targetKeyword: "",
    slug: "titre-public",
    webOrigin: "https://exemple.fr",
  })
  expect(findings.length).toBeGreaterThan(0)
  expect(findings.every((f) => f.identifier.length > 0)).toBe(true)
  expect(findings.some((f) => f.identifier === "titleWidth")).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend exec vitest run yoast/run.test.ts
```

Expected: FAIL — `yoastRun` introuvable.

- [ ] **Step 3: Write `yoastRun.ts`**

```ts
// yoastseo (GPL-3.0) — backend / action Node uniquement.
// Ne jamais importer ce module depuis apps/admin ou apps/web.
import { ContentAssessor, interpreters, Paper, SeoAssessor } from "yoastseo"
import FrenchResearcher from "yoastseo/build/languageProcessing/languages/fr/Researcher"
import { paperAttributes, type PaperFields } from "./yoastPaper"
import { toFindings, type RawAssessment, type SeoFinding } from "./yoastFindings"

export type YoastInput = PaperFields & { bodyHtml: string }

export type YoastOutput = { findings: SeoFinding[] }

function collect(assessor: {
  getValidResults: () => {
    getIdentifier: () => string
    getScore: () => number
  }[]
}): RawAssessment[] {
  return assessor.getValidResults().map((result) => ({
    identifier: result.getIdentifier(),
    score: result.getScore(),
    rating: interpreters.scoreToRating(result.getScore()),
  }))
}

export function runYoastAnalysis(input: YoastInput): YoastOutput {
  const attrs = paperAttributes(input)
  const paper = new Paper(input.bodyHtml, attrs)
  const researcher = new FrenchResearcher(paper)
  const seo = new SeoAssessor(researcher)
  seo.assess(paper)
  const read = new ContentAssessor(researcher)
  read.assess(paper)
  return { findings: toFindings([...collect(seo), ...collect(read)]) }
}
```

Si `ContentAssessor` ou `SeoAssessor` jette sur le constructeur (signature réelle à relire dans `node_modules/yoastseo/build/scoring/assessors/`), ajuster **uniquement** ce fichier — ne pas inventer Jed : 3.6 passe un `Researcher`, plus un objet i18n.

- [ ] **Step 4: Exclure `lib/yoastRun.ts` du glob edge-runtime**

Dans `_registry.test.ts`, ajouter aux `SKIP_FILES` :

```ts
const SKIP_FILES = new Set([
  "convex.config.ts",
  "http.ts",
  // CJS yoastseo (~5 Mo) : le glob `load()` tourne en edge-runtime et
  // casserait toute la suite. Aucune mutation publique ici.
  "lib/yoastRun.ts",
])
```

- [ ] **Step 5: Run the Node test**

```bash
pnpm --filter @astrotan/backend exec vitest run yoast/run.test.ts
```

Expected: PASS. Si FAIL sur `import.meta` / `fs` / constructeur, lire le fichier assessor dans `node_modules` et corriger `yoastRun.ts` seulement.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/lib/yoastRun.ts packages/backend/yoast/run.test.ts packages/backend/convex/_registry.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): isoler l'appel Paper / SeoAssessor / ContentAssessor

Yoast ne vit que dans ce wrapper GPL. Le glob du registre skippe
le fichier pour ne pas charger le CJS en edge-runtime.
EOF
)"
```

## Chunk 2: Action Convex + panneau (champs locaux)

### Task 5: Action `seoAnalyze.analyze`

Skill : `@.claude/skills/convex-function` (préambule env, `requireRole`, registre, barrel).

**Files:**
- Create: `packages/backend/convex/seoAnalyze.ts`
- Test: `packages/backend/convex/seoAnalyze.test.ts`
- Modify: `packages/backend/testing/registryModules.ts`
- Modify: `packages/backend/convex/lib/authz.test.ts` (stub env, voir Step 3)

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, expect, test } from "vitest"
import { ConvexError } from "convex/values"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import {
  MAX_EXCERPT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "./content"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.SEO_ANALYZE_STUB = "1"
})

afterEach(() => {
  process.env = originalEnv
})

const PAYLOAD = {
  title: "Titre",
  excerpt: "",
  bodyHtml: "<p>Corps</p>",
  targetKeyword: "astro",
  seoTitle: "Titre SEO",
  seoDescription: "Meta.",
  slug: "titre",
}

test("refuse sans session", async () => {
  const t = await makeTestConvex()
  await expect(t.action(api.seoAnalyze.analyze, PAYLOAD)).rejects.toThrow()
})

test("un editor authentifié reçoit la forme findings", async () => {
  const t = await makeTestConvex()
  const user = await seedUser(t, {
    email: "coach@example.com",
    password: "correct horse battery staple",
    name: "Coach",
    role: "editor",
  })
  await signIn(t, "coach@example.com", "correct horse battery staple")
  const identity = await identityFor(t, user.id)
  const out = await identity.action(api.seoAnalyze.analyze, PAYLOAD)
  expect(out).toEqual({ findings: [] })
})

test("un titre trop long lève FIELD_TOO_LONG avant Yoast", async () => {
  const t = await makeTestConvex()
  const user = await seedUser(t, {
    email: "long@example.com",
    password: "correct horse battery staple",
    name: "Long",
    role: "owner",
  })
  await signIn(t, "long@example.com", "correct horse battery staple")
  const identity = await identityFor(t, user.id)
  try {
    await identity.action(api.seoAnalyze.analyze, {
      ...PAYLOAD,
      title: "T".repeat(MAX_PAGE_TITLE_LENGTH + 1),
    })
    throw new Error("expected FIELD_TOO_LONG")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as ConvexError<{ code: string }>).data.code).toBe("FIELD_TOO_LONG")
  }
})

test("les plafonds documentés restent ceux de content.ts", () => {
  expect(MAX_POST_BODY_LENGTH).toBe(200_000)
  expect(MAX_EXCERPT_LENGTH).toBe(300)
  expect(MAX_SEO_TITLE_LENGTH).toBe(70)
  expect(MAX_SEO_DESCRIPTION_LENGTH).toBe(160)
  expect(MAX_TARGET_KEYWORD_LENGTH).toBe(80)
  expect(MAX_SLUG_LENGTH).toBe(200)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/seoAnalyze.test.ts
```

Expected: FAIL — `api.seoAnalyze` inexistant.

- [ ] **Step 3: Implement the action**

`packages/backend/convex/seoAnalyze.ts` :

```ts
"use node"

import { ConvexError, v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import {
  MAX_EXCERPT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "./content"
import type { SeoFinding } from "./lib/yoastFindings"

function assertLen(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
}

export const analyze = action({
  args: {
    title: v.string(),
    excerpt: v.string(),
    bodyHtml: v.string(),
    targetKeyword: v.string(),
    seoTitle: v.string(),
    seoDescription: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args): Promise<{ findings: SeoFinding[] }> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    assertLen(args.title, MAX_PAGE_TITLE_LENGTH, "title")
    assertLen(args.excerpt, MAX_EXCERPT_LENGTH, "excerpt")
    assertLen(args.bodyHtml, MAX_POST_BODY_LENGTH, "body")
    assertLen(args.targetKeyword, MAX_TARGET_KEYWORD_LENGTH, "targetKeyword")
    assertLen(args.seoTitle, MAX_SEO_TITLE_LENGTH, "seo.title")
    assertLen(args.seoDescription, MAX_SEO_DESCRIPTION_LENGTH, "seo.description")
    assertLen(args.slug, MAX_SLUG_LENGTH, "slug")

    // La matrice authz (edge-runtime) ne peut pas charger yoastseo.
    // Le vrai moteur est couvert par yoast/run.test.ts (Node).
    if (process.env.SEO_ANALYZE_STUB === "1") {
      return { findings: [] }
    }

    const { runYoastAnalysis } = await import("./lib/yoastRun.js")
    const webOrigin = process.env.WEB_SITE_URL
    return runYoastAnalysis({
      title: args.title,
      seoTitle: args.seoTitle,
      seoDescription: args.seoDescription || args.excerpt,
      targetKeyword: args.targetKeyword,
      slug: args.slug,
      webOrigin: webOrigin && webOrigin.length > 0 ? webOrigin : undefined,
      bodyHtml: args.bodyHtml,
    })
  },
})

MUTATION_REGISTRY.push({
  name: "seoAnalyze.analyze",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) =>
    t.action(api.seoAnalyze.analyze, {
      title: "Registre",
      excerpt: "",
      bodyHtml: "<p>x</p>",
      targetKeyword: "",
      seoTitle: "",
      seoDescription: "",
      slug: "registre",
    }),
})
```

Dans `lib/authz.test.ts`, **dans le `beforeEach` existant de la matrice** (celui qui stub `fetch`), ajouter :

```ts
process.env.SEO_ANALYZE_STUB = "1"
```

Dans `testing/registryModules.ts`, après `notifications` :

```ts
import "../convex/seoAnalyze"
```

L’action **n’écrit pas**. Pas de `postId` : elle juge le brouillon tapé, pas la ligne en base.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/seoAnalyze.test.ts convex/_registry.test.ts convex/lib/authz.test.ts
```

Expected: PASS. La matrice autorise owner/admin/editor et refuse anonymous.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
```

Expected: PASS. Si `api.seoAnalyze` manque, **ne pas éditer `_generated` à la main** — demander à l’humain `npx convex dev --once` depuis `packages/backend`.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/seoAnalyze.ts packages/backend/convex/seoAnalyze.test.ts packages/backend/testing/registryModules.ts packages/backend/convex/lib/authz.test.ts packages/backend/convex/_generated
git commit -m "$(cat <<'EOF'
feat(seo): action seoAnalyze.analyze côté Convex Node

requireRole sur chaque appel. Yoast est importé dynamiquement pour
que la suite edge-runtime n'ait pas à le charger.
EOF
)"
```

### Task 6: Libellés FR + debounce + liste

**Files:**
- Create: `apps/admin/src/lib/yoastLabels.ts`
- Test: `apps/admin/src/lib/yoastLabels.test.ts`
- Create: `apps/admin/src/lib/useDebouncedValue.ts`
- Test: `apps/admin/src/lib/useDebouncedValue.test.ts`
- Create: `apps/admin/src/components/post-seo-findings.tsx`
- Test: `apps/admin/src/components/post-seo-findings.test.tsx`

- [ ] **Step 1: Tests libellés + findings**

`yoastLabels.test.ts` :

```ts
import { expect, test } from "vitest"
import { phraseFinding } from "./yoastLabels"

test("un identifier connu a une phrase FR", () => {
  expect(phraseFinding("keyphraseLength")).toMatch(/mot-clé/i)
})

test("un identifier inconnu reste lisible sans jeter", () => {
  expect(phraseFinding("unknownThing")).toBe(
    "Point à revoir (unknownThing).",
  )
})
```

`post-seo-findings.test.tsx` :

```ts
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { PostSeoFindings } from "./post-seo-findings"

describe("PostSeoFindings", () => {
  test("liste manque et à améliorer, pas un score seul", () => {
    const html = renderToStaticMarkup(
      <PostSeoFindings
        findings={[
          { identifier: "keyphraseLength", severity: "missing", rating: "bad" },
          { identifier: "textLength", severity: "improve", rating: "ok" },
        ]}
        status="ready"
      />,
    )
    expect(html).toContain("Manque")
    expect(html).toContain("À améliorer")
    expect(html).not.toContain("/100")
  })

  test("vide : phrase d'état, pas une note inventée", () => {
    const html = renderToStaticMarkup(
      <PostSeoFindings findings={[]} status="ready" />,
    )
    expect(html).toContain("Rien à signaler pour le moment")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/yoastLabels.test.ts src/components/post-seo-findings.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implementations**

`yoastLabels.ts` — table courte, fallback :

```ts
const LABELS: Record<string, string> = {
  introductionKeyword: "Le mot-clé n’apparaît pas assez tôt dans le texte.",
  keyphraseLength: "Le mot-clé cible est absent ou trop long.",
  keywordDensity: "Densité du mot-clé à ajuster dans le corps.",
  metaDescriptionKeyword: "Le mot-clé n’est pas dans la meta description.",
  metaDescriptionLength: "La meta description est trop courte ou trop longue.",
  textCompetingLinks: "Un lien sortant concurrence le mot-clé.",
  internalLinks: "Ajoutez au moins un lien interne.",
  titleKeyword: "Le mot-clé n’est pas dans le titre SEO.",
  urlKeyword: "Le mot-clé n’est pas dans le slug.",
  textLength: "Le corps est trop court pour ce mot-clé.",
  outboundLinks: "Ajoutez un lien sortant pertinent.",
  functionWordsInKeyphrase: "Le mot-clé est surtout fait de mots vides.",
  singleH1: "Un H1 dans le corps double le titre public.",
  subheadingsKeyword: "Le mot-clé n’apparaît pas dans un intertitre.",
  imageKeyphrase: "Le mot-clé n’est pas dans le texte alternatif d’une image.",
  textImages: "Le corps n’a pas assez d’images.",
  textPresence: "Le corps est vide.",
  sentenceLengthInText: "Trop de phrases longues.",
  paragraphTooLong: "Un paragraphe est trop long.",
  subheadingDistributionTooLong: "Une section sans intertitre est trop longue.",
  transitionWords: "Pas assez de mots de transition.",
  passiveVoice: "Trop de voix passive.",
  sentenceBeginnings: "Trop de phrases commencent pareil.",
}

export function phraseFinding(identifier: string): string {
  return LABELS[identifier] ?? `Point à revoir (${identifier}).`
}
```

Si un identifier réel de 3.6 diffère (lire `getIdentifier()` dans le test Node), ajouter la clé — ne pas inventer de synonyme côté UI.

`useDebouncedValue.ts` :

```ts
import { useEffect, useState } from "react"

export const SEO_ANALYZE_DEBOUNCE_MS = 1500

export function useDebouncedValue<T>(value: T, delayMs = SEO_ANALYZE_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
```

`useDebouncedValue.test.ts` — l’admin n’a ni jsdom ni Testing Library (`apps/admin/vitest.config.ts`). On fige le délai, pas le hook React :

```ts
import { expect, test } from "vitest"
import { SEO_ANALYZE_DEBOUNCE_MS } from "./useDebouncedValue"

test("le recalcul attend 1,5 s, dans la fourchette 1–2 s validée", () => {
  expect(SEO_ANALYZE_DEBOUNCE_MS).toBe(1500)
})
```

Le hook lui-même (setTimeout + cleanup) se vérifie à la Task 7 dans le navigateur, pas en ajoutant une dépendance de test.

`post-seo-findings.tsx` :

```tsx
import { phraseFinding } from "@/lib/yoastLabels"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"

export function PostSeoFindings({
  findings,
  status,
}: {
  findings: SeoFinding[]
  status: "idle" | "loading" | "ready" | "error"
}) {
  if (status === "loading") {
    return <p className="text-xs text-muted-foreground">Analyse…</p>
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-xs text-destructive">
        Analyse indisponible.
      </p>
    )
  }
  const missing = findings.filter((f) => f.severity === "missing")
  const improve = findings.filter((f) => f.severity === "improve")
  if (findings.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Rien à signaler pour le moment.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <FindingList title="Manque" items={missing} />
      <FindingList title="À améliorer" items={improve} />
    </div>
  )
}

function FindingList({
  title,
  items,
}: {
  title: string
  items: SeoFinding[]
}) {
  if (items.length === 0) return null
  return (
    <section>
      <h3 className="text-xs font-medium">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
        {items.map((item) => (
          <li key={item.identifier}>{phraseFinding(item.identifier)}</li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run admin tests**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/yoastLabels.test.ts src/lib/useDebouncedValue.test.ts src/components/post-seo-findings.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/yoastLabels.ts apps/admin/src/lib/yoastLabels.test.ts apps/admin/src/lib/useDebouncedValue.ts apps/admin/src/lib/useDebouncedValue.test.ts apps/admin/src/components/post-seo-findings.tsx apps/admin/src/components/post-seo-findings.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): libellés FR et liste manque / à améliorer

Les phrases sont les nôtres, indexées par identifier Yoast. Pas de
score abstrait.
EOF
)"
```

### Task 7: Panneau + branchement Contenu

**Files:**
- Create: `apps/admin/src/components/post-coach-panel.tsx`
- Test: `apps/admin/src/components/post-coach-panel.test.tsx` (stubs findings only en Chunk 1)
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx`

- [ ] **Step 1: Write the panel (Chunk 1 = Yoast only)**

Le panneau reçoit les valeurs **déjà** sélectionnées par `form.Subscribe` (ne pas s’abonner au body depuis `$postId.tsx` entier).

`post-coach-panel.tsx` — premier jet sans faits ni GEO (slots vides commentés interdits : simplement ne pas les rendre encore) :

```tsx
import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"
import { useDebouncedValue } from "@/lib/useDebouncedValue"
import { PostSeoFindings } from "@/components/post-seo-findings"

export type CoachFields = {
  title: string
  excerpt: string
  body: string
  targetKeyword: string
  seoTitle: string
  seoDescription: string
  slug: string
}

export function PostCoachPanel({ fields }: { fields: CoachFields }) {
  const analyze = useAction(api.seoAnalyze.analyze)
  const debounced = useDebouncedValue(fields)
  const [findings, setFindings] = useState<SeoFinding[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  )

  useEffect(() => {
    let cancelled = false
    setStatus("loading")
    analyze({
      title: debounced.title,
      excerpt: debounced.excerpt,
      bodyHtml: debounced.body,
      targetKeyword: debounced.targetKeyword,
      seoTitle: debounced.seoTitle,
      seoDescription: debounced.seoDescription,
      slug: debounced.slug,
    })
      .then((out) => {
        if (cancelled) return
        setFindings(out.findings)
        setStatus("ready")
      })
      .catch(() => {
        if (!cancelled) setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [analyze, debounced])

  return (
    <aside
      className="rounded-lg border border-input bg-muted/30 p-3"
      aria-label="Aide à la rédaction"
    >
      <p className="mb-2 text-xs text-muted-foreground">
        Ce panneau juge, il n’écrit pas. « Générer avec l’IA » remplit les
        champs SEO/GEO.
      </p>
      <PostSeoFindings findings={findings} status={status} />
    </aside>
  )
}
```

Test : extraire `CoachCopy` n’est pas nécessaire. Tester la phrase « n’écrit pas » via render du aside en passant un mock est lourd. Teser uniquement que `PostCoachPanel` exporte et que le markup de `PostSeoFindings` reste le contrat. Un test de fumée :

```tsx
import { expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ findings: [] })),
}))

test("le module panneau se charge sans tirer yoastseo", async () => {
  await import("./post-coach-panel")
  expect(true).toBe(true)
})
```

```bash
rg -n "from \"yoastseo\"|from 'yoastseo'" apps/admin
```

Expected: aucun match. Ajouter cette commande au Step 4.

- [ ] **Step 2: Grille dans `$postId.tsx`**

Remplacer le `CardContent` de « Contenu » (~643–676) par :

```tsx
        <CardContent className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
          <form.Field
            name="body"
            children={(field) => (
              <Field>
                <FieldTitle>Corps</FieldTitle>
                <RichTextEditor
                  id={field.name}
                  value={field.state.value}
                  maxLength={MAX_POST_BODY_LENGTH}
                  disabled={!canWrite}
                  onChange={field.handleChange}
                />
                <FieldDescription>
                  Mise en forme par la barre d&apos;outils. Le bouton{" "}
                  <code>&lt;/&gt;</code> montre le HTML tel qu&apos;il est stocké, et
                  permet de le corriger à la main.
                </FieldDescription>
              </Field>
            )}
          />
          <form.Subscribe
            selector={(state) => ({
              title: state.values.title,
              excerpt: state.values.excerpt,
              body: state.values.body,
              targetKeyword: state.values.targetKeyword,
              seoTitle: state.values.seoTitle,
              seoDescription: state.values.seoDescription,
              slug: state.values.slug,
            })}
            children={(fields) => <PostCoachPanel fields={fields} />}
          />
        </CardContent>
```

Importer `PostCoachPanel`. Ne pas toucher aux cartes SEO/GEO ni à Audience.

- [ ] **Step 3: Tests admin + grep yoast**

```bash
pnpm --filter @astrotan/admin exec vitest run src/components/post-coach-panel.test.tsx src/components/post-seo-findings.test.tsx
rg -n "from [\"']yoastseo" apps/admin apps/web
```

Expected: tests PASS, grep vide.

- [ ] **Step 4: Vérification navigateur (humain + agent si :3001 tourne)**

Ouvrir `http://localhost:3001/posts/<id>`. Taper dans le corps : après ~1,5 s le panneau à droite de Contenu se met à jour. « Générer avec l’IA » continue d’écrire les champs ; le panneau ne les mute pas.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/post-coach-panel.tsx apps/admin/src/components/post-coach-panel.test.tsx apps/admin/src/routes/_authed/posts/\$postId.tsx
git commit -m "$(cat <<'EOF'
feat(admin): panneau d'aide à droite de la zone Contenu

Recalcul debounce 1,5 s via seoAnalyze.analyze. Le générateur IA
reste le seul écriture SEO/GEO.
EOF
)"
```

Les chunks 1–2 forment le livrable phase 1 : liste Yoast sur les champs locaux.

---

## Chunk 3: Bandeau de faits (déjà queryable)

Interdit : On-Page Instant Pages, nouvel appel DataForSEO à la frappe, courbe interpolée, mélange avec `findings`.

Queryable aujourd’hui :

- `seoRanks.forDocument({ kind: "post", postId })` — déjà monté par `PageAnalytics`
- `analytics.forPath({ path })` — action, déjà appelée au montage de `PageAnalytics` (pas à chaque frappe)
- `seoRanks.siteSnapshot` — Labs : `keywords[]`, `rankingPages[]` (chemins du domaine déclaré)

### Task 8: Faits purs

**Files:**
- Create: `apps/admin/src/lib/postSeoFacts.ts`
- Test: `apps/admin/src/lib/postSeoFacts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { factsForPost } from "./postSeoFacts"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"

const rank: DocumentRank = {
  state: "ranked",
  position: 7,
  previousPosition: 12,
  gap: 5,
  canRelever: true,
}

const umami: AnalyticsResult = {
  last7: { pageviews: 128, visitors: 44, pageviewsPrev: 100, visitorsPrev: 40 },
  last30: { pageviews: 903, visitors: 310, pageviewsPrev: 800, visitorsPrev: 280 },
  status: "ok",
}

const snap: SiteSnapshot = {
  configured: true,
  declaredDomain: "exemple.fr",
  averagePosition: 10,
  averagePositionPrev: null,
  backlinks: null,
  referringDomains: null,
  keywords: [{ keyword: "astro", position: 4 }],
  rankingPages: [{ path: "/blog/bonjour", position: 4 }],
  keywordCount: 1,
  fetchedAt: 1,
}

describe("factsForPost", () => {
  test("range, umami et Labs sont trois faits séparés", () => {
    const facts = factsForPost({
      path: "/blog/bonjour",
      targetKeyword: "astro",
      rank,
      umami,
      snapshot: snap,
    })
    expect(facts.map((f) => f.id)).toEqual(["rank", "umami", "labs"])
    expect(facts[0]?.text).toContain("7")
    expect(facts[1]?.text).toContain("128")
    expect(facts[2]?.text).toContain("4")
  })

  test("pas de mot-clé Labs : le dit, n'invente pas un rang", () => {
    const facts = factsForPost({
      path: "/blog/autre",
      targetKeyword: "inconnu",
      rank: { state: "never_ranked", canRelever: true },
      umami: { last7: null, last30: null, status: "not-configured" },
      snapshot: { ...snap, keywords: [], rankingPages: [] },
    })
    expect(facts.find((f) => f.id === "labs")?.text).toMatch(/pas dans le snapshot/i)
    expect(facts.some((f) => f.text.includes("courbe"))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/postSeoFacts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementation**

```ts
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"

export type FactLine = { id: "rank" | "umami" | "labs"; text: string }

export function factsForPost(input: {
  path: string
  targetKeyword: string
  rank: DocumentRank | undefined
  umami: AnalyticsResult | undefined
  snapshot: SiteSnapshot | undefined
}): FactLine[] {
  return [
    { id: "rank", text: rankFact(input.rank) },
    { id: "umami", text: umamiFact(input.umami) },
    {
      id: "labs",
      text: labsFact(input.snapshot, input.targetKeyword, input.path),
    },
  ]
}

function rankFact(rank: DocumentRank | undefined): string {
  if (rank === undefined) return "Rang : chargement…"
  if (rank.state === "ranked") return `Rang relevé : ${rank.position}.`
  if (rank.state === "no_keyword") return "Rang : aucun mot-clé cible."
  if (rank.state === "dfs_absent") return "Rang : DataForSEO n’est pas configuré."
  if (rank.state === "never_ranked") return "Rang : jamais relevé."
  if (rank.state === "out_of_top_100") return "Rang : hors du top 100."
  if (rank.state === "keyword_changed") {
    return `Rang : le dernier relevé porte encore « ${rank.previousKeyword} ».`
  }
  return `Rang : une autre URL ranke.`
}

function umamiFact(umami: AnalyticsResult | undefined): string {
  if (umami === undefined) return "Audience : chargement…"
  if (umami.status !== "ok" || umami.last7 === null) {
    return "Audience : pas de mesure Umami sur ce chemin."
  }
  return `Audience : ${umami.last7.pageviews} vues sur 7 jours.`
}

function labsFact(
  snapshot: SiteSnapshot | undefined,
  keyword: string,
  path: string,
): string {
  if (snapshot === undefined) return "Labs : chargement…"
  if (!snapshot.configured) return "Labs : DataForSEO n’est pas configuré."
  const key = keyword.trim().toLowerCase()
  const byKeyword = snapshot.keywords.find((k) => k.keyword.toLowerCase() === key)
  if (byKeyword) return `Labs : « ${byKeyword.keyword} » est ${byKeyword.position}e (snapshot site).`
  const byPath = snapshot.rankingPages.find((p) => p.path === path)
  if (byPath) return `Labs : ce chemin est ${byPath.position}e sur le snapshot site.`
  return "Labs : ce mot-clé ou ce chemin n’est pas dans le snapshot."
}
```

- [ ] **Step 4–5: Pass + commit**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/postSeoFacts.test.ts
```

```bash
git add apps/admin/src/lib/postSeoFacts.ts apps/admin/src/lib/postSeoFacts.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): formater les faits rang / Umami / Labs hors du score Yoast

Uniquement des données déjà en query. Pas de courbe, pas d'On-Page.
EOF
)"
```

### Task 9: UI faits + Umami sans second fetch à la frappe

**Files:**
- Create: `apps/admin/src/components/post-seo-facts.tsx`
- Test: `apps/admin/src/components/post-seo-facts.test.tsx`
- Modify: `apps/admin/src/components/post-coach-panel.tsx`
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx`
- Modify: `apps/admin/src/components/analytics-panel.tsx` — **uniquement** si on extrait le résultat Umami pour éviter un second `forPath`

Décision : **ne pas** rappeler `analytics.forPath` dans le panneau (ce n’est pas de la frappe, mais ça doublerait l’action au montage). Extraire un hook local `usePostAnalytics(path)` dans `analytics-panel.tsx` **dépasserait** le budget de ce fichier (~150 lignes : OK pour un hook frère).

Créer `apps/admin/src/lib/usePostAnalytics.ts` (~40 lignes) : `useAction` + `useEffect` sur `path` seulement. `PageAnalytics` et `PostCoachPanel` l’utilisent. Convex déduplique `useQuery(seoRanks.forDocument)` et `useQuery(seoRanks.siteSnapshot)`.

- [ ] **Step 1: Test facts UI**

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { PostSeoFacts } from "./post-seo-facts"

test("affiche trois lignes de faits, sans /100", () => {
  const html = renderToStaticMarkup(
    <PostSeoFacts
      facts={[
        { id: "rank", text: "Rang relevé : 7." },
        { id: "umami", text: "Audience : 128 vues sur 7 jours." },
        { id: "labs", text: "Labs : pas dans le snapshot." },
      ]}
    />,
  )
  expect(html).toContain("Faits")
  expect(html).toContain("128")
  expect(html).not.toContain("/100")
})
```

- [ ] **Step 2: `PostSeoFacts` + hook + branchement**

`post-seo-facts.tsx` : `<section><h3>Faits</h3><ul>…</ul></section>`.

`usePostAnalytics.ts` : déplacer le `useEffect`/`useAction` de `PageAnalytics` ; `PageAnalytics` devient :

```tsx
const result = usePostAnalytics(path)
const rank = useQuery(api.seoRanks.forDocument, rankArgs)
```

`PostCoachPanel` gagne `postId` + `path`, appelle `useQuery` ×2 + `usePostAnalytics(path)`, passe `factsForPost(...)` à `PostSeoFacts` **au-dessus** de `PostSeoFindings` (à côté = même aside, bloc distinct).

`$postId.tsx` : le `Subscribe` ajoute `postId` / path depuis `post._id` et `post.slug` **enregistré** pour Umami/Labs (la mesure porte sur l’URL en ligne, comme `PageAnalytics` l.562–568). Le slug du formulaire peut diverger : les faits restent sur `/blog/${post.slug}`.

- [ ] **Step 3: Tests**

```bash
pnpm --filter @astrotan/admin exec vitest run src/components/post-seo-facts.test.tsx src/components/analytics-panel.test.tsx src/lib/postSeoFacts.test.ts
```

Expected: PASS. `analytics-panel.test.tsx` ne casse pas (il teste `AnalyticsPanel` présentational).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/usePostAnalytics.ts apps/admin/src/components/analytics-panel.tsx apps/admin/src/components/post-seo-facts.tsx apps/admin/src/components/post-seo-facts.test.tsx apps/admin/src/components/post-coach-panel.tsx apps/admin/src/routes/_authed/posts/\$postId.tsx
git commit -m "$(cat <<'EOF'
feat(admin): bandeau de faits rang, Umami et Labs à côté de Yoast

Même queries que l'audience. Un seul forPath au montage, jamais à
la frappe.
EOF
)"
```

---

## Chunk 4: Checklist GEO (champs existants)

### Task 10: Heuristiques pures

**Files:**
- Create: `apps/admin/src/lib/geoChecklist.ts`
- Test: `apps/admin/src/lib/geoChecklist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { geoChecklist } from "./geoChecklist"

const vide = {
  summary: "",
  entities: [] as string[],
  faq: [] as { question: string; answer: string }[],
  noai: false,
  publishedAt: undefined as number | undefined,
}

describe("geoChecklist", () => {
  test("résumé, entités, FAQ manquent sur une fiche vide", () => {
    const items = geoChecklist(vide)
    expect(items.filter((i) => i.status === "missing").map((i) => i.id)).toEqual([
      "summary",
      "entities",
      "faq",
    ])
  })

  test("noai avertit que le schéma public est coupé", () => {
    const items = geoChecklist({
      ...vide,
      summary: "Deux phrases factuelles.",
      entities: ["Convex"],
      faq: [{ question: "Quoi ?", answer: "Ceci." }],
      noai: true,
      publishedAt: 1,
    })
    expect(items.find((i) => i.id === "noai")?.status).toBe("warn")
    expect(items.find((i) => i.id === "schemaFaq")?.status).toBe("blocked")
    expect(items.find((i) => i.id === "schemaArticle")?.status).toBe("blocked")
  })

  test("Article prêt seulement si publié et !noai", () => {
    const draft = geoChecklist({
      ...vide,
      summary: "Ok.",
      entities: ["A"],
      faq: [{ question: "Q ?", answer: "R." }],
      publishedAt: undefined,
    })
    expect(draft.find((i) => i.id === "schemaArticle")?.status).toBe("pending")
    const live = geoChecklist({
      ...vide,
      summary: "Ok.",
      entities: ["A"],
      faq: [{ question: "Q ?", answer: "R." }],
      publishedAt: 99,
    })
    expect(live.find((i) => i.id === "schemaArticle")?.status).toBe("ok")
    expect(live.find((i) => i.id === "schemaFaq")?.status).toBe("ok")
  })

  test("n'émet ni citations ni auteur", () => {
    const ids = geoChecklist(vide).map((i) => i.id)
    expect(ids).not.toContain("citations")
    expect(ids).not.toContain("author")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/geoChecklist.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementation**

```ts
export type GeoCheckStatus = "missing" | "ok" | "warn" | "blocked" | "pending"

export type GeoCheckItem = {
  id: "summary" | "entities" | "faq" | "noai" | "schemaFaq" | "schemaArticle"
  status: GeoCheckStatus
  label: string
}

export function geoChecklist(input: {
  summary: string
  entities: string[]
  faq: { question: string; answer: string }[]
  noai: boolean
  publishedAt?: number
}): GeoCheckItem[] {
  const summary = input.summary.trim().length > 0
  const entities = input.entities.some((e) => e.trim().length > 0)
  const faq = input.faq.some(
    (row) => row.question.trim().length > 0 && row.answer.trim().length > 0,
  )
  const noai = input.noai
  return [
    {
      id: "summary",
      status: summary ? "ok" : "missing",
      label: summary
        ? "Résumé extractible renseigné."
        : "Ajoutez un résumé que les moteurs de réponse pourront citer.",
    },
    {
      id: "entities",
      status: entities ? "ok" : "missing",
      label: entities
        ? "Des entités sont posées."
        : "Indiquez au moins une entité (désambiguïsation).",
    },
    {
      id: "faq",
      status: faq ? "ok" : "missing",
      label: faq
        ? "Une FAQ complète est prête."
        : "Ajoutez au moins une question / réponse (FAQPage).",
    },
    {
      id: "noai",
      status: noai ? "warn" : "ok",
      label: noai
        ? "noai : résumé, mots-clés et JSON-LD publics sont coupés."
        : "Reprise par les IA génératives autorisée.",
    },
    {
      id: "schemaFaq",
      status: noai ? "blocked" : faq ? "ok" : "missing",
      label: noai
        ? "FAQPage ne sera pas émis (noai)."
        : faq
          ? "FAQPage sera émis."
          : "FAQPage exige une paire question / réponse.",
    },
    {
      id: "schemaArticle",
      status: noai
        ? "blocked"
        : input.publishedAt === undefined
          ? "pending"
          : "ok",
      label: noai
        ? "Article JSON-LD ne sera pas émis (noai)."
        : input.publishedAt === undefined
          ? "Article JSON-LD partira à la publication."
          : "Article JSON-LD est émis sur le site public.",
    },
  ]
}
```

Client-side, **instantané** (pas Yoast). Pas de debounce requis.

- [ ] **Step 4–5: Pass + commit**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/geoChecklist.test.ts
```

```bash
git add apps/admin/src/lib/geoChecklist.ts apps/admin/src/lib/geoChecklist.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): checklist GEO bornée aux champs déjà au schéma

Pas de citations, pas d'auteur : ces critères n'ont pas de champ
éditable. noai coupe le schéma public, comme PageHead.
EOF
)"
```

### Task 11: UI checklist + Subscribe GEO

**Files:**
- Create: `apps/admin/src/components/post-geo-checklist.tsx`
- Test: `apps/admin/src/components/post-geo-checklist.test.tsx`
- Modify: `apps/admin/src/components/post-coach-panel.tsx`
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx`

- [ ] **Step 1: Test UI**

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { PostGeoChecklist } from "./post-geo-checklist"
import { geoChecklist } from "@/lib/geoChecklist"

test("titre GEO et items FR", () => {
  const html = renderToStaticMarkup(
    <PostGeoChecklist
      items={geoChecklist({
        summary: "",
        entities: [],
        faq: [],
        noai: false,
      })}
    />,
  )
  expect(html).toContain("GEO")
  expect(html).toContain("résumé")
  expect(html).not.toContain("citation")
  expect(html).not.toContain("auteur")
})
```

- [ ] **Step 2: Composant + élargir le Subscribe**

`post-geo-checklist.tsx` : liste `items` avec `text-destructive` si `missing`/`blocked`, `text-muted-foreground` si `pending`/`warn`.

`CoachFields` s’allonge de `geoSummary`, `geoEntities`, `geoFaq`, `geoNoai`. `PostCoachPanel` reçoit aussi `publishedAt?: number` (depuis `post.publishedAt`, pas le formulaire).

`splitEntities` existe déjà (`@/lib/contentGuards`) — l’utiliser pour `geoEntities` string → array, comme `autoFieldsOf`.

Dans `$postId.tsx`, étendre le `selector` du Subscribe Contenu.

- [ ] **Step 3: Tests**

```bash
pnpm --filter @astrotan/admin exec vitest run src/lib/geoChecklist.test.ts src/components/post-geo-checklist.test.tsx src/components/post-coach-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Vérification navigateur**

`/posts/$postId` : à droite de Contenu, trois blocs dans cet ordre — **Faits**, **Manque / À améliorer** (Yoast), **GEO**. Vider le résumé GEO → la checklist passe à « manque » tout de suite. Taper le corps → Yoast attend 1,5 s. Audience en haut inchangée. Générer avec l’IA remplit les champs ; le panneau se met à jour après coup, il n’écrit pas.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/post-geo-checklist.tsx apps/admin/src/components/post-geo-checklist.test.tsx apps/admin/src/components/post-coach-panel.tsx apps/admin/src/routes/_authed/posts/\$postId.tsx
git commit -m "$(cat <<'EOF'
feat(admin): checklist GEO dans le panneau d'aide à l'article

Juge les champs geo déjà saisis. Générer avec l'IA reste le geste
qui écrit.
EOF
)"
```

### Task 12: Filet final

- [ ] **Step 1: Suites**

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
pnpm --filter @astrotan/backend test
pnpm --filter @astrotan/admin exec tsc --noEmit
pnpm --filter @astrotan/admin test
rg -n "from [\"']yoastseo" apps/admin apps/web
```

Expected: typechecks + tests verts ; grep vide.

- [ ] **Step 2: Push Convex (humain)**

Depuis `packages/backend`, dans un terminal interactif :

```bash
npx convex dev --once
```

Expected: `seoAnalyze.analyze` déployée. Si le bundler refuse yoastseo malgré `externalPackages`, le message dira quoi. Ne pas basculer l’analyse dans l’admin.

- [ ] **Step 3: Commit de filet seulement s’il reste un delta** (codegen `_generated` après le push). Sinon ne rien committer.

---

## Hors scope (volontaire)

- Pages vitrine (`$pageId`) — pas de corps HTML en base (invariant 5).
- Inclusive language Yoast (EN only).
- On-Page Instant Pages / nouvel endpoint DataForSEO.
- Courbe de rang article (la table n’a que courant / précédent).
- Champ citations, champ auteur, second JSON-LD `author`.
- Score unique type « feu tricolore /100 » en héros.
- TanStack Query.
