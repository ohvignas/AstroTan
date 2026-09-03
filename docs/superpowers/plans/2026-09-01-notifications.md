# Notifications — cloche, e-mails, préférences Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloche dans le header admin, page Email & notifications (interrupteurs personnels + modèles), table `notifications`, e-mails immédiats pour nouveau lead et article publié via le catalogue existant.

**Architecture:** Une mutation d'événement (`leads.submit`, `posts.publishPost`) écrit les lignes cloche **et** planifie l'action Resend (`runAfter(0)`). Un seul résolveur (`lib/notifier.ts`) décide cloche / e-mail. Les gabarits restent `emails.*` + `CATALOGUE`. Expand only. Pas de file, pas de digest, pas d'API REST.

**Tech Stack:** Convex (schema expand, query/mutation/internalAction), catalogue `lib/catalogueEmails.ts`, Resend via `makeResend`, TanStack Start / React 19, shadcn Switch + DropdownMenu. Skills `@.claude/skills/convex-function`, `@.agents/skills/superpowers/writing-plans`.

**Spec:** [`docs/superpowers/specs/2026-09-01-notifications-design.md`](../specs/2026-09-01-notifications-design.md)

**Statut :** exécuté dans cette session (TDD, pas de commit). Les cases ci-dessous décrivent le travail ; le code est en place.

---

## Contraintes

- TDD. Fichiers nouveaux < 200 lignes. Helpers purs sous `convex/lib/`. Fixtures hors `convex/` (`packages/backend/testing/`).
- `requireRole` dans chaque query / mutation publique. Editor : prefs et cloche pour soi seulement.
- Expand only. Pas de champ retiré. Ne pas toucher `http.ts` / API REST / MCP.
- Ne pas lancer `npx convex dev` interactif. Codegen non interactif seulement si le typage `api.notifications` manque.
- **Ne pas committer** — working tree déjà sale, Antoine n'a pas demandé de commit.
- UI FR, code EN. `settings.get` ne gagne aucun champ.
- Tests : `pnpm --filter @astrotan/backend test`, `pnpm --filter @astrotan/admin test`.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/catalogueEmails.ts` | 4e clé `postPublished` ; `url` + `nom_du_site` sur lead |
| `packages/backend/convex/lib/notifier.ts` *(créer)* | défauts, candidats, insertion cloches, cascades |
| `packages/backend/convex/notifications.ts` *(créer)* | `mesPrefs`, `setPrefs`, `liste`, `marquerLu`, destinataires e-mail, `notifyPublished` |
| `packages/backend/convex/schema.ts` | tables `notificationPrefs` + `notifications` |
| `packages/backend/convex/leads.ts` | cloches dans `submit` ; `notifyStaff` lit le résolveur |
| `packages/backend/convex/posts.ts` | cloches + `runAfter` si brouillon → publié |
| `packages/backend/convex/lib/leadCascade.ts` | efface `notifications` `by_lead` |
| `packages/backend/convex/users.ts` | `users.remove` efface prefs + cloches |
| `packages/backend/convex/retention.ts` | `NOTIFICATION_RETENTION_DAYS = 90` |
| `packages/backend/convex/_dataRegistry.ts` | deux tables → « Gérer les comptes… » |
| `apps/web/src/config/legal.ts` | phrase `data` + `retention` allongées |
| `apps/admin/src/components/mes-notifications.tsx` *(créer)* | 2 lignes × 2 Switch |
| `apps/admin/src/components/notifications-cloche.tsx` *(créer)* | pastille + panneau |
| `apps/admin/src/routes/_authed/settings/emails.tsx` | bloc « Mes notifications » |
| `apps/admin/src/components/app-shell.tsx` | cloche à droite (`ml-auto`) |
| `packages/backend/testing/registryModules.ts` | `import "../convex/notifications"` |

Chemins lus, ne pas les inventer :

- Catalogue : `packages/backend/convex/lib/catalogueEmails.ts:19,36-170`
- `leads.submit` + `notifyStaff` : `packages/backend/convex/leads.ts:221-232,700-875`
- `posts.publishPost` : `packages/backend/convex/posts.ts:553-602`
- `deleteLeadCascade` : `packages/backend/convex/lib/leadCascade.ts:30-53`
- `users.remove` : `packages/backend/convex/users.ts:221-266`
- `retention.purge` : `packages/backend/convex/retention.ts:44-176`
- Écran emails : `apps/admin/src/routes/_authed/settings/emails.tsx:167-176`
- Header : `apps/admin/src/components/app-shell.tsx:43-47`
- Barrel : `packages/backend/testing/registryModules.ts`
- `SETTINGS_PAGES` porte déjà « Email & notifications » (`settings-nav.tsx:91-93`)

---

## Chunk 1: Catalogue

### Task 1: Quatrième clé et variables lead

**Files:**
- Modify: `packages/backend/convex/lib/catalogueEmails.ts`
- Test: `packages/backend/convex/lib/catalogueEmails.test.ts`
- Also: `packages/backend/convex/lib/gabarit.test.ts` (« dans les trois emails » doit passer `url`)

- [ ] **Step 1: Write the failing test**

Dans `catalogueEmails.test.ts`, le premier test passe à quatre clés, dans cet ordre :

```ts
expect(CATALOGUE.map((e) => e.cle)).toEqual([
  "invitation",
  "leadNotification",
  "passwordReset",
  "postPublished",
])
```

Ajouter :

```ts
test("leadNotification accepte encore lien et sujet, et gagne url", () => {
  const lead = CATALOGUE.find((e) => e.cle === "leadNotification")!
  expect(lead.variables).toEqual(
    expect.arrayContaining(["nom", "email", "sujet", "message", "lien", "url", "nom_du_site"]),
  )
  expect(VARIABLES_DE_CONFIANCE.leadNotification).toEqual(["lien", "url"])
  for (const champ of ["nom", "email", "sujet", "message"]) {
    expect(VARIABLES_DE_CONFIANCE.leadNotification).not.toContain(champ)
  }
})

