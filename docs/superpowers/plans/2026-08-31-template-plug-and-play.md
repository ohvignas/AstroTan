# Template plug-and-play — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le template AstroTan plug-and-play : un vibecodeur clone, bootstrap, ajoute des pages, et l'invariant « brouillon jamais public » tient sans qu'il se souvienne d'un ternaire — sans aucun nom, domaine ou instance Illith en dur.

**Architecture:** Le garde-fou de publication vit dans `BaseLayout` (statut HTTP 404 → `NotFoundBody`), pas dans chaque page. Les queries publiques restent filtrées côté serveur. L'admin préserve et édite `ogImageId`. Le site public lit les tags via une query projetée. Aucune instance canonique : les exemples utilisent `exemple.fr` / `admin.exemple.fr`.

**Tech Stack:** Astro 7 · TanStack Start 1 · Convex · Better Auth · Vitest · AstroContainer · shadcn/ui

**Spec:** `docs/superpowers/specs/2026-08-27-astrotan-design.md`

**Worktree:** `/Users/antoinevigneau/Desktop/AstroTan/.worktrees/template-plug-and-play` — branche `fix/template-plug-and-play`. Travailler UNIQUEMENT ici. Ne pas merger dans `dev`. Ne pas pusher.

**Conventions:** TDD (test qui échoue → implémentation minimale → vert → commit). Commits Conventional Commits **en français**. Code en anglais. UI en français. Fichiers créés < 200 lignes. Après `packages/backend/convex/` : `pnpm --filter @astrotan/backend test` (jamais `convex dev` interactif, jamais d'édition manuelle de `_generated`). Toute mutation publique → `MUTATION_REGISTRY`. Toute query publique nouvelle → enseigner `pages.publicQueryFamily.test.ts`.

---

## Hors périmètre

Ne PAS implémenter :

- Playwright E2E (plan séparé)
- Déployer un VPS / recette OVH (geste adoptant)
- Remplir `legal.ts` avec une vraie société — le marqueur `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` DOIT rester `true`
- Réécrire le copy démo qui vend AstroTan (c'est le template)
- Consommateur OpenRouter / écran IA
- Table `navigation` CMS (rester retirée)
- Migration `leadWebhookSecret` hors settings
- Lancer `convex dev` interactif
- Toucher aux `.env` / `.env.local` / `.env.deploy` gitignorés

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/components/NotFoundBody.astro` | Corps 404 (markup + styles), unique source |
| `apps/web/src/layouts/BaseLayout.astro` | Si statut 404 → `NotFoundBody` à la place du slot ; bandeau d'aperçu si `locals.preview` |
| `apps/web/src/pages/404.astro` | Pose le statut 404, réutilise `NotFoundBody` via le layout |
| `apps/web/src/lib/loadPage.ts` / `loadPost.ts` | Poser `Astro.locals.preview = true` quand l'aperçu est valide |
| `apps/web/src/env.d.ts` | `Locals.preview?: boolean` |
| `apps/web/src/layouts/BlogLayout.astro` | Retirer le bandeau dupliqué |
| `apps/web/src/pages/_tests/404.test.ts` | 404 réel + page non publiée sans ternaire + `/blog` n'est pas un 404 |
| `apps/admin/src/lib/buildSeo.ts` | Assemble l'objet `seo` en préservant `ogImageId` |
| `apps/admin/src/lib/buildSeo.test.ts` | Forme de l'objet `seo` envoyé |
| `apps/admin/src/components/OgImageField.tsx` | Picker d'image OG (pages, posts, defaultSeo) |
| `apps/admin/src/lib/assignableRoles.ts` | Rôles qu'un acteur peut inviter / promouvoir |
| `packages/backend/convex/tags.ts` | `listPublic` — projection `{ _id, name, slug }` |
| `apps/web/src/lib/markdown.ts` | `htmlToPlainText` pour les corps Tiptap |

---

## Chunk 1: Publication plug-and-play

Le défaut : `loadPage` pose le statut 404, mais `fonctionnalites.astro`, `mentions-legales.astro`, `confidentialite.astro` et `cookies.astro` rendent le corps quand même. Le garde-fou doit vivre dans `BaseLayout` (test du **statut**, pas de `page === null` — `/blog` passe `page={null}` sans être un 404).

### Task 1: Extraire `NotFoundBody` et le brancher dans `BaseLayout`

**Files:**
- Create: `apps/web/src/components/NotFoundBody.astro`
- Modify: `apps/web/src/layouts/BaseLayout.astro`
- Modify: `apps/web/src/pages/404.astro`
- Modify: `apps/web/src/pages/_tests/404.test.ts`
- Create: `apps/web/src/pages/_tests/unpublished-page.test.ts`
- Test: `apps/web/src/pages/_tests/404.test.ts`, `apps/web/src/pages/_tests/unpublished-page.test.ts`

AstroContainer (Astro 7.2.8) n'accepte **pas** `response` dans `ContainerRenderOptions` (`slots`, `props`, `request`, `params`, `locals`, `routeType`, `partial` seulement). Poser le statut dans le frontmatter d'un fixture. Le Container n'appelle pas `provideCache` (`revalidate.test.ts` le documente) : **ne pas** rendre `fonctionnalites.astro` ni `blog/index.astro` — `loadPage` / `Astro.cache.set` lèvent. Mocker `loadPage` pour la page réelle ; pour `/blog`, un fixture `page={null}` sans `cache.set`.

- [ ] **Step 1: Fixtures + tests (RED)**

Créer les fixtures **à côté** de `404.test.ts` (`apps/web/src/pages/_tests/`, pas un sous-dossier `fixtures/` — `../../layouts` y est déjà le bon chemin, comme le mock Convex du test 404). Un sous-dossier exigerait `../../../` et casserait l'import.

`apps/web/src/pages/_tests/Status404Slot.astro` :

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro"
Astro.response.status = 404
---
<BaseLayout page={null} fallbackTitle="Page introuvable">
  <p>CONTENU-INTERDIT-EN-404</p>
</BaseLayout>
```

`apps/web/src/pages/_tests/BlogIndexSlot.astro` :

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro"
---
<BaseLayout page={null} fallbackTitle="Blog">
  <h1>Blog</h1>
</BaseLayout>
```

`apps/web/src/pages/_tests/UnpublishedFonctionnalites.astro` — même markup d'appel que `fonctionnalites.astro` (loadPage + BaseLayout + Hero). Le test mockera `loadPage` (sans `cache.set`).

```astro
---
import { loadPage } from "../../lib/loadPage"
import BaseLayout from "../../layouts/BaseLayout.astro"
import Hero from "../../components/hero/Hero.astro"
const { page } = await loadPage(Astro)
---
<BaseLayout page={page} fallbackTitle="Fonctionnalités">
  <Hero
    variant="centered"
    size="md"
    eyebrow="Fonctionnalités"
    headline="Tout ce qui est déjà résolu"
  />
</BaseLayout>
```

Dans `apps/web/src/pages/_tests/404.test.ts`, garder les deux tests existants. Ajouter :

```ts
test("BaseLayout rend le corps 404 quand le statut est 404, même si le slot a du contenu", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./Status404Slot.astro")
  const html = await container.renderToString(Page, {
    locals: { nonce: "test-nonce" },
  })
  expect(html).toContain("Cette page n'existe pas")
  expect(html).not.toContain("CONTENU-INTERDIT-EN-404")
})

test("/blog avec page=null n'est pas un 404", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./BlogIndexSlot.astro")
  const response = await container.renderToResponse(Page, {
    locals: { nonce: "test-nonce" },
  })
  expect(response.status).toBe(200)
  const html = await response.text()
  expect(html).toContain("<h1>Blog</h1>")
  expect(html).not.toContain("Cette page n'existe pas")
})
```

Créer `apps/web/src/pages/_tests/unpublished-page.test.ts` :

```ts
import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test, vi } from "vitest"

vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query: async () => null }),
}))

vi.mock("../../lib/loadPage", () => ({
  loadPage: async (astro: { response: { status: number }; cache?: { set: (v: unknown) => void } }) => {
    astro.response.status = 404
    // Pas de cache.set : le Container n'a pas provideCache.
    return { page: null, preview: false }
  },
}))

test("une page sans ternaire répond 404 et n'affiche pas son hero", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./UnpublishedFonctionnalites.astro")
  const response = await container.renderToResponse(Page, {
    locals: { nonce: "test-nonce" },
    request: new Request("http://localhost/fonctionnalites"),
  })
  expect(response.status).toBe(404)
  const html = await response.text()
  expect(html).toContain("Cette page n'existe pas")
  expect(html).not.toContain("Tout ce qui est déjà résolu")
})
```

- [ ] **Step 2: Lancer les tests et confirmer l'échec**

```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm --filter @astrotan/web test -- src/pages/_tests/404.test.ts src/pages/_tests/unpublished-page.test.ts
```

Expected: FAIL — `BaseLayout` rend encore le slot (hero + `CONTENU-INTERDIT-EN-404` visibles). Le test `/blog` est déjà vert (statut 200) : c'est le filet anti-régression du discriminant.

- [ ] **Step 3: Extraire `NotFoundBody` et brancher `BaseLayout`**

`apps/web/src/components/NotFoundBody.astro` — copier le `<section>` et le `<style>` de `404.astro` (L54–107) tels quels. Importer `mainNav` depuis `../config/nav`.

`apps/web/src/layouts/BaseLayout.astro` — importer `NotFoundBody`, puis dans `<main>` :

```astro
<main id="main-content" class="site-main">
  {Astro.response.status === 404 ? <NotFoundBody /> : <slot />}
</main>
```

Ne PAS tester `page === null`. `/blog` passe `page={null}` avec un statut 200.

`apps/web/src/pages/404.astro` — garder `Astro.response.status = 404` et `BaseLayout`. Remplacer le `<section>` + `<style>` par rien (le layout rend `NotFoundBody`). Le fichier ne doit plus importer `mainNav`.

Laisser les ternaires existants (`index.astro`, `contact.astro`, `tarifs.astro`) : le layout suffit désormais, les retirer n'est pas requis.

Mettre à jour le JSDoc de `LoadedPage` dans `loadPage.ts` : « the caller renders its 404 body » → « `BaseLayout` rend `NotFoundBody` quand `Astro.response.status === 404` ».

- [ ] **Step 4: Relancer les tests**

```bash
pnpm --filter @astrotan/web test -- src/pages/_tests/404.test.ts src/pages/_tests/unpublished-page.test.ts
```

Expected: PASS. Les deux tests 404 existants restent verts (même titre, même phrase, header/footer).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotFoundBody.astro \
  apps/web/src/layouts/BaseLayout.astro \
  apps/web/src/pages/404.astro \
  apps/web/src/pages/_tests/404.test.ts \
  apps/web/src/pages/_tests/unpublished-page.test.ts \
  apps/web/src/pages/_tests/Status404Slot.astro \
  apps/web/src/pages/_tests/BlogIndexSlot.astro \
  apps/web/src/pages/_tests/UnpublishedFonctionnalites.astro
git commit -m "$(cat <<'EOF'
fix(web): afficher le 404 depuis BaseLayout, pas depuis chaque page

Un vibecodeur qui oublie le ternaire servait encore le corps d'une page
non publiée. Le statut HTTP, pas page === null, est le discriminant
(/blog passe page=null sans être un 404).
EOF
)"
```

### Task 2: Bandeau d'aperçu via `Astro.locals.preview`

**Files:**
- Modify: `apps/web/src/env.d.ts`
- Modify: `apps/web/src/lib/loadPage.ts`
- Modify: `apps/web/src/lib/loadPost.ts`
- Modify: `apps/web/src/layouts/BaseLayout.astro`
- Modify: `apps/web/src/layouts/BlogLayout.astro`
- Test: `apps/web/src/pages/_tests/preview-banner.test.ts`

- [ ] **Step 1: Écrire le test du bandeau (RED)**

Créer `apps/web/src/pages/_tests/PreviewSlot.astro` (même dossier que `404.test.ts`, donc `../../layouts`) :

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro"
Astro.locals.preview = true
---
<BaseLayout page={null} fallbackTitle="Aperçu">
  <p>corps-visible</p>
</BaseLayout>
```

Créer `apps/web/src/pages/_tests/preview-banner.test.ts` :

```ts
import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test, vi } from "vitest"

vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query: async () => null }),
}))

test("BaseLayout affiche le bandeau d'aperçu quand locals.preview est vrai", async () => {
  const container = await AstroContainer.create()
  const { default: Page } = await import("./PreviewSlot.astro")
  const html = await container.renderToString(Page, {
    locals: { nonce: "test-nonce", preview: true },
  })
  expect(html).toContain("Aperçu — cet article n'est pas publié")
  expect(html).toContain("corps-visible")
  expect(html).toContain("preview-banner")
})

test("sans locals.preview, aucun bandeau", async () => {
  const container = await AstroContainer.create()
  const { default: BaseLayout } = await import("../../layouts/BaseLayout.astro")
  const html = await container.renderToString(BaseLayout, {
    props: { page: null, fallbackTitle: "Blog" },
    locals: { nonce: "test-nonce" },
    slots: { default: "<p>corps-visible</p>" },
  })
  expect(html).not.toContain("preview-banner")
  expect(html).toContain("corps-visible")
})
```

Le texte du bandeau reprend `BlogLayout.astro` L61–66 mot pour mot (pages et articles partagent le même libellé — 15 minutes, non publié).

- [ ] **Step 2: Lancer le test et confirmer l'échec**

```bash
pnpm --filter @astrotan/web test -- src/pages/_tests/preview-banner.test.ts
```

Expected: FAIL — `preview` n'existe pas sur `Locals`, le bandeau n'est pas dans `BaseLayout`.

- [ ] **Step 3: Implémentation minimale**

`apps/web/src/env.d.ts` — dans `interface Locals`, après `nonce?: string` :

```ts
    /**
     * `true` quand `loadPage` / `loadPost` a accepté un jeton d'aperçu.
     * Le bandeau vit dans `BaseLayout`, une seule fois.
     */
    preview?: boolean
```

`loadPage.ts` — juste avant `return { page, preview: true }` (vers L106) :

```ts
      astro.locals.preview = true
      astro.cache.set(false)
      astro.response.headers.set("x-robots-tag", "noindex, nofollow")
      return { page, preview: true }