test("postPublished déclare url en confiance, pas titre ni auteur", () => {
  const post = CATALOGUE.find((e) => e.cle === "postPublished")!
  expect(post.titre).toBe("Un collègue a publié un article")
  expect(post.desactivable).toBe(true)
  expect(post.variables).toEqual(["nom_du_site", "url", "titre", "auteur"])
  expect(VARIABLES_DE_CONFIANCE.postPublished).toEqual(["url"])
})
```

Mettre à jour `VARIABLES_DE_CONFIANCE.leadNotification` attendu dans le test existant « les seules variables de confiance… » : `["lien", "url"]`.

Dans `gabarit.test.ts`, le test « le lien légitime est cliquable dans les trois emails » doit aussi passer `url` (même valeur que `lien`) et `nom_du_site` / `titre` / `auteur`, sinon `postPublished` n'a aucune ancre.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- lib/catalogueEmails.test.ts`
Expected: FAIL — `postPublished` absent, confiance lead encore `["lien"]`.

- [ ] **Step 3: Write minimal implementation**

`CleEmail` :

```ts
export type CleEmail =
  | "invitation"
  | "leadNotification"
  | "passwordReset"
  | "postPublished"
```

`leadNotification.destinataire` :

> Chaque compte qui a activé l'e-mail pour ce type, un e-mail par personne.

`leadNotification.variables` : `["nom", "email", "sujet", "message", "lien", "nom_du_site", "url"]`.

Objet et corps par défaut **inchangés**.

Ajouter l'entrée `postPublished` (spec §8.2) :

```ts
{
  cle: "postPublished",
  titre: "Un collègue a publié un article",
  quand: "Quand un owner ou un admin publie un article qui n'était pas en ligne.",
  destinataire:
    "Chaque compte qui a activé l'e-mail pour ce type, sauf l'auteur et la personne qui publie.",
  desactivable: true,
  variables: ["nom_du_site", "url", "titre", "auteur"],
  variablesObligatoires: [],
  objetParDefaut: "{{auteur}} a publié « {{titre}} »",
  corpsParDefaut: "{{auteur}} a publié « {{titre}} » sur {{nom_du_site}}.\n\nOuvrir dans l'administration : {{url}}",
}
```