```

`loadPost.ts` — même geste avant `return { post, preview: true }` (vers L90).

`BaseLayout.astro` — juste après `<Header />`, avant `<main>` :

```astro
    {Astro.locals.preview && (
      <p class="preview-banner">
        Aperçu — cet article n'est pas publié. Le lien expire au bout de 15
        minutes.
      </p>
    )}
```

Et dans le `<style>` existant du layout, ajouter les règles de `BlogLayout.astro` L106–114 (`.preview-banner`).

`BlogLayout.astro` — retirer le bloc `{preview && ( <p class="preview-banner">…` (L61–66) et le style `.preview-banner` (L106–114). Préfixer la destructuration `preview: _preview` pour éviter un unused. Laisser la prop sur l'interface.

- [ ] **Step 4: Relancer**

```bash
pnpm --filter @astrotan/web test -- src/pages/_tests/preview-banner.test.ts src/pages/_tests/404.test.ts src/pages/_tests/unpublished-page.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/env.d.ts apps/web/src/lib/loadPage.ts apps/web/src/lib/loadPost.ts \
  apps/web/src/layouts/BaseLayout.astro apps/web/src/layouts/BlogLayout.astro \
  apps/web/src/pages/_tests/preview-banner.test.ts \
  apps/web/src/pages/_tests/PreviewSlot.astro
git commit -m "$(cat <<'EOF'
feat(web): afficher le bandeau d'aperçu depuis BaseLayout

loadPage et loadPost posent locals.preview ; BlogLayout n'a plus
de copie qui doublerait le bandeau sur un article.
EOF
)"
```

### Task 3: Skill `add-page` et commentaires périmés

**Files:**
- Modify: `.claude/skills/add-page/SKILL.md`
- Modify: `apps/web/src/lib/previewToken.ts`
- Modify: `apps/web/astro.config.ts`
- Modify: `apps/web/src/pages/contact.astro`

Pas de test (docs / commentaires). Vérifier que les tests web existants restent verts.

- [ ] **Step 1: Corriger le skill**

Dans `.claude/skills/add-page/SKILL.md` :

Remplacer le frontmatter d'exemple (L33–39) par :

```astro
export const prerender = false

import { loadPage } from "../lib/loadPage"
import BaseLayout from "../layouts/BaseLayout.astro"
const { page } = await loadPage(Astro)
```

Note sous l'exemple : « Omettre le slug. `loadPage` le dérive du chemin. Le seul appelant légitime d'un slug explicite est `index.astro`, parce que `/` n'a pas de segment. »

Remplacer toute la section « 2. Rendre le 404 et le contenu séparément » (L47–58) par :

```markdown
### 2. Envelopper dans `BaseLayout`

```astro
<BaseLayout page={page} fallbackTitle="…">
  <!-- le contenu de la page -->
</BaseLayout>
```

`loadPage` pose le statut 404 quand la ligne n'est pas publiée. `BaseLayout`
rend alors le corps 404 à la place du slot — **aucun ternaire n'est requis**.
Un vibecodeur qui oublie `{page === null ? …}` n'expose pas un brouillon.
```

- [ ] **Step 2: Corriger les commentaires périmés**

`apps/web/src/lib/previewToken.ts` L1–3 : remplacer la mention de `src/pages/preview/[type]/[id].astro` par `loadPage` / `loadPost` (l'aperçu s'ouvre sur l'URL réelle, `?t=`).

`apps/web/astro.config.ts` L44 : remplacer `` `/preview/[type]/[id]` `` par « les routes d'aperçu (`loadPage` / `loadPost` quand `?t=` est valide) ».

`apps/web/src/pages/contact.astro` L4–19 : le formulaire EST porté (`api/contact.ts` existe). Remplacer le bloc par un commentaire vrai : la page poste vers `/api/contact`, qui valide, limite le débit, et écrit un lead. Ne plus dire « PAS porté » ni lister un endpoint à créer.

- [ ] **Step 3: Vérifier que rien n'a cassé**

```bash
pnpm --filter @astrotan/web test
```

Expected: PASS (suite web entière).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/add-page/SKILL.md apps/web/src/lib/previewToken.ts \
  apps/web/astro.config.ts apps/web/src/pages/contact.astro
git commit -m "$(cat <<'EOF'
docs(web): le skill add-page n'exige plus le ternaire 404

BaseLayout suffit. Les commentaires qui citaient /preview/[type]/[id]
ou un formulaire de contact « pas porté » sont alignés sur le code.
EOF
)"
```

---

## Chunk 2: SEO honnête

`$pageId.tsx` ~L154 et `$postId.tsx` `autoFieldsOf` omettent `ogImageId` : un save écrase le champ. `referencement.tsx` le préserve déjà mais n'a pas de picker.

### Task 4: Helper `buildSeo` qui préserve `ogImageId`

**Files:**
- Create: `apps/admin/src/lib/buildSeo.ts`
- Create: `apps/admin/src/lib/buildSeo.test.ts`

- [ ] **Step 1: Écrire les tests (RED)**

```ts
import { expect, test } from "vitest"
import { buildSeo } from "./buildSeo"

test("préserve ogImageId existant quand le formulaire ne le touche pas", () => {
  const seo = buildSeo({
    existing: { ogImageId: "kg01" as never, title: "Ancien" },
    fields: { title: "Nouveau", description: "Desc", canonicalUrl: "", noindex: false },
  })
  expect(seo).toEqual({
    title: "Nouveau",
    description: "Desc",
    canonicalUrl: undefined,
    noindex: false,
    ogImageId: "kg01",
  })
})

test("omet ogImageId s'il n'y en a jamais eu", () => {
  const seo = buildSeo({
    existing: undefined,
    fields: { title: "T", description: "", canonicalUrl: "", noindex: true },
  })
  expect(seo.ogImageId).toBeUndefined()
  expect(seo.noindex).toBe(true)
})

test("un choix explicite remplace l'existant", () => {
  const seo = buildSeo({
    existing: { ogImageId: "kg01" as never },
    fields: {
      title: "",
      description: "",
      canonicalUrl: "",
      noindex: false,
      ogImageId: "kg02" as never,
    },
  })
  expect(seo.ogImageId).toBe("kg02")
})

test("null retire ogImageId (clear)", () => {
  const seo = buildSeo({
    existing: { ogImageId: "kg01" as never },
    fields: {
      title: "",
      description: "",
      canonicalUrl: "",
      noindex: false,
      ogImageId: null,
    },
  })
  expect(seo).not.toHaveProperty("ogImageId")
})
```

Typer `ogImageId` en générique `T extends string` pour que les call sites Convex gardent `Id<"_storage">` sans cast.

- [ ] **Step 2: Lancer et confirmer l'échec**

```bash
pnpm --filter @astrotan/admin test -- src/lib/buildSeo.test.ts
```

Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémentation minimale**

`apps/admin/src/lib/buildSeo.ts` :

```ts
export type SeoFields<T extends string = string> = {
  title: string
  description: string
  canonicalUrl: string
  noindex: boolean
  ogImageId?: T | null
}

export function buildSeo<T extends string = string>({
  existing,
  fields,
}: {
  existing?: { ogImageId?: T }
  fields: SeoFields<T>
}): {
  title?: string
  description?: string
  canonicalUrl?: string
  noindex: boolean
  ogImageId?: T
} {
  const title = fields.title.trim() || undefined
  const description = fields.description.trim() || undefined
  const canonicalUrl = fields.canonicalUrl.trim() || undefined

  let ogImageId: T | undefined
  if (fields.ogImageId === null) {
    ogImageId = undefined
  } else if (fields.ogImageId !== undefined) {
    ogImageId = fields.ogImageId
  } else {
    ogImageId = existing?.ogImageId
  }

  return {
    title,
    description,
    canonicalUrl,
    noindex: fields.noindex,
    ...(ogImageId === undefined ? {} : { ogImageId }),
  }
}
```

- [ ] **Step 4: Relancer — PASS**

```bash
pnpm --filter @astrotan/admin test -- src/lib/buildSeo.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/buildSeo.ts apps/admin/src/lib/buildSeo.test.ts
git commit -m "$(cat <<'EOF'
fix(admin): préserver ogImageId à chaque assemblage SEO

Un save qui omettait le champ l'écrasait en base. Le helper le
reconduit depuis la ligne, sauf clear explicite.
EOF
)"
```

### Task 5: `OgImageField` + branchement pages / posts / référencement

**Files:**
- Create: `apps/admin/src/components/OgImageField.tsx` (< 200 lignes ; s'inspirer de `CoverField` dans `$postId.tsx` L908–980)
- Modify: `apps/admin/src/routes/_authed/pages/$pageId.tsx` (objet `seo` ~L154 + champ UI après le switch noindex ~L444)
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx` (`autoFieldsOf` ~L230 + champ UI)
- Modify: `apps/admin/src/routes/_authed/settings/referencement.tsx`
- Test: les tests `buildSeo` suffisent pour la forme ; pas de montage Convex.

- [ ] **Step 1: Extraire `OgImageField` (fichier complet)**

`apps/admin/src/components/OgImageField.tsx` — coller tel quel (adapté de `CoverField` L908–980, libellés « partage », bouton Retirer, `size-20` = 5 rem) :

```tsx
import { useState } from "react"
import { useQuery } from "convex/react"
import { ImageIcon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { MediaPicker } from "@/components/media-picker"
import { Button } from "@/components/ui/button"

export function OgImageField({
  value,
  disabled,
  onChange,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage"> | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <p className="text-sm text-muted-foreground">Aucune image de partage.</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
            {selected?.url ? (
              <img
                src={selected.url}
                alt={selected.alt}
                className="size-full object-cover"
              />
            ) : (
              <ImageIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">
              {selected?.filename ?? "Fichier hors médiathèque"}
            </p>
            <p className="truncate text-muted-foreground">
              {selected?.alt ?? "Texte alternatif inconnu"}
            </p>
          </div>
        </div>
      )}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            {value === null ? "Choisir une image" : "Changer d'image"}
          </Button>
          {value !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              Retirer
            </Button>
          )}
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Image de partage"
        description="Affichée quand la page est partagée sur les réseaux."
      />
    </div>
  )
}
```

- [ ] **Step 2: Brancher les trois écrans**

`$pageId.tsx` — state + assemblage + champ sous le switch noindex :

```ts
const [seoOgImageId, setSeoOgImageId] = useState<Id<"_storage"> | null>(
  page.seo?.ogImageId ?? null,
)
// dans autoFields :
seo: buildSeo({
  existing: page.seo,
  fields: {
    title: seoTitle,
    description: seoDescription,
    canonicalUrl: seoCanonicalUrl,
    noindex: seoNoindex,
    ogImageId: seoOgImageId,
  },
}),
```

```tsx
<OgImageField
  value={seoOgImageId}
  disabled={!canWrite}
  onChange={setSeoOgImageId}
/>
```

`$postId.tsx` — ajouter `seoOgImageId: Id<"_storage"> | null` à `PostFormValues` ; init `post.seo?.ogImageId ?? null`.

`autoFieldsOf` exact :

```ts
    seo: buildSeo({
      fields: {
        title: values.seoTitle,
        description: values.seoDescription,
        canonicalUrl: values.seoCanonicalUrl,
        noindex: values.seoNoindex,
        ogImageId: values.seoOgImageId,
      },
    }),
```

Sous le `form.Field name="seoNoindex"` (~L685), ajouter :

```tsx
        <form.Field
          name="seoOgImageId"
          children={(field) => (
            <OgImageField
              value={field.state.value}
              disabled={!canWrite}
              onChange={(next) => field.handleChange(next)}
            />
          )}
        />
```

`referencement.tsx` :

```ts
const [ogImageId, setOgImageId] = useState<Id<"_storage"> | null>(
  settings?.defaultSeo?.ogImageId ?? null,
)
// defaultSeo:
defaultSeo: buildSeo({
  existing: settings?.defaultSeo,
  fields: { title, description, canonicalUrl, noindex, ogImageId },
}),
```

```tsx
<OgImageField
  value={ogImageId}
  disabled={!canWrite}
  onChange={setOgImageId}
/>
```

Pas de cast `as Id<"_storage">` : le générique de `buildSeo` le conserve.

- [ ] **Step 3: Tests admin de la zone**

```bash
pnpm --filter @astrotan/admin test -- src/lib/buildSeo.test.ts
```

Expected: PASS. Ne pas lancer toute la suite admin ici (Chunk 4 la relancera).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/OgImageField.tsx \
  apps/admin/src/routes/_authed/pages/\$pageId.tsx \
  apps/admin/src/routes/_authed/posts/\$postId.tsx \
  apps/admin/src/routes/_authed/settings/referencement.tsx
git commit -m "$(cat <<'EOF'
feat(admin): picker ogImageId sur les pages, articles et SEO par défaut

L'image de partage n'est plus un champ fantôme écrasé à chaque save.
EOF
)"
```

---

## Chunk 3: Blog template

`tags.list` est session-gated. `markdownToPlainText` est appelé sur du HTML Tiptap.

### Task 6: `htmlToPlainText`

**Files:**
- Modify: `apps/web/src/lib/markdown.ts`
- Modify: `apps/web/src/lib/markdown.test.ts`
- Modify: `apps/web/src/pages/blog/index.astro`
- Modify: `apps/web/src/pages/blog/[slug].astro`

- [ ] **Step 1: Tests (RED)**

Ajouter dans `markdown.test.ts`, après le bloc `markdownToPlainText` :

```ts
describe("htmlToPlainText", () => {
  test("retire les balises HTML et insère un blanc entre les blocs", () => {
    // Tiptap colle `</h2><p>` sans whitespace. sanitize-html à allowlist
    // vide les concatène (« TitreVoir ») si on ne remplace pas les balises
    // de bloc par un espace AVANT le strip.
    const text = htmlToPlainText(
      '<h2>Titre</h2><p>Voir <a href="https://exemple.fr">le site</a>.</p>',
    )
    expect(text).toBe("Titre Voir le site.")
  })

  test("coupe sur un mot entier", () => {
    expect(htmlToPlainText("alpha bravo charlie delta", 14)).toBe("alpha bravo…")
  })

  test("n'exécute pas le Markdown : un # reste un #", () => {
    expect(htmlToPlainText("# pas-un-titre")).toBe("# pas-un-titre")
  })
})
```

Importer `htmlToPlainText`. Remplacer aussi les `https://illith.com` de **ce fichier** par `https://exemple.fr` et `_ILLITH_` / `[ILLITH]` par `_Exemple_` / `[Exemple]` (Chunk 6 les exigerait de toute façon ; le faire ici évite un test rouge entre les deux chunks). Mettre à jour les assertions du même geste.

- [ ] **Step 2: Lancer — FAIL sur `htmlToPlainText` (et PASS sur les remplacements Illith une fois faits)**

```bash
pnpm --filter @astrotan/web test -- src/lib/markdown.test.ts
```

Expected: FAIL — `htmlToPlainText` is not exported. Si les URLs Illith sont déjà remplacées dans le test mais pas encore dans d'autres assertions, corriger les deux côtés ensemble.

- [ ] **Step 3: Implémentation**

Dans `markdown.ts`, extraire le décodage / coupe vers `collapseAndTrim(text: string, maxLength: number): string` (les `.replace(/&amp;/g…)` + coupe actuels). Puis :

```ts
const BLOCK_GAP = /<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi

export function htmlToPlainText(body: string, maxLength = 200): string {
  const withGaps = body.replace(BLOCK_GAP, " ")
  const text = sanitizeHtml(withGaps, { allowedTags: [], allowedAttributes: {} })
  return collapseAndTrim(text, maxLength)
}

export function markdownToPlainText(body: string, maxLength = 200): string {
  return htmlToPlainText(marked.parse(body, { async: false }) as string, maxLength)
}
```

Le remplacement des balises de bloc par un espace AVANT le strip est load-bearing pour le HTML Tiptap compact. `markdownToPlainText` continue de passer par `marked` puis `htmlToPlainText`.

Dans `blog/index.astro` et `blog/[slug].astro` : importer `htmlToPlainText` et l'appeler sur `post.body` à la place de `markdownToPlainText`.

- [ ] **Step 4: Relancer**

```bash
pnpm --filter @astrotan/web test -- src/lib/markdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/markdown.ts apps/web/src/lib/markdown.test.ts \
  apps/web/src/pages/blog/index.astro apps/web/src/pages/blog/\[slug\].astro
git commit -m "$(cat <<'EOF'
fix(web): extraire le plain text d'un corps HTML, pas du Markdown

Les articles Tiptap passaient par marked, qui interprétait les balises
comme du texte Markdown.
EOF
)"
```

### Task 7: `tags.listPublic` + pastilles sur `/blog`

**Files:**
- Modify: `packages/backend/convex/tags.ts`
- Modify: `packages/backend/convex/tags.test.ts`
- Modify: `packages/backend/convex/pages.publicQueryFamily.test.ts` (enseigner la forme d'args)
- Modify: `apps/web/src/lib/loadPost.ts` (`PostSummary.tagIds`)
- Modify: `apps/web/src/pages/blog/index.astro`
- Modify: `apps/web/src/components/blog/BlogCard.astro`
- Skill: `.claude/skills/convex-function/SKILL.md` — le lire avant d'écrire la query.

`listPublic` n'est **pas** une mutation : pas de `MUTATION_REGISTRY`.

- [ ] **Step 1: Test backend (RED)**

Dans `tags.test.ts` :

```ts
test("listPublic n'exige pas de session et ne rend que _id, name, slug", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await editor.identity.mutation(api.tags.create, { name: "Astro" })

  const rows = await t.query(api.tags.listPublic, {})
  expect(rows).toEqual([
    expect.objectContaining({ _id: id, name: "Astro", slug: "astro" }),
  ])
  expect(Object.keys(rows[0]!).sort()).toEqual(["_id", "name", "slug"])
})

test("listPublic filtre aux ids demandés", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const keep = await editor.identity.mutation(api.tags.create, { name: "Gardé" })
  await editor.identity.mutation(api.tags.create, { name: "Ignoré" })

  const rows = await t.query(api.tags.listPublic, { ids: [keep] })
  expect(rows).toHaveLength(1)
  expect(rows[0]?._id).toBe(keep)
})

test("list exige encore une session", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.tags.list, {})).rejects.toThrow()
})
```

- [ ] **Step 2: Lancer — FAIL**

```bash
pnpm --filter @astrotan/backend test -- convex/tags.test.ts
```

Expected: FAIL — `listPublic` n'existe pas. `publicQueryFamily` échouera aussi dès que la query existe sans forme d'args enseignée : enseigner dans la même tâche.

- [ ] **Step 3: Implémentation**

Dans `tags.ts` :

```ts
export const listPublic = query({
  args: { ids: v.optional(v.array(v.id("tags"))) },
  handler: async (ctx, args) => {
    const rows =
      args.ids === undefined
        ? await ctx.db.query("tags").collect()
        : (
            await Promise.all(args.ids.map((id) => ctx.db.get(id)))
          ).filter((row): row is NonNullable<typeof row> => row !== null)
    return rows
      .map(({ _id, name, slug }) => ({ _id, name, slug }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  },
})
```

Dans `pages.publicQueryFamily.test.ts`, avant le `else` final (~L209), ajouter :

```ts
    } else if (q.argFields.length === 1 && q.argFields[0] === "ids") {
      // tags.listPublic : les tags n'ont pas de statut. Projection
      // minimale, pas de fuite de brouillon possible. La forme doit être
      // déclarée pour ne pas tomber dans le throw du bas.
      args = { ids: [] }
```

`KNOWN_UNGATED` : **ne pas** y ajouter `tags.listPublic` sauf si l'appel sans identité réussit (il réussira). L'assertion est `arrayContaining` : un extra est OK. Si `ids: []` court-circuite le handler vers une liste vide, `assertNoDraftLeak` passe.

`PostSummary` dans `loadPost.ts` : ajouter `tagIds?: string[]`.

`blog/index.astro` : collecter les `tagIds` des posts. **Si le tableau d'ids est vide, ne pas appeler Convex** (pas de `listPublic({})` « pour éviter un appel » — un `{}` ferait un `collect()` de tous les tags). Sinon `api.tags.listPublic, { ids }`. Construire `Map<id, { name, slug }>`. Passer `tags` à `BlogCard`.

`BlogCard.astro` a déjà 203 lignes : extraire `apps/web/src/components/blog/TagPills.astro` (< 80 lignes) plutôt que d'allonger la carte. Prop `tags: { name: string; slug: string }[]`. `<ul>` de `<li>` sous le titre, border, radius-full, font-size 0.75rem. Retirer le commentaire « Retiré du template : TagList » de `BlogCard.astro`.

- [ ] **Step 4: Tests**

```bash
pnpm --filter @astrotan/backend test -- convex/tags.test.ts convex/pages.publicQueryFamily.test.ts
pnpm --filter @astrotan/web test -- src/pages/_tests/unpublished-page.test.ts
```

Expected: PASS. Si `publicQueryFamily` lève « argument shape this test doesn't know how to drive » pour `ids`, le Step 3 n'est pas fini.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/tags.ts packages/backend/convex/tags.test.ts \
  packages/backend/convex/pages.publicQueryFamily.test.ts \
  apps/web/src/lib/loadPost.ts   apps/web/src/pages/blog/index.astro \
  apps/web/src/components/blog/BlogCard.astro \
  apps/web/src/components/blog/TagPills.astro
git commit -m "$(cat <<'EOF'
feat(web): pastilles de tags publics sur /blog

tags.listPublic ne rend que _id, name, slug, sans session — tags.list
reste derrière un rôle.
EOF
)"
```

---

## Chunk 4: Admin honnête

### Task 8: Un admin n'invite / ne promeut que `editor`

**Files:**
- Create: `apps/admin/src/lib/assignableRoles.ts`
- Create: `apps/admin/src/lib/assignableRoles.test.ts`
- Modify: `apps/admin/src/routes/_authed/users.tsx` (~L85 `EDITABLE_ROLE_ITEMS`, ~L335 Select, ~L487 InviteDialog, ~L199 texte Resend)

- [ ] **Step 1: Tests (RED)**

```ts
import { expect, test } from "vitest"
import { assignableRoles, canEditTargetRole } from "./assignableRoles"

test("un owner peut assigner admin et editor", () => {
  expect(assignableRoles("owner")).toEqual({
    admin: "Administrateur",
    editor: "Éditeur",
  })
})

test("un admin ne peut assigner que editor", () => {
  expect(assignableRoles("admin")).toEqual({ editor: "Éditeur" })
})

test("un admin ne change pas le rôle d'un autre admin (Badge, pas Select)", () => {
  expect(canEditTargetRole("admin", "admin")).toBe(false)
  expect(canEditTargetRole("owner", "admin")).toBe(true)
  expect(canEditTargetRole("admin", "editor")).toBe(true)
  expect(canEditTargetRole("owner", "owner")).toBe(false)
})
```

- [ ] **Step 2: FAIL puis implémenter**

```bash
pnpm --filter @astrotan/admin test -- src/lib/assignableRoles.test.ts
```

```ts
export function assignableRoles(
  actorRole: "owner" | "admin" | "editor",
): Record<string, string> {
  if (actorRole === "owner") {
    return { admin: "Administrateur", editor: "Éditeur" }
  }
  return { editor: "Éditeur" }
}

export function canEditTargetRole(
  actorRole: "owner" | "admin" | "editor",
  targetRole: "owner" | "admin" | "editor" | null,
): boolean {
  if (targetRole === null || targetRole === "owner") return false
  if (actorRole === "owner") return targetRole === "admin" || targetRole === "editor"
  return targetRole === "editor"
}
```

- [ ] **Step 3: Brancher `users.tsx`**

`UsersPage` connaît déjà `profile.role`. Passer `actorRole={profile.role}` à `UsersScreen`, `UsersTable`, `UserTableRow`, `InviteDialog`.

Remplacer `canChangeRole` par `canEditTargetRole(actorRole, role)`. Mapper les `SelectItem` sur `Object.entries(assignableRoles(actorRole))` (plus d'items `admin` en dur). `InviteDialog` reçoit `actorRole` et utilise les mêmes `items`.

Règle UI (tenue par `canEditTargetRole`) :
- owner : Select admin+editor sur chaque ligne non-owner
- admin : Select editor-only sur les editors ; Badge inerte sur les admins
- masquer « Retirer » pour un admin qui vise un autre admin (`users.remove` refuse déjà)

Texte L199–201, remplacer par :

```
Le lien est la voie de récupération si l'email n'arrive pas. L'envoi
dépend de Resend, configuré depuis Réglages → E-mails.
```

- [ ] **Step 4: Tests**

```bash
pnpm --filter @astrotan/admin test -- src/lib/assignableRoles.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/assignableRoles.ts apps/admin/src/lib/assignableRoles.test.ts \
  apps/admin/src/routes/_authed/users.tsx
git commit -m "$(cat <<'EOF'
fix(admin): un admin n'invite et ne promeut que des éditeurs

Le Select proposait admin alors que le serveur refuse. Le texte sur
Resend ne prétend plus que l'envoi échoue toujours.
EOF
)"
```

### Task 9: Pastille leads + clear cover

**Files:**
- Modify: `apps/admin/src/components/nav-main.tsx` (prop optionnelle `badge?: number`)
- Modify: `apps/admin/src/components/app-sidebar.tsx`
- Create: `apps/admin/src/components/nav-main.test.tsx` (ou étendre un test existant si un fichier teste déjà NavMain — aucun aujourd'hui : créer)
- Modify: `packages/backend/convex/posts.ts` (`update` args + handler)
- Modify: `packages/backend/convex/posts.test.ts`
- Modify: `apps/admin/src/routes/_authed/posts/$postId.tsx` (`autoFieldsOf` + bouton retirer sur `CoverField`)

**Validator actuel :** `coverId: v.optional(v.id("_storage"))` — `null` est **refusé** par Convex (args et document). Chemin unique : `v.optional(v.union(v.id("_storage"), v.null()))` + `ctx.db.replace` sans `coverId`, `_id` ni `_creationTime`. `patch({ coverId: undefined })` et `patch({ coverId: null })` sont interdits (le second casse le schéma). Aucun `replace` n'existe encore dans le dépôt : coller le snippet, ne pas « chercher un test existant ».

**Ne pas `return` avant** `mintRenameRedirect` / l'outbox (`posts.ts` ~L261–298). Construire le document remplacé, `replace`, puis enchaîner les effets de bord existants.

```ts
    const { _id, _creationTime, coverId: _oldCover, ...kept } = post
    const next = { ...kept, ...patch }
    if (args.coverId === null) {
      // `coverId` absent du replace = champ optionnel retiré.
    } else if (args.coverId !== undefined) {
      await assertCoverResolvable(ctx, args.coverId)
      next.coverId = args.coverId
    } else if (_oldCover !== undefined) {
      next.coverId = _oldCover
    }
    await ctx.db.replace(args.id, next)
    // puis mintRenameRedirect + outbox, inchangés
```

Si `args.coverId` est omis, reconduire `_oldCover`. Si `null`, l'omettre.

Skill `convex-function` : pas de nouvelle entrée au registre (`posts.update` y est déjà).

- [ ] **Step 1: Tests (RED)**

Backend — dans `posts.test.ts` :

```ts
test("update accepte coverId: null et retire la couverture", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Avec couverture",
    slug: "avec-couverture",
  })
  const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])))
  await owner.identity.mutation(api.posts.update, { id, coverId: storageId })
  expect((await t.run((ctx) => ctx.db.get(id)))?.coverId).toBe(storageId)

  await owner.identity.mutation(api.posts.update, { id, coverId: null })
  expect((await t.run((ctx) => ctx.db.get(id)))?.coverId).toBeUndefined()
})
```

Lire `posts.test.ts` pour le helper d'upload existant (`storeBlob` ou équivalent) et s'en servir. S'il n'y en a pas, extraire le `storeBlob` de `media.test.ts` n'est pas demandé : appeler `t.run(ctx => ctx.storage.store(...))` comme `media.test.ts`.

Admin — **ne pas monter `NavMain`** (`Link` + `useSidebar` exigent RouterProvider + SidebarProvider ; `settings-nav.test.tsx` refuse déjà ce harnais). Extraire `leadsBadge(count: number | undefined): number | undefined` dans `apps/admin/src/lib/leadsBadge.ts` :

```ts
export function leadsBadge(count: number | undefined): number | undefined {
  return typeof count === "number" && count > 0 ? count : undefined
}
```

Test `apps/admin/src/lib/leadsBadge.test.ts` : `leadsBadge(3) === 3`, `leadsBadge(0)` et `leadsBadge(undefined)` sont `undefined`.

Contrat client couverture — extraire `autoFieldsOf` n'est pas exigé (il vit dans `$postId.tsx`). Tester la forme via un helper exporté `coverPatch(coverId: Id<"_storage"> | null)` dans `apps/admin/src/lib/coverPatch.ts` :

```ts
export function coverPatch<T extends string>(coverId: T | null): { coverId: T | null } {
  return { coverId }
}
```

```ts
test("null est envoyé, pas omis", () => {
  expect(coverPatch(null)).toEqual({ coverId: null })
})
```

`$postId.tsx` `autoFieldsOf` utilisera `...coverPatch(values.coverId)` à la place du spread conditionnel.

- [ ] **Step 2: FAIL puis implémenter**

`posts.ts` args : `coverId: v.optional(v.union(v.id("_storage"), v.null()))`. Handler : le `replace` du Step note ci-dessus (pas de `patch.coverId = undefined`). Conserver `mintRenameRedirect` + drain outbox après le `replace`.

`$postId.tsx` `autoFieldsOf` :

```ts
    ...coverPatch(values.coverId),