```ts
export const VARIABLES_DE_CONFIANCE: Record<CleEmail, readonly string[]> = {
  invitation: ["lien"],
  leadNotification: ["lien", "url"],
  passwordReset: ["lien"],
  postPublished: ["url"],
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- lib/catalogueEmails.test.ts lib/gabarit.test.ts emails.test.ts`
Expected: PASS

---

## Chunk 2: Schéma + registre

### Task 2: Tables expand + classement RGPD

**Files:**
- Modify: `packages/backend/convex/schema.ts` (fin du `defineSchema`)
- Modify: `packages/backend/convex/schema.test.ts`
- Modify: `packages/backend/convex/_dataRegistry.ts`
- Modify: `apps/web/src/config/legal.ts` (ligne « Gérer les comptes de l'administration »)
- Test: `packages/backend/convex/_dataRegistry.test.ts` (échoue tout seul si table non classée)
- Test: `apps/web/src/config/legal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// schema.test.ts
test("notificationPrefs et notifications existent avec leurs index", () => {
  expect(schema.tables.notificationPrefs).toBeDefined()
  expect(schema.tables.notifications).toBeDefined()
  const prefs = schema.tables.notificationPrefs.indexes.map((i) => i.indexDescriptor)
  const cloches = schema.tables.notifications.indexes.map((i) => i.indexDescriptor)
  expect(prefs).toEqual(expect.arrayContaining(["by_user_cle", "by_user"]))
  expect(cloches).toEqual(expect.arrayContaining(["by_user", "by_lead", "by_post"]))
})
```

```ts
// legal.test.ts
test("la ligne comptes annonce les préférences et la cloche à 90 jours", () => {
  const comptes = processings.find((p) => p.purpose === "Gérer les comptes de l'administration")
  expect(comptes!.data).toMatch(/préférence/i)
  expect(comptes!.data).toMatch(/cloche/i)
  const { NOTIFICATION_RETENTION_DAYS } = constantesDeRetention()
  expect(NOTIFICATION_RETENTION_DAYS).toBe(90)
  expect(comptes!.retention).toContain("90 jours")
})
```

(`constantesDeRetention` lit déjà `export const *_RETENTION_DAYS` dans `retention.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- schema.test.ts`
Expected: FAIL — tables absentes.

- [ ] **Step 3: Write minimal implementation**

Fin de `schema.ts` :

```ts
notificationPrefs: defineTable({
  authUserId: v.string(),
  cle: v.union(v.literal("leadNotification"), v.literal("postPublished")),
  cloche: v.boolean(),
  email: v.boolean(),
  majAt: v.number(),
})
  .index("by_user_cle", ["authUserId", "cle"])
  .index("by_user", ["authUserId"]),

notifications: defineTable({
  authUserId: v.string(),
  cle: v.union(v.literal("leadNotification"), v.literal("postPublished")),
  titre: v.string(),
  leadId: v.optional(v.id("leads")),
  postId: v.optional(v.id("posts")),
  readAt: v.optional(v.number()),
})
  .index("by_user", ["authUserId"])
  .index("by_lead", ["leadId"])
  .index("by_post", ["postId"]),
```

`_dataRegistry.ts` :

```ts
notificationPrefs: { declaredAs: "Gérer les comptes de l'administration" },
notifications: { declaredAs: "Gérer les comptes de l'administration" },
```

`legal.ts` — allonger `data` (préférences de notification, lignes de cloche : destinataire, type, libellé, identifiant de cible) et `retention` (90 jours pour la cloche ; suppression du compte pour les deux).

`NOTIFICATION_RETENTION_DAYS = 90` dans `retention.ts` (utilisé aussi au Chunk 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- schema.test.ts _dataRegistry.test.ts`
Expected: PASS. Puis `pnpm --filter @astrotan/web test -- legal.test.ts` après la constante de rétention.

---

## Chunk 3: Résolveur + API notifications

### Task 3: `lib/notifier.ts` — défauts purs

**Files:**
- Create: `packages/backend/convex/lib/notifier.ts`
- Test: `packages/backend/convex/lib/notifier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { canalParDefaut, canalOuvert } from "./notifier"

describe("canalParDefaut", () => {
  test("lead : cloche pour les trois rôles, e-mail owner/admin seulement", () => {
    expect(canalParDefaut("leadNotification", "cloche", "editor")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "owner")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "admin")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "editor")).toBe(false)
  })
  test("article : cloche pour les trois, e-mail jamais", () => {
    expect(canalParDefaut("postPublished", "cloche", "owner")).toBe(true)
    expect(canalParDefaut("postPublished", "email", "owner")).toBe(false)
    expect(canalParDefaut("postPublished", "email", "editor")).toBe(false)
  })
})