```

Retirer le commentaire L224–227 (il deviendrait faux). Sur `CoverField`, ajouter un bouton « Retirer » quand `value !== null` qui appelle `onChange(null)`.

`nav-main.tsx` : étendre le type d'item avec `badge?: number`. Importer `SidebarMenuBadge`. Après `<span>{item.title}</span>` sur la branche **lien simple** (Leads n'a pas d'enfants) :

```tsx
{typeof item.badge === "number" && item.badge > 0 && (
  <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
)}
```

`app-sidebar.tsx` — `leads.newCount` existe déjà, ne pas le recréer :

```ts
  const newLeads = useQuery(api.leads.newCount)
  const leadsItem = {
    ...LEADS_ITEM,
    ...(leadsBadge(newLeads) === undefined ? {} : { badge: leadsBadge(newLeads) }),
  }
```

Remplacer `LEADS_ITEM` par `leadsItem` dans les deux listes `base`.

- [ ] **Step 3: Tests**

```bash
pnpm --filter @astrotan/backend test -- convex/posts.test.ts
pnpm --filter @astrotan/admin test -- src/lib/leadsBadge.test.ts src/lib/coverPatch.test.ts src/lib/assignableRoles.test.ts src/lib/buildSeo.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/posts.ts packages/backend/convex/posts.test.ts \
  apps/admin/src/routes/_authed/posts/\$postId.tsx \
  apps/admin/src/components/nav-main.tsx \
  apps/admin/src/components/app-sidebar.tsx \
  apps/admin/src/lib/leadsBadge.ts apps/admin/src/lib/leadsBadge.test.ts \
  apps/admin/src/lib/coverPatch.ts apps/admin/src/lib/coverPatch.test.ts
git commit -m "$(cat <<'EOF'
fix(admin): pastille des nouveaux leads et retrait de la couverture

coverId: null est désormais un argument valide de posts.update.
EOF
)"
```

---

## Chunk 5: Tests sécurité + spec

### Task 10: Famille publique — brouillon d'article + ownership `media.update`

**Files:**
- Modify: `packages/backend/convex/pages.publicQueryFamily.test.ts`
- Modify: `packages/backend/convex/media.ts` (`update` ~L192–207)
- Modify: `packages/backend/convex/media.test.ts`
- Skill: `.claude/skills/convex-function/SKILL.md`

- [ ] **Step 1: Tests (RED)**

Dans `publicQueryFamily.test.ts`, après l'insert du brouillon **page**, insérer un brouillon **post** :

```ts
  const draftPostId = await t.run((ctx) =>
    ctx.db.insert("posts", {
      slug: "article-confidentiel",
      title: "Article confidentiel",
      body: "<p>secret</p>",
      status: "draft",
      tagIds: [],
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )
```

Étendre `assertNoDraftLeak(result, draftIds: string[], label)` : une liste ne doit contenir aucun des ids ; un objet unique ne doit matcher aucun. Appel dans la boucle :

```ts
    assertNoDraftLeak(result, [draftId, draftPostId], `${q.file}.${q.name}`)
```

Mettre à jour le commentaire M6 (« only these two ») : ce sont désormais quatre queries ungated.

Pour `getPublishedPost` (args `slug`) : le loop actuel envoie `slug: "brouillon-confidentiel"` (la **page**). Ajouter une branche, ou un second passage, qui appelle aussi avec `slug: "article-confidentiel"`. Le plus simple : si `q.file === "posts" && q.name === "getPublishedPost"`, utiliser le slug de l'article.

```ts
    } else if (q.argFields.length === 1 && q.argFields[0] === "slug") {
      args = {
        slug: q.file === "posts" ? "article-confidentiel" : "brouillon-confidentiel",
      }
```

```ts
  const KNOWN_UNGATED_PUBLIC_QUERIES = [
    "pages.getPublishedPage",
    "pages.listPublishedPages",
    "posts.getPublishedPost",
    "posts.listPublishedPosts",
  ]
```

Dans `media.test.ts`, miroir de « un editor ne peut remplacer que le fichier de ses propres médias » :

```ts
test("un editor ne peut mettre à jour que ses propres médias", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const foreign = await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId: await storeBlob(t),
  })
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.media.update, { id: foreign, alt: "volé" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})
```

- [ ] **Step 2: FAIL**

```bash
pnpm --filter @astrotan/backend test -- convex/pages.publicQueryFamily.test.ts convex/media.test.ts
```

Expected: `KNOWN_UNGATED` échoue (posts déjà ungated mais absents de la liste — **attendre** : `arrayContaining` passe si les noms sont déjà dans `checkedNames` !). Vérifier en lisant `checkedNames` actuel : `listPublishedPosts` / `getPublishedPost` tournent déjà sans session. Le test **passe** aujourd'hui pour KNOWN_UNGATED si on ajoute seulement les noms. Le vrai RED est : (1) le brouillon post n'est pas encore inséré donc on ne **prouve** rien ; (2) `media.update` n'a pas `requireOwnDocument` donc le test editor **passe à tort** (l'update réussit).

Donc : d'abord écrire le test media (RED : l'update **réussit**, `expect(...).rejects` échoue). Puis le test famille avec assert sur le draft post (si `getPublishedPost` filtre déjà, ce test est vert tout de suite — c'est un filet, pas un RED. L'écrire quand même ; s'il est vert du premier coup, le noter dans le commit, ne pas affaiblir le filtre pour forcer un RED).

- [ ] **Step 3: `media.update`**

```ts
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, row)
```

Importer `requireOwnDocument` (déjà dans `media.ts` pour `replaceFile`).

Étendre `assertNoDraftLeak` et `KNOWN_UNGATED` comme ci-dessus.

- [ ] **Step 4: PASS**

```bash
pnpm --filter @astrotan/backend test -- convex/pages.publicQueryFamily.test.ts convex/media.test.ts convex/lib/authz.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/pages.publicQueryFamily.test.ts \
  packages/backend/convex/media.ts packages/backend/convex/media.test.ts