describe("canalOuvert", () => {
  test("sans ligne, le défaut gagne", () => {
    expect(canalOuvert(null, "leadNotification", "email", "editor")).toBe(false)
    expect(canalOuvert(null, "leadNotification", "cloche", "editor")).toBe(true)
  })
  test("une ligne écrite l'emporte", () => {
    expect(
      canalOuvert({ cloche: false, email: true }, "leadNotification", "email", "editor"),
    ).toBe(true)
    expect(
      canalOuvert({ cloche: false, email: true }, "leadNotification", "cloche", "owner"),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- lib/notifier.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Write minimal implementation**

```ts
export type CleNotification = "leadNotification" | "postPublished"
export type Canal = "cloche" | "email"
export type RoleNotif = "owner" | "admin" | "editor"

export function canalParDefaut(
  cle: CleNotification,
  canal: Canal,
  role: RoleNotif,
): boolean {
  if (canal === "cloche") return true
  if (cle === "leadNotification") return role === "owner" || role === "admin"
  return false
}

export function canalOuvert(
  ligne: { cloche: boolean; email: boolean } | null,
  cle: CleNotification,
  canal: Canal,
  role: RoleNotif,
): boolean {
  if (ligne) return ligne[canal]
  return canalParDefaut(cle, canal, role)
}
```

Le même fichier exportera plus tard `listerCandidats`, `ecrireCloches`, `supprimerPourCompte` / `PourLead` / `PourPost` (ctx Convex). Les garder ici : un seul résolveur.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- lib/notifier.test.ts`
Expected: PASS

### Task 4: `notifications.ts` — prefs, liste, marquer lu

**Files:**
- Create: `packages/backend/convex/notifications.ts`
- Test: `packages/backend/convex/notifications.test.ts`
- Modify: `packages/backend/testing/registryModules.ts` (ajouter `import "../convex/notifications"`)

Préambule d'environnement obligatoire (skill convex-function) :

```ts
let originalEnv: NodeJS.ProcessEnv
beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})
afterEach(() => { process.env = originalEnv })
```

- [ ] **Step 1: Write the failing tests**

```ts
test("sans ligne, mesPrefs rend les défauts du rôle", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const prefs = await editor.identity.query(api.notifications.mesPrefs, {})
  const lead = prefs.find((p) => p.cle === "leadNotification")!
  expect(lead.cloche).toBe(true)
  expect(lead.email).toBe(false)
  const post = prefs.find((p) => p.cle === "postPublished")!
  expect(post.cloche).toBe(true)
  expect(post.email).toBe(false)
})

test("setPrefs n'écrit que la session, jamais un autre authUserId", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.notifications.setPrefs, {
    cle: "leadNotification",
    cloche: true,
    email: false,
  })
  const rows = await t.run((ctx) => ctx.db.query("notificationPrefs").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]!.authUserId).toBe(owner.id)
  expect(rows[0]!.email).toBe(false)
})