git commit -m "$(cat <<'EOF'
fix(backend): ownership editor sur media.update et filet anti-brouillon posts

replaceFile vérifiait déjà le propriétaire ; update ne le faisait pas.
La famille publique enseigne désormais getPublishedPost / listPublishedPosts.
EOF
)"
```

### Task 11: Spec — plus d'instance canonique, plus de table `navigation`

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-astrotan-design.md`

- [ ] **Step 1: Éditer la spec (pas de test)**

§1 L9 : remplacer « Première instance : `illith.com` / `admin.illith.com`. » par « Le template n'a pas d'instance canonique : chaque adoptant pointe ses propres domaines. »

Tableau L15 : `exemple.fr` / `admin.exemple.fr` (exemples, pas une instance).

L173 : « same-origin sur le domaine de l'admin (ex. `admin.exemple.fr`). »

Tableau rôles L183 : remplacer la colonne `navigation · redirections · settings` par `redirections · settings`. Note sous le tableau : « La table `navigation` a été retirée au lot 4 : header et footer vivent dans le balisage, en code. »

Tableau §4 L75 : retirer la ligne `navigation`. Note : « Retirée au lot 4 — le menu n'est plus une table CMS. »

L300 : `https://exemple.fr/<slug>?t={token}` (URL réelle, plus `/preview/{type}/{id}`).