test("marquerLu d'autrui est NOT_FOUND ; déjà lu est no-op", async () => {
  const t = makeTestConvex()
  const a = await seedActor(t, "owner")
  const b = await seedActor(t, "admin")
  const id = await t.run((ctx) =>
    ctx.db.insert("notifications", {
      authUserId: a.id,
      cle: "leadNotification",
      titre: "Nouveau message de contact",
    }),
  )
  await expect(
    b.identity.mutation(api.notifications.marquerLu, { id }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  await a.identity.mutation(api.notifications.marquerLu, { id })
  const premiere = await t.run((ctx) => ctx.db.get(id))
  expect(premiere!.readAt).toEqual(expect.any(Number))
  await a.identity.mutation(api.notifications.marquerLu, { id })
  const seconde = await t.run((ctx) => ctx.db.get(id))
  expect(seconde!.readAt).toBe(premiere!.readAt)
})

test("liste rend 30 lignes max et nonLues", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    for (let i = 0; i < 31; i++) {
      await ctx.db.insert("notifications", {
        authUserId: owner.id,
        cle: "leadNotification",
        titre: `n${i}`,
      })
    }
  })
  const { lignes, nonLues } = await owner.identity.query(api.notifications.liste, {})
  expect(lignes).toHaveLength(30)
  expect(nonLues).toBe(31)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- notifications.test.ts`
Expected: FAIL — `api.notifications` absent.

- [ ] **Step 3: Write minimal implementation**

`notifications.ts` (< 200 lignes) :

- `cleValidator` = `v.union(v.literal("leadNotification"), v.literal("postPublished"))`
- `mesPrefs` : `requireRole(["owner","admin","editor"])` ; pour chaque clé, ligne `by_user_cle` ou défaut via `canalParDefaut`
- `setPrefs` : mêmes rôles ; `authUserId = acteur._id` (pas d'argument) ; upsert sur `by_user_cle`
- `liste` : 30 plus récentes (`by_user`, `order("desc")`) + `nonLues` = count où `readAt === undefined` (compter sur le collect borné **et** un count séparé : `nonLues` n'est pas plafonné à 30 — parcourir `by_user` et compter les non lues, lister 30)
- `marquerLu` : ligne existe **et** `authUserId === acteur._id`, sinon `{ code: "NOT_FOUND" }` ; déjà lu : return
- `destinatairesPourEmail` : `internalQuery` `{ cle, exclus: v.array(v.string()) }` → `{ email, authUserId }[]`
- `notifyPublished` : `internalAction` (voir Task 6)
- `MUTATION_REGISTRY.push` : `notifications.setPrefs` et `notifications.marquerLu`, rôles `["owner","admin","editor"]`

Pour `marquerLu` invoke du registre : insérer une ligne pour l'acteur courant puis appeler.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- notifications.test.ts lib/authz.test.ts _registry.test.ts`
Expected: PASS. La matrice authz joue les deux nouvelles mutations.

---

## Chunk 4: Déclenchement lead + article

### Task 5: `leads.submit` écrit les cloches ; `notifyStaff` change de destinataires

**Files:**
- Modify: `packages/backend/convex/leads.ts`
- Modify: `packages/backend/convex/lib/notifier.ts` (`listerCandidats`, `ecrireCloches`)
- Test: `packages/backend/convex/leads.test.ts` (étendre, ne pas casser les tests existants)

Les tests existants « la notification part aux comptes owner et admin » et « sans compte owner ni admin » restent **verts** grâce aux défauts.

- [ ] **Step 1: Write the failing tests**

```ts
test("submit écrit une cloche pour owner, admin et editor ; e-mail seulement owner/admin", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()
  const owner = await seedStaff(t, "owner", "patronne@example.com")
  const admin = await seedStaff(t, "admin", "admin@example.com")
  const editor = await seedStaff(t, "editor", "editrice@example.com")
  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const cloches = await t.run((ctx) => ctx.db.query("notifications").collect())
  expect(cloches.map((c) => c.authUserId).sort()).toEqual(
    [owner.id, admin.id, editor.id].sort(),
  )
  expect(cloches.every((c) => c.titre === "Nouveau message de contact")).toBe(true)
  expect(cloches.every((c) => c.leadId)).toBeTruthy()
  expect(envoyes.map((e) => e.to).sort()).toEqual([
    "admin@example.com",
    "patronne@example.com",
  ])
})

test("un editor qui coche e-mail reçoit le prochain submit", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()
  const editor = await seedActor(t, "editor")
  await seedStaff(t, "owner", "patronne@example.com")
  await editor.identity.mutation(api.notifications.setPrefs, {
    cle: "leadNotification",
    cloche: true,
    email: true,
  })
  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envoyes.map((e) => e.to).sort()).toEqual([
    editor.email, // ou l'email seedé
    "patronne@example.com",
  ].sort())
})

test("gabarit inactif ou Resend éteint : cloches présentes, zéro sendEmail", async () => {
  // deux cas, même assertion
})
```

`notifyStaff` doit interpoler `nom_du_site` (`settings.siteName` ou `"AstroTan"`) et `url` (= `lien`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- leads.test.ts`
Expected: FAIL — aucune ligne `notifications`.

- [ ] **Step 3: Write minimal implementation**

Dans `submit`, **après** l'écriture du message, **avant** les `runAfter` :

```ts
await ecrireCloches(ctx, {
  cle: "leadNotification",
  titre: "Nouveau message de contact",
  leadId,
  exclus: [],
})
```

`ecrireCloches` : `listerCandidats` (owner+admin+editor, dédup, non bannis) → pour chacun si `canalOuvert(..., "cloche")` → `insert`.

`notifyStaff` : remplacer `staffRecipients` par `ctx.runQuery(internal.notifications.destinatairesPourEmail, { cle: "leadNotification", exclus: [] })`. Ajouter `nom_du_site` et `url: link` aux `valeurs`. `staffRecipients` reste exporté, plus aucun nouvel appelant.

`listerCandidats` réutilise `listUsersWithRole` + `isCurrentlyBanned`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- leads.test.ts`
Expected: PASS (y compris les tests historiques owner/admin).

### Task 6: `publishPost` notifie seulement la transition brouillon → publié

**Files:**
- Modify: `packages/backend/convex/posts.ts`
- Modify: `packages/backend/convex/notifications.ts` (`notifyPublished`)
- Test: `packages/backend/convex/posts.test.ts` (ajouter, ne pas casser)

- [ ] **Step 1: Write the failing tests**

```ts
test("publishPost d'un brouillon écrit une cloche pour les autres, zéro e-mail par défaut", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois() // extraire le helper ou le recopier
  const auteur = await seedActor(t, "editor")
  const publieur = await seedActor(t, "owner")
  const collegue = await seedActor(t, "admin")
  const id = await auteur.identity.mutation(api.posts.create, {
    title: "Couverture",
    slug: `couv-${Date.now()}`,
  })
  await publieur.identity.mutation(api.posts.publishPost, { id })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const cloches = await t.run((ctx) => ctx.db.query("notifications").collect())
  expect(cloches.map((c) => c.authUserId)).toEqual([collegue.id])
  expect(cloches[0]!.titre).toBe("Couverture")
  expect(cloches[0]!.postId).toBe(id)
  expect(envoyes).toHaveLength(0)
})

test("republication d'un article déjà published : zéro cloche, zéro job notifyPublished", async () => {
  // publish deux fois ; count notifications reste 1 (ou 0 si seul l'acteur)
})

test("auteur = publieur : zéro cloche pour lui même canaux à vrai ; un tiers avec e-mail reçoit", async () => {
  // setPrefs e-mail true pour auteur et pour un admin
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @astrotan/backend test -- posts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Dans `publishPost`, **avant** l'écriture :

```ts
const etaitPublie = post.status === "published"
```

Après outbox + drain + journal, si `!etaitPublie` :

```ts
const live = await ctx.db.get(args.id)
const titre = live?.title ?? post.title
const exclus = [...new Set([post.createdBy, acteur._id])]
await ecrireCloches(ctx, { cle: "postPublished", titre, postId: args.id, exclus })
await ctx.scheduler.runAfter(0, internal.notifications.notifyPublished, {
  postId: args.id,
  titre,
  auteurId: post.createdBy,
  exclus,
})
```

`notifyPublished` (internalAction) : même silence que `notifyStaff` (gabarit inactif / clé absente → `return null` ; pas d'origine → **lève**). Variables : `nom_du_site`, `url` = `${admin}/posts/${postId}`, `titre`, `auteur` via `resolvePostAuthors` (internalQuery mince `auteurPour` ou passer le libellé depuis la mutation — préférer le résoudre dans l'action via query interne pour ne pas figer un nom faux). Pas de `replyTo`. `singleLine` sur l'objet rendu.

Importer `internalAction` dans `notifications.ts` (pas dans `posts.ts` si l'action vit là). `posts.ts` n'importe que `ecrireCloches` + `internal.notifications.notifyPublished`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @astrotan/backend test -- posts.test.ts emails.test.ts`
Expected: PASS. Ajouter dans `emails.test.ts` : `setTemplate` `postPublished` avec `{{inconnu}}` lève ; `{{url}}` dans le HTML est une ancre, `{{titre}}` non (via `rendreHtml` / `gabarit.test.ts`).

---

## Chunk 5: Cascades + rétention

### Task 7: Partir avec le compte, la fiche, l'article, et à 90 jours

**Files:**
- Modify: `packages/backend/convex/lib/leadCascade.ts`
- Modify: `packages/backend/convex/leads.ts` (`remove` → appeler `deleteLeadCascade`)
- Modify: `packages/backend/convex/posts.ts` (`remove`)
- Modify: `packages/backend/convex/users.ts` (`remove`)
- Modify: `packages/backend/convex/retention.ts`
- Test: `packages/backend/convex/retention.test.ts`, `users.test.ts`, `leads.test.ts` / `posts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("leads.remove et retention.purge effacent les cloches by_lead", async () => { /* … */ })
test("posts.remove efface les cloches by_post", async () => { /* … */ })
test("users.remove efface prefs et cloches de ce compte", async () => { /* … */ })
test("retention.purge efface une cloche de plus de 90 jours", async () => { /* … */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @astrotan/backend test -- retention.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`supprimerPourLead` / `PourPost` / `PourCompte` dans `lib/notifier.ts` (index `by_lead` / `by_post` / `by_user`).

`deleteLeadCascade` appelle `supprimerPourLead` avant de supprimer la fiche.

`leads.remove` remplace sa copie par `deleteLeadCascade` (spec §5.1) puis journalise.

`posts.remove` : `supprimerPourPost` **avant** `ctx.db.delete`.

`users.remove` : `supprimerPourCompte` **avant** `auth.api.removeUser`.

`retention.purge` : lot sur `_creationTime` < `now - NOTIFICATION_RETENTION_MS`, `take(RETENTION_BATCH_SIZE)`, `hasMore` or-é. Étendre `PurgeReport.notifications`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @astrotan/backend test -- retention.test.ts users.test.ts leads.test.ts posts.test.ts`
Expected: PASS

---

## Chunk 6: UI admin

### Task 8: Bloc « Mes notifications »

**Files:**
- Create: `apps/admin/src/components/mes-notifications.tsx`
- Test: `apps/admin/src/components/mes-notifications.test.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/emails.tsx`

`renderToStaticMarkup` (pas de DOM). Un editor voit le bloc, pas l'accordéon (déjà : `canWrite` masque `ListeEmails`).

- [ ] **Step 1: Write the failing test**

```ts
test("deux lignes, quatre interrupteurs Cloche et E-mail", () => {
  const html = renderToStaticMarkup(
    <MesNotifications
      prefs={[
        { cle: "leadNotification", titre: "Nouveau message de contact", cloche: true, email: false },
        { cle: "postPublished", titre: "Un collègue a publié un article", cloche: true, email: false },
      ]}
      onChange={() => {}}
    />,
  )
  expect(html).toContain("Nouveau message de contact")
  expect(html).toContain("Un collègue a publié un article")
  expect(html.match(/Cloche/g)?.length).toBe(2)
  expect(html.match(/E-mail/g)?.length).toBe(2)
})
```

- [ ] **Step 2: Fail, implement, pass**

Run: `pnpm --filter @astrotan/admin test -- mes-notifications.test.tsx`

Connecteur mince dans `emails.tsx` : `useQuery(api.notifications.mesPrefs)` + `useMutation(api.notifications.setPrefs)`, enregistrement immédiat, pas la barre. Placer le `SettingsGroup title="Mes notifications"` **sous** « Ce que ce site envoie », visible pour **tous** les rôles (pas derrière `canWrite`).

`settings-nav.test.tsx` : déjà « Email & notifications » — ne pas inventer un second libellé.

### Task 9: Cloche header

**Files:**
- Create: `apps/admin/src/components/notifications-cloche.tsx`
- Test: `apps/admin/src/components/notifications-cloche.test.tsx`
- Modify: `apps/admin/src/components/app-shell.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("pastille absente si nonLues === 0 ; 9+ au-delà de 9", () => {
  const vide = renderToStaticMarkup(
    <ClochePanneau lignes={[]} nonLues={0} onChoisir={() => {}} />,
  )
  expect(vide).toContain("Aucune notification")
  expect(vide).not.toMatch(/>0</)

  const plein = renderToStaticMarkup(
    <ClochePanneau
      lignes={[{ _id: "n1", cle: "leadNotification", titre: "Nouveau message de contact", _creationTime: Date.now() }]}
      nonLues={12}
      onChoisir={() => {}}
    />,
  )
  expect(plein).toContain("9+")
  expect(plein).toContain("Nouveau message de contact")
})

test("hrefDeNotification : lead → /leads, article → /posts/$id", () => {
  expect(hrefDeNotification({ cle: "leadNotification" })).toBe("/leads")
  expect(hrefDeNotification({ cle: "postPublished", postId: "p1" })).toBe("/posts/p1")
})
```

- [ ] **Step 2: Fail, implement, pass**

Bouton `Bell` lucide, `aria-label="Notifications"`, pastille si `nonLues > 0`. DropdownMenu shadcn. Clic : le connecteur appelle `marquerLu` puis `useNavigate` (`/leads` ou `/posts/$postId`). Pas de `<a href>` brut. Pas de « Tout marquer lu ».

`AppShell` : dans le `<header>`, après « Administration », `<div className="ml-auto"><NotificationsClocheConnectee /></div>`.

Run: `pnpm --filter @astrotan/admin test -- notifications-cloche.test.tsx settings-nav.test.tsx`

---

## Chunk 7: Vérification d'ensemble

### Task 10: Suites + gabarit postPublished

- [ ] **Step 1: Gabarit**

`emails.test.ts` : `setTemplate({ cle: "postPublished", objet: "{{inconnu}}", corps: "x" })` lève. `gabarit.test.ts` : `rendreHtml("{{url}} {{titre}}", { url: "https://a.fr/p", titre: "https://evil" }, "postPublished")` → une ancre `url`, `titre` hors `<a>`.

- [ ] **Step 2: Suites**

```bash
pnpm --filter @astrotan/backend test
pnpm --filter @astrotan/admin test
```

Expected: PASS. Si `api.notifications` n'est pas dans `_generated/api.d.ts`, `npx convex codegen` (non interactif) depuis `packages/backend` — jamais `convex dev` interactif.

- [ ] **Step 3: Hors scope à ne pas toucher**

`http.ts`, MCP, digest, webhook leads, `RESEND_TEST_MODE`, `consentVersion`, TanStack Query.

---

## Execution notes

Je (agent de ce lot) exécute ce plan dans la même session : TDD par tâche, pas de commit, pas de question. Antoine au réveil : hard refresh de l'admin + watcher Convex (`npx convex dev` dans un vrai terminal) pour pousser schéma + functions.