§6.5 L325 : remplacer le paragraphe `navigation` (header/footer en base) par : « Header et footer sont du balisage dans `Header.astro` / `Footer.astro` / `config/nav.ts`. Pas de table `navigation`. »

L345 : `Host(<WEB_DOMAIN>)`, `admin` sur `Host(<ADMIN_DOMAIN>)` — plus de hostname figé.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-astrotan-design.md
git commit -m "$(cat <<'EOF'
docs(spec): le template n'a pas d'instance canonique

Retrait de la table navigation (lot 4) et des hôtes Illith cités
comme s'ils étaient le déploiement de référence.
EOF
)"
```

---

## Chunk 6: Purge Illith

### Task 12: Grep `illith` et remplacer chaque occurrence committée

**Files:** tous les fichiers trackés que `rg -i illith` liste. Ne pas toucher aux `.env*` gitignorés.

Inventaire connu au moment du plan (re-greper avant d'éditer — la liste aura bougé après les chunks 1–5) :

| Fichier | Remplacement |
|---|---|
| `apps/web/src/lib/jsonLd.test.ts` | `SITE.siteName = "Exemple"`, `https://exemple.fr`, `linkedin.com/company/exemple` |
| `apps/web/src/lib/feeds.test.ts` | `ORIGIN = "https://exemple.fr"`, `siteName: "Exemple"` |
| `apps/web/src/lib/markdown.test.ts` | déjà traité en Task 6 ; vérifier 0 occurrence |
| `apps/admin/src/components/domain-check.tsx` + `.test.tsx` | `exemple.fr` dans les commentaires d'exemple DKIM |
| `apps/admin/src/routes/api/auth/$.ts` | `admin.exemple.fr` |
| `apps/admin/src/components/site-dashboard.test.tsx` | `umami.exemple.test` |
| `packages/backend/convex/analytics.test.ts` | `umami.exemple.test` |
| `packages/backend/convex/pages.crud.test.ts` | `https://exemple.fr/canonique` |
| `packages/backend/convex/settings.test.ts` | `siteName: "Exemple"` / `"Exemple École"` |
| `packages/backend/convex/lib/safeHref.test.ts` | `https://exemple.fr/page`, `mailto:contact@exemple.fr` |
| `packages/backend/convex/lib/passwordStrength.test.ts` | garder `Antoine2026!` + `antoine@exemple.fr` (partie locale `antoine` = `DERIVED_FROM_EMAIL`) ; garder `al@exemple.fr` (2 caractères, PAS `alice@`) |
| `packages/backend/convex/lib/signInRateLimit.test.ts` | `owner@exemple.test` (et la variante paddée) |
| `packages/backend/e2e/publicationLoop.e2e.test.ts` | `owner@exemple.test` / `adminB@exemple.test` (ne changer que le domaine) |
| `.claude/skills/better-auth/SKILL.md` | `admin.exemple.fr` |
| `docs/superpowers/plans/2026-08-27-lot1-socle.md` | `admin.exemple.fr` (doc historique, aligner quand même) |
| `docs/superpowers/plans/2026-08-28-lot5-infra.md` | `WEB_DOMAIN=exemple.fr` etc. |
| Spec | déjà Task 11 |

Ne **pas** inventer d'autres synonymes (`site.exemple`, `admin.exemple` sans TLD) : `exemple.fr` / `admin.exemple.fr` / `umami.exemple.test` / `owner@exemple.test`.

- [ ] **Step 1: Grep de contrôle (avant)**

```bash
rg -i -n --hidden illith --glob '!.git' --glob '!node_modules' --glob '!.worktrees' --glob '!.env*' --glob '!docs/superpowers/plans/2026-08-31-template-plug-and-play.md'
```

`--hidden` est obligatoire : sans lui `.claude/skills/better-auth/SKILL.md` est invisible. Exclure **ce plan** : il cite Illith pour décrire la purge. Si un `.env` local apparaît, le mentionner dans le rapport, **ne pas le committer**.

- [ ] **Step 2: Remplacer fichier par fichier, tests + assertions ensemble**

Pour chaque fichier de test : changer la fixture ET l'assertion dans le même edit. Relancer le fichier de test touché avant de passer au suivant.

```bash
pnpm --filter @astrotan/web test -- src/lib/jsonLd.test.ts src/lib/feeds.test.ts src/lib/markdown.test.ts
pnpm --filter @astrotan/admin test -- src/components/domain-check.test.tsx src/components/site-dashboard.test.tsx
pnpm --filter @astrotan/backend test -- convex/analytics.test.ts convex/pages.crud.test.ts convex/settings.test.ts convex/lib/safeHref.test.ts convex/lib/passwordStrength.test.ts convex/lib/signInRateLimit.test.ts
```

Ne pas lancer les e2e (`publicationLoop.e2e.test.ts`) : hors périmètre Playwright/e2e. Remplacer quand même les chaînes du fichier pour que le grep soit à 0.

- [ ] **Step 3: Grep de contrôle (après)**

```bash
rg -i -n --hidden illith --glob '!.git' --glob '!node_modules' --glob '!.worktrees' --glob '!.env*' --glob '!docs/superpowers/plans/2026-08-31-template-plug-and-play.md'
```

Expected: 0 hors ce plan. Dans `site-dashboard.test.tsx`, l'assertion `not.toContain("umami.illith.test")` doit devenir `not.toContain("umami.exemple.test")` **en même temps** que la fixture `SHARED` — sinon le filet ne détecte plus une fuite.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore: retirer tout nom et domaine Illith du template

Les fixtures et exemples utilisent exemple.fr. Le template n'a pas
d'instance canonique.
EOF
)"
```

Ne pas `git add` de fichier `.env`.

---

## Vérification finale (contrôleur, après toutes les tâches)

```bash
export PATH="/opt/homebrew/bin:$PATH"
rg -i --hidden illith --glob '!.git' --glob '!node_modules' --glob '!.env*' --glob '!docs/superpowers/plans/2026-08-31-template-plug-and-play.md'
pnpm --filter @astrotan/web test
pnpm --filter @astrotan/admin test
pnpm --filter @astrotan/backend test
```

Ne pas lancer `convex dev`. Ne pas merger. Ne pas pusher.
