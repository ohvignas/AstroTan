# Agent IA visiteur Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un agent visiteur (bulle + gate e-mail + fil + fiche `leads`) puis inbox staff, Calendar, MCP et RAG, sans jamais ouvrir Convex au navigateur public.

**Architecture:** Porte Astro `/api/chat/*` (secret `LEAD_SUBMIT_SECRET`, jeton HMAC `CHAT_SESSION_SECRET`) → fonctions Convex app qui enveloppent le composant `@convex-dev/agent`. L'admin s'abonne avec `useUIMessages`. OpenRouter via `createOpenRouter`. MCP via `createMCPClient` HTTP/SSE. RAG (`@convex-dev/rag`) en phase 5 seulement.

**Tech Stack:** `@convex-dev/agent@^0.7` (**peers : `ai@^7`**, pas 6), `@openrouter/ai-sdk-provider@^3` (AI SDK 7), `zod` selon le peer de l'agent, Convex 1.45 (`defineApp` / `app.use`), TanStack Start, Astro 7 îlot React, table `leads` existante. `@ai-sdk/mcp` **phase 4 seulement**. Skills `@.claude/skills/convex-function`, `@.claude/skills/consent-rgpd`, `@.agents/skills/superpowers/writing-plans`. `convex-create-component` n'est pas dans ce repo.

**Spec:** [`docs/superpowers/specs/2026-09-01-agent-ia-visiteur-design.md`](../specs/2026-09-01-agent-ia-visiteur-design.md)

---

## Contraintes

- TDD. Fichiers nouveaux < 200 lignes. Helpers purs sous `convex/lib/`. Fixtures dans `packages/backend/testing/`, jamais un `.ts` à nom simple sous `convex/`.
- `requireRole` dans chaque query/mutation staff. L'UI masque.
- Expand only. Pas de champ retiré. Tables du composant agent : API seulement, pas `ctx.db`.
- Ne pas lancer `npx convex dev` interactif. Après `convex/`, un humain fait `npx convex dev --once`.
- UI FR, code EN. `settings.get` ne gagne que `agentEnabled`.
- Pas CopilotKit / Mastra / VoltAgent. Pas de playground produit. Pas de MCP stdio. Pas de `ConvexReactClient` dans `apps/web`.
- Versions des packages : lire les `peerDependencies` de `@convex-dev/agent@^0.7` à l'install. **AI SDK 7**. Ne pas installer `ai@^6`.
- `saveMessage` **autonome** dans les mutations (`saveMessage(ctx, components.agent, …)`). `new Agent` uniquement dans `chatStream` (action). `streamText` reçoit `promptMessageId`, jamais un second `prompt`.
- Jeton chat : `${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex}`. `verify` → payload ou `null`, jamais throw sur l'entrée.
- Pas de `deleteThread` nu : `deleteThreadAsync` / `deleteThreadsByUserId`.
- `api.leads.get` n'existe pas. Lire via `t.run` / `board`.
- Présence HTTP : phase 2. La table `chatPresence` peut naître en phase 1 (expand).
- Commits Conventional Commits, sujet en français (quand l'humain demande d'exécuter et de committer).

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/convex.config.ts` | `app.use(agent)` ; phase 5 `app.use(rag)` |
| `packages/backend/convex/lib/chatSessionToken.ts` | HMAC session, clone discipliné de `previewToken.ts` |
| `packages/backend/convex/lib/chatRateLimit.ts` | Buckets conversation (20/h origine, 30/h e-mail) |
| `packages/backend/convex/lib/visitorAgent.ts` | `createOpenRouter` + `new Agent(...)` dans l'action |
| `packages/backend/convex/lib/publishedPageText.ts` | Texte d'une page **publiée** via `WEB_SITE_URL` |
| `packages/backend/convex/lib/agentTools.ts` | `createTool` maison (pages, savoir, téléphone) |
| `packages/backend/convex/chat.ts` | `start`, `send`, `listVisitorMessages` (phase 2 : `visitorHeartbeat`) |
| `packages/backend/convex/chatStream.ts` | `stream` internalAction, `getAgentConfig`, `publishedPageIndex` |
| `packages/backend/convex/chatStaff.ts` | Phase 2 : takeover, `staffReply`, `listStaffMessages`, présence staff |
| `packages/backend/convex/schema.ts` | expand `leads`, `settings`, `leadEvents` ; tables `chatSessions`, `chatPresence` |
| `packages/backend/convex/leads.ts` | `LeadTimelineEntry` + boucle `timeline` pour `chat_started` / `handover` |
| `packages/backend/convex/settings.ts` | `agentEnabled` public ; savoir en `getPrivate` ; `updateAgent` |
| `packages/backend/convex/lib/leadCascade.ts` | sessions + présence + `deleteThreadsByUserId` / `deleteThreadAsync` |
| `packages/backend/convex/_dataRegistry.ts` | classer les tables neuves |
| `packages/backend/convex/content.ts` | bornes `MAX_AGENT_*` |
| `packages/backend/.env.example` | `CHAT_SESSION_SECRET` |
| `scripts/bootstrap.mjs` | génère et pose le secret |
| `scripts/check-env-wiring.mjs` | le secret a ses deux moitiés (il dérive des lectures — ajouter la lecture suffit si le script reste structurel) |
| `apps/web/.env.example` | `CHAT_SESSION_SECRET` |
| `apps/web/src/lib/chatSessionToken.ts` | 1re barrière HMAC (comme preview côté Astro) |
| `apps/web/src/pages/api/chat/start.ts` | porte création |
| `apps/web/src/pages/api/chat/message.ts` | porte message |
| `apps/web/src/pages/api/chat/messages.ts` | porte lecture (poll) |
| `apps/web/src/pages/api/chat/presence.ts` | **phase 2** — heartbeat visiteur |
| `apps/web/src/components/chat/ChatBubble.tsx` | îlot gate + fil |
| `apps/web/src/components/chat/ChatBubble.astro` | montage + `agentEnabled` |
| `apps/web/src/config/legal.ts` | ligne de traitement chat + OpenRouter |
| `apps/web/src/config/consent.ts` | **ne pas** bumper `consentVersion` en phase 1 |
| `apps/admin/src/routes/_authed/settings/agent.tsx` | identité, base, interrupteur |
| `apps/admin/src/components/settings-nav.tsx` | entrée `/settings/agent` |
| `apps/admin/src/components/lead-chat-panel.tsx` | `useUIMessages` + handover |
| `apps/admin/src/routes/_authed/leads.tsx` | ouvre le panneau si `threadId` |
| Phase 3 : `connectors.ts`, callback admin `/api/connectors/google/callback` | OAuth + outils Calendar |
| Phase 4 : `mcpServers.ts`, `lib/loadMcpTools.ts` | CRUD + `createMCPClient` |
| Phase 5 : `lib/siteRag.ts` | `RAG`, add/search/reindex |

Chemins lus, ne pas les inventer :

- `convex.config.ts` : `packages/backend/convex/convex.config.ts` (betterAuth, resend, rateLimiter déjà là)
- `leads` schéma : `packages/backend/convex/schema.ts` vers 161
- `leads.submit` : `packages/backend/convex/leads.ts`
- `previewToken` : `packages/backend/convex/lib/previewToken.ts`
- `settings.get` projection : `packages/backend/convex/settings.ts` vers 91
- `AUTORISES` : `packages/backend/convex/settings.publicProjection.test.ts`
- `SECRET_NOMS` : `packages/backend/convex/secrets.ts` vers 60
- `deleteLeadCascade` : `packages/backend/convex/lib/leadCascade.ts`
- `TABLE_COVERAGE` : `packages/backend/convex/_dataRegistry.ts`
- `processings` : `apps/web/src/config/legal.ts` vers 210
- `consentVersion` : `apps/web/src/config/consent.ts` (`"1.0.0"`)
- Porte contact : `apps/web/src/pages/api/contact.ts`
- `SETTINGS_PAGES` : `apps/admin/src/components/settings-nav.tsx` vers 104
- Barrel : `packages/backend/testing/registryModules.ts`
- `makeTestConvex` : `packages/backend/testing/betterAuthFixture.ts` — y
  enregistrer `@convex-dev/agent/test` au chunk 0
- Famille publique : `packages/backend/convex/pages.publicQueryFamily.test.ts`

---

## Chunk 0: Packages et composant

### Task 0: Installer et monter `@convex-dev/agent`

**Files:**
- Modify: `packages/backend/package.json`, `packages/backend/convex/convex.config.ts`
- Modify: `apps/admin/package.json` (hooks React)
- Test: aucun fichier `convex.config.test.ts` à inventer — le typecheck après codegen humain (`components.agent` dans `api.d.ts`) est la preuve

- [ ] **Step 1: Installer en lisant les peers**

```bash
pnpm --filter @astrotan/backend add @convex-dev/agent@^0.7
# puis LIRE node_modules/@convex-dev/agent/package.json → peerDependencies
# MIGRATION.md du package (1er sept. 2026) : ai@^7, @ai-sdk/provider@^4
pnpm --filter @astrotan/backend add ai@^7 @openrouter/ai-sdk-provider@^3 zod
pnpm --filter @astrotan/admin add @convex-dev/agent@^0.7
```

Aligner `ai` / `zod` sur la plage **exacte** des peers (AI SDK **7**). Si l'agent documente `zod/v3` pour `createTool`, l'importer ainsi. Ne pas ajouter `@ai-sdk/mcp` ni `@convex-dev/rag` ici.

- [ ] **Step 2: Monter le composant**

```ts
// packages/backend/convex/convex.config.ts
import { defineApp } from "convex/server"
import betterAuth from "./betterAuth/convex.config"
import resend from "@convex-dev/resend/convex.config.js"
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"
import agent from "@convex-dev/agent/convex.config"

const app = defineApp()
app.use(betterAuth)
app.use(resend)
app.use(rateLimiter)
app.use(agent)

export default app
```

Source : docs.convex.dev/agents/getting-started et Context7 `/get-convex/agent` « Configure Convex Agent Component ».

- [ ] **Step 2b: Enregistrer le composant dans `makeTestConvex`**

Sans ça, `createThread` dans `chat.start` explose en vitest — le même trou
que Resend et le rate limiter ont déjà payé. Motif **exact** de
`packages/backend/testing/betterAuthFixture.ts` :

```ts
import agentTest from "@convex-dev/agent/test"
// …
agentTest.register(t)
```

Si le package n'exporte pas `/test` (lire `package.json` `exports` après
install), utiliser le helper documenté à la place (`register(t, "agent")`
ou équivalent). Le nom d'enregistrement = celui de `app.use(agent)` →
`components.agent`. **Ne pas** inventer un second `convexTest` dans
`chat.test.ts`.

- [ ] **Step 3: Codegen humain**

Demander à Antoine : depuis `packages/backend`, `npx convex dev --once`. Vérifier que `components.agent` apparaît dans `convex/_generated/api.d.ts`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
```

Expected: PASS (aucune API agent appelée tant que le chunk 1 n'existe pas, mais `app.use` doit compiler).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/convex/convex.config.ts \
  packages/backend/convex/_generated packages/backend/testing/betterAuthFixture.ts \
  apps/admin/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: monter le composant @convex-dev/agent

EOF
)"
```

---

## Chunk 1 — Phase 1: porte, jeton, lead, bulle

### Task 1: HMAC de session chat

**Files:**
- Create: `packages/backend/convex/lib/chatSessionToken.ts`
- Test: `packages/backend/convex/lib/chatSessionToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, expect, test } from "vitest"
import { signChatSessionToken, verifyChatSessionToken } from "./chatSessionToken"

const SECRET = "a".repeat(32)

beforeEach(() => {
  process.env.CHAT_SESSION_SECRET = SECRET
})
afterEach(() => {
  delete process.env.CHAT_SESSION_SECRET
})

test("signe et vérifie un triplet lead/thread/exp embarqué dans le jeton", async () => {
  const expiresAt = Date.now() + 60_000
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt,
  })
  // ${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex} — 4 segments
  expect(token.split(".").length).toBe(4)
  const parsed = await verifyChatSessionToken(token)
  expect(parsed).toEqual({ leadId: "lead_1", threadId: "thread_1", expiresAt })
})

test("un jeton expiré rend null, il ne throw pas", async () => {
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt: Date.now() - 1,
  })
  expect(await verifyChatSessionToken(token)).toBeNull()
})

test("un segment tampered rend null", async () => {
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt: Date.now() + 60_000,
  })
  const parts = token.split(".")
  parts[1] = parts[1]!.replace(/A/g, "B") || "x"
  expect(await verifyChatSessionToken(parts.join("."))).toBeNull()
})

test("refuse un secret trop court à la signature", async () => {
  process.env.CHAT_SESSION_SECRET = "short"
  await expect(
    signChatSessionToken({ leadId: "l", threadId: "t", expiresAt: Date.now() + 1000 }),
  ).rejects.toThrow()
})
```

`verify` clone `previewToken` : entrée attaquant → `null`, pas d'exception.
`${expiresAt}.${hex}` **sans** ids est interdit : Astro ne pourrait pas
revérifier le HMAC avant l'appel réseau.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend test convex/lib/chatSessionToken.test.ts
```

Expected: FAIL — module absent.

- [ ] **Step 3: Write minimal implementation**

Calquer `lib/previewToken.ts` : HMAC-SHA256, message
`chatSession:${leadId}:${threadId}:${expiresAt}`, rendu
`${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex}` (base64url
sans padding), comparaison temps constant (`timingSafeEqualHex`),
plancher 32 caractères, lecture de `process.env.CHAT_SESSION_SECRET`
**dans** les fonctions, TTL exporté
`CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000`. `verify` parse les 4
segments, recalcule le HMAC, rend le payload ou `null`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @astrotan/backend test convex/lib/chatSessionToken.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/chatSessionToken.ts \
  packages/backend/convex/lib/chatSessionToken.test.ts
git commit -m "$(cat <<'EOF'
feat: signer les sessions de chat par HMAC

EOF
)"
```

### Task 2: Câbler `CHAT_SESSION_SECRET`

**Files:**
- Modify: `packages/backend/.env.example`, `apps/web/.env.example`, `docker/.env.example`
- Modify: `scripts/bootstrap.mjs` — `GENERATED` **et** `LOCAL_TARGETS` web (injecter comme `PREVIEW_SECRET`, pas comme `LEAD_SUBMIT_SECRET` qui aujourd'hui n'est pas injecté dans `.env.local`) **et** le template `.env.vps`
- Modify: `docker/docker-compose.yml` service `web` — `CHAT_SESSION_SECRET: ${CHAT_SESSION_SECRET:?…}` **dans le même commit** que la première lecture `process.env.CHAT_SESSION_SECRET` sous `apps/web` (Task 8). Task 2 documente ; Task 8 pose la lecture + la ligne compose si elle n'y est pas encore.

- [ ] **Step 1: Write the failing test**

Dans le test existant de bootstrap ou un test de `check-env-wiring` s'il en existe un : après ajout de la lecture côté web, `node scripts/check-env-wiring.mjs` doit rester vert. D'abord documenter la variable dans les deux `.env.example` (contrôle Convex du script : toute lecture sous `convex/` doit être documentée).

Ajouter dans `packages/backend/.env.example` un bloc du même format que `PREVIEW_SECRET` :

```
# What: HMAC key for visitor chat session tokens (lib/chatSessionToken.ts).
# Where: generate with openssl rand -hex 32. SAME value on the web container.
# Secret: YES.
CHAT_SESSION_SECRET=CHANGE-ME-not-a-real-secret
```

- [ ] **Step 2: brancher bootstrap**

Dans `scripts/bootstrap.mjs` :

1. `GENERATED` : `{ key: "CHAT_SESSION_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 }`
2. Poster `convex env set` (même boucle que `PREVIEW_SECRET`)
3. `LOCAL_TARGETS` de `apps/web` : ajouter `CHAT_SESSION_SECRET: g("CHAT_SESSION_SECRET")` à côté de `PREVIEW_SECRET` / `REVALIDATE_SECRET`
4. Template `.env.vps` : une ligne `CHAT_SESSION_SECRET=${g("CHAT_SESSION_SECRET")}` à côté de `LEAD_SUBMIT_SECRET`

- [ ] **Step 3: Run wiring check**

```bash
node scripts/check-env-wiring.mjs
```

Expected: PASS une fois lecture + documentation + runtime alignés.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: câbler CHAT_SESSION_SECRET dans bootstrap

EOF
)"
```

### Task 3: Schéma expand — leads, settings, sessions

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/content.ts`
- Modify: `packages/backend/convex/_dataRegistry.ts`
- Modify: `packages/backend/convex/leads.ts` (`LeadTimelineEntry`, `RANG`, boucle `timeline`)
- Test: `packages/backend/convex/_dataRegistry.test.ts` (existant — doit rester vert)
- Test: `packages/backend/convex/leads.test.ts` — une entrée `handover` ne se rend pas comme `created`

- [ ] **Step 1: Write the failing test**

`_dataRegistry.test.ts` échoue dès qu'une table n'est pas classée. Ajouter les tables d'abord **sans** les classer, lancer :

```bash
pnpm --filter @astrotan/backend test convex/_dataRegistry.test.ts
```

Expected: FAIL — `chatSessions` / `chatPresence` non classées.

- [ ] **Step 2: Schéma**

`leads` : ajouter optionnels `threadId: v.optional(v.string())`, `controller: v.optional(v.union(v.literal("ai"), v.literal("staff")))`, `visitorLastSeenAt: v.optional(v.number())`, `source: v.optional(v.union(v.literal("contact"), v.literal("chat")))`.

`leadEvents.type` : ajouter `v.literal("chat_started")`, `v.literal("handover")`.

**Dans le même commit**, `leads.ts` : étendre `LeadTimelineEntry` :

```ts
| { kind: "chat_started"; at: number }
| { kind: "handover"; at: number; from: "ai" | "staff"; to: "ai" | "staff"; actorName: string | null }
```

Mettre à jour `RANG` et la boucle `timeline` : le `else` actuel mappe tout
le reste sur `created` — un `handover` s'afficherait « fiche créée ».
Ajouter un test dans `leads.test.ts` qui insère un événement `handover`
et lit `kind === "handover"`.

`settings` : `agentEnabled: v.optional(v.boolean())`, `agentDisplayName: v.optional(v.string())`, `agentInstructions: v.optional(v.string())`, `agentKnowledge: v.optional(v.string())`.

Tables :

```ts
chatSessions: defineTable({
  leadId: v.id("leads"),
  threadId: v.string(),
  tokenHash: v.string(),
  expiresAt: v.number(),
})
  .index("by_lead", ["leadId"])
  .index("by_thread", ["threadId"])
  .index("by_tokenHash", ["tokenHash"]),

chatPresence: defineTable({
  threadId: v.string(),
  actorId: v.string(),
  lastSeenAt: v.number(),
})
  .index("by_thread", ["threadId"]),
```

- [ ] **Step 3: Classer**

```ts
chatSessions: { declaredAs: "Répondre, dans le chat du site, aux questions d'un visiteur et qualifier sa demande" },
chatPresence: { declaredAs: "Répondre, dans le chat du site, aux questions d'un visiteur et qualifier sa demande" },
```

Le `purpose` doit être **octet-identique** à la ligne `legal.ts` (task 10).

Bornes dans `content.ts` :

```ts
export const MAX_AGENT_DISPLAY_NAME = 80
export const MAX_AGENT_INSTRUCTIONS = 4_000
export const MAX_AGENT_KNOWLEDGE = 20_000
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/backend test convex/_dataRegistry.test.ts
```

Expected: PASS après classification. `legal.test.ts` échouera jusqu'à la task 10 — acceptable si on fait 10 dans le même chunk ; sinon classer d'abord avec le purpose déjà écrit dans legal (faire task 10 juste après).

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: expand schéma chat (leads, sessions, présence)

EOF
)"
```

### Task 4: `settings` — interrupteur public, savoir privé

**Files:**
- Modify: `packages/backend/convex/settings.ts`
- Modify: `packages/backend/convex/settings.publicProjection.test.ts`
- Modify: `packages/backend/convex/settings.test.ts`
- Test: les deux ci-dessus

- [ ] **Step 1: Write the failing test**

Dans `settings.publicProjection.test.ts`, ajouter `"agentEnabled"` à `AUTORISES` **et** `AUTORISES_PRIVE`. Y ajouter aussi `agentDisplayName`, `agentInstructions`, `agentKnowledge` **seulement** dans `AUTORISES_PRIVE`.

Nouveau test dans `settings.test.ts` :

```ts
test("settings.get rend agentEnabled et jamais agentKnowledge", async () => {
  // owner pose les quatre champs via updateAgent
  const pub = await t.query(api.settings.get, {})
  expect(pub).toMatchObject({ agentEnabled: true })
  expect(pub).not.toHaveProperty("agentKnowledge")
  expect(pub).not.toHaveProperty("agentInstructions")
})

test("agentKnowledge trop long lève FIELD_TOO_LONG", async () => {
  await expect(
    admin.mutation(api.settings.updateAgent, {
      agentEnabled: true,
      agentDisplayName: "Aide",
      agentInstructions: "Sois bref.",
      agentKnowledge: "x".repeat(MAX_AGENT_KNOWLEDGE + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "agentKnowledge" } })
})

test("un editor ne pose pas l'agent", async () => {
  await expect(editor.mutation(api.settings.updateAgent, { agentEnabled: true })).rejects.toThrow()
})
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/backend test convex/settings.publicProjection.test.ts convex/settings.test.ts
```

Expected: FAIL — champ / mutation absents.

- [ ] **Step 3: Implement**

Étendre `settings.get` : `agentEnabled: settings.agentEnabled === true`.
Étendre `getPrivate` des trois champs texte + booléen.
`updateAgent` : `requireRole(["owner","admin"])`, bornes, `FIELD_TOO_LONG`.
Enregistrer dans `MUTATION_REGISTRY` (`allowedRoles: ["owner","admin"]`).

- [ ] **Step 4: Pass + commit**

```bash
pnpm --filter @astrotan/backend test convex/settings.test.ts convex/settings.publicProjection.test.ts
```

```bash
git commit -m "$(cat <<'EOF'
feat: réglages agent (interrupteur public, savoir privé)

EOF
)"
```

### Task 5: `chat.start` — e-mail, fiche, thread

**Files:**
- Create: `packages/backend/convex/chat.ts`
- Create: `packages/backend/convex/chat.test.ts`
- Modify: `packages/backend/testing/registryModules.ts`
- Modify: `packages/backend/convex/_registry.ts` (via le `MUTATION_REGISTRY.push` dans `chat.ts`)

Préambule env obligatoire (`convex-function`) : `BETTER_AUTH_SECRET`, `SITE_URL`, `PREVIEW_SECRET`, `LEAD_SUBMIT_SECRET`, `CHAT_SESSION_SECRET`.

- [ ] **Step 1: Write the failing test**

```ts
test("sans secret, chat.start refuse", async () => {
  await expect(
    t.mutation(api.chat.start, { secret: "", email: "a@example.com", name: "Ada", origin: "aa" }),
  ).rejects.toThrow()
})

test("e-mail nouveau crée une fiche new source chat et un threadId", async () => {
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "ada@example.com",
    name: "Ada",
    origin: "ff".repeat(32),
  })
  expect(token.split(".").length).toBe(4)
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead?.status).toBe("new")
  expect(lead?.source).toBe("chat")
  expect(lead?.threadId).toEqual(expect.any(String))
})

test("e-mail déjà won ne repasse pas à new", async () => {
  // créer via leads.submit, move won, puis chat.start
  // api.leads.get N'EXISTE PAS — relire via t.run
  const again = await t.mutation(api.chat.start, { secret: SECRET, email: EXISTING, name: "Ada", origin: "bb".repeat(32) })
  const lead = await t.run((ctx) => ctx.db.get(again.leadId))
  expect(lead?.status).toBe("won")
  expect(lead?._id).toBe(firstId)
})

test("e-mail invalide lève INVALID_EMAIL", async () => {
  await expect(
    t.mutation(api.chat.start, { secret: SECRET, email: "pas-une-adresse", name: "Ada", origin: "cc".repeat(32) }),
  ).rejects.toMatchObject({ data: { code: "INVALID_EMAIL" } })
})
```

`createThread` (doc) :

```ts
import { createThread } from "@convex-dev/agent"
import { components } from "./_generated/api"

const threadId = await createThread(ctx, components.agent, {
  userId: String(leadId),
  title: email,
})
```

`userId` est une **string** à la frontière composant.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/backend test convex/chat.test.ts
```

Expected: FAIL — `api.chat` absent.

- [ ] **Step 3: Implement `chat.start`**

Mutation publique, args : `secret`, `origin?`, `email`, `name?`.
`assertSharedSecret` contre `LEAD_SUBMIT_SECRET` (même helper que `leads.submit`).
Rate limit : **réutiliser** `LEAD_ORIGIN_LIMIT_*` / `LEAD_EMAIL_LIMIT_*` (création de fiche).
Get-or-create `by_email`. **Ne pas copier `leads.submit`** : un e-mail déjà
là ne repasse pas en `new`, n'écrit pas de `leadMessages`, ne remet pas
`seenAt` à `undefined`.
Création : `status: "new"`, `source: "chat"`, `name` = trim ou local-part
(pas d'`EMPTY` si le nom manque), `messageCount: 0`, `lastMessageAt: now`.
Si **créée** : `ecrireCloches` (`cle: "leadNotification"`, titre
« Nouveau chat sur le site »), `internal.leads.notifyStaff` et
`internal.leads.deliverWebhook` avec `body: "Session de chat ouverte."`
— **ne pas** recopier ces fonctions, les appeler. Pas de ligne
`leadMessages`.
`createThread` si `!lead.threadId`. Insert `chatSessions` avec `tokenHash`
(SHA-256 du jeton). Retour `{ token, leadId, threadId, expiresAt }`.

`MUTATION_REGISTRY` : `chat.start` n'a pas de rôle (porte secrète) — même motif que `leads.submit`. Regarder comment `leads.submit` est déclaré dans le registre et **copier ce motif**, ne pas inventer un `allowedRoles: []` silencieux.

- [ ] **Step 4: Pass + barrel**

```ts
// packages/backend/testing/registryModules.ts
import "../convex/chat"
```

```bash
pnpm --filter @astrotan/backend test convex/chat.test.ts convex/_registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: ouvrir une session chat et rattacher le lead

EOF
)"
```

### Task 6: `chat.send` + `chatStream.stream` (sans outils MCP)

**Files:**
- Modify: `packages/backend/convex/chat.ts` (`send` seulement)
- Create: `packages/backend/convex/chatStream.ts` (`stream`, `getAgentConfig`, `publishedPageIndex`)
- Create: `packages/backend/convex/lib/chatRateLimit.ts`
- Create: `packages/backend/convex/lib/visitorAgent.ts`
- Create: `packages/backend/convex/lib/agentTools.ts`
- Create: `packages/backend/convex/lib/publishedPageText.ts` (+ test unitaire d'extraction, fetch mocké)
- Test: `packages/backend/convex/chat.test.ts`
- Modify: `packages/backend/testing/registryModules.ts` — importer `../convex/chatStream` si une mutation publique y naît (sinon l'internalAction suffit)

- [ ] **Step 1: Write the failing test**

```ts
test("send sans jeton refuse INVALID_SESSION", async () => {
  await expect(
    t.mutation(api.chat.send, { secret: SECRET, token: "x", body: "bonjour" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})

test("send avec controller staff ne planifie pas stream", async () => {
  const { token, leadId } = await t.mutation(api.chat.start, { /* … */ })
  await t.run((ctx) => ctx.db.patch(leadId, { controller: "staff" }))
  const scheduledBefore = /* compter scheduled si l'API de test le permet */
  await t.mutation(api.chat.send, { secret: SECRET, token, body: "besoin d'un humain" })
  // assert : pas de runAfter vers internal.chatStream.stream
})

test("stream sans clé OpenRouter lève AGENT_UNCONFIGURED et n'appelle pas le réseau", async () => {
  // spy fetch ; lireSecret vide
})
```

Pour le cas staff avant task 12 : dans le test, `ctx.db.patch(leadId, { controller: "staff" })` via `t.run`.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/backend test convex/chat.test.ts
```

- [ ] **Step 3: Implement**

`lib/chatRateLimit.ts` : copie structurelle de `leadRateLimit.ts`, noms `chatMessageByOrigin` / `chatMessageByEmail`, 20 et 30 / heure, `capacity` = `rate`.

`lib/visitorAgent.ts` — **construit dans l'action**, pas au load :

```ts
import { Agent, stepCountIs } from "@convex-dev/agent"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { components } from "../_generated/api"
import { lireSecret } from "../secrets"
import { resolveOpenRouterModel } from "./openRouterModels"

export async function makeVisitorAgent(ctx: ActionCtx, tools: ToolSet) {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (!apiKey) throw new ConvexError({ code: "AGENT_UNCONFIGURED" })
  const privee = await ctx.runQuery(internal.chatStream.getAgentConfig, {})
  const openrouter = createOpenRouter({
    apiKey,
    appName: "AstroTan",
    appUrl: process.env.WEB_SITE_URL,
  })
  return new Agent(components.agent, {
    name: privee.agentDisplayName ?? "Assistant",
    languageModel: openrouter.chat(resolveOpenRouterModel(privee.openRouterModel)),
    instructions: buildInstructions(privee),
    tools,
    stopWhen: stepCountIs(8),
  })
}
```

`getAgentConfig` : `internalQuery` dans `chatStream.ts` (pas
`settings.get` — publique — ni `getPrivate` — `requireRole` cassé depuis
une action sans session). Projection : savoir + `openRouterModel` +
`agentEnabled` + `siteName`.

Outils maison (`createTool`, doc `/get-convex/agent`) :

```ts
import { createTool } from "@convex-dev/agent"
import { z } from "zod"

export const listPublishedPages = createTool({
  description: "Liste les pages publiées du site (titre + slug).",
  args: z.object({}),
  handler: async (ctx) => {
    return await ctx.runQuery(internal.chat.publishedPageIndex, {})
  },
})
```

`publishedPageIndex` : `internalQuery` qui relit `pages` avec `status === "published"` (filtre serveur, pas l'appelant).
`readPublishedPage` : `getPublishedPage` puis `fetchPublishedText(WEB_SITE_URL, slug)`. Brouillon → `{ found: false }`, **aucun** `previewPage`.

`chat.send` est une **mutation** : l'`Agent` n'y existe pas (il exige la
clé, construite dans l'action). Utiliser `saveMessage` **autonome** :

```ts
import { saveMessage } from "@convex-dev/agent"

const { messageId } = await saveMessage(ctx, components.agent, {
  threadId,
  prompt: body,
})
```

Puis `lastMessageAt`, et si `(lead.controller ?? "ai") === "ai"` :
`ctx.scheduler.runAfter(0, internal.chatStream.stream, { threadId, promptMessageId: messageId })`.

`chatStream.stream` internalAction — **trancher, plus de TBD** :

```ts
const agent = await makeVisitorAgent(ctx, tools)
await agent.streamText(
  ctx,
  { threadId },
  { promptMessageId },
  { saveStreamDeltas: true },
)
```

**Interdit** de repasser `prompt: body` (second message user).
`saveStreamDeltas: true` suffit ; l'exemple officiel optionnel est
`{ chunking: "line", throttleMs: 1000 }` — pas 200. Ne pas renvoyer le
texte au visiteur par HTTP : les deltas sont en base.

`agentEnabled === false` → `AGENT_DISABLED` avant tout appel modèle.

- [ ] **Step 4: Pass**

```bash
pnpm --filter @astrotan/backend test convex/chat.test.ts convex/lib/publishedPageText.test.ts
pnpm --filter @astrotan/backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: enregistrer un message visiteur et streamer la réponse

EOF
)"
```

### Task 7: Lecture visiteur + enseigner la famille publique

**Files:**
- Modify: `packages/backend/convex/chat.ts` (`listVisitorMessages`)
- Modify: `packages/backend/convex/pages.publicQueryFamily.test.ts` **seulement si** l'arg HMAC ne s'appelle pas `token`

- [ ] **Step 1: Write the failing test**

```ts
test("listVisitorMessages sans jeton refuse", async () => {
  await expect(
    t.query(api.chat.listVisitorMessages, {
      secret: SECRET,
      token: "nope",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})
```

Lancer aussi :

```bash
pnpm --filter @astrotan/backend test convex/pages.publicQueryFamily.test.ts
```

L'arg HMAC s'appelle **`token`** : `pages.publicQueryFamily.test.ts` classe
alors la query dans la famille preview (`argFields.includes("token")`) et
**n'entre pas** dans la boucle publique. Aucune branche à ajouter si le
nom est `token`. Si quelqu'un le renomme `sessionToken`, le test explosera
« shape this test doesn't know how to drive » — lui apprendre la forme à
ce moment-là, pas avant.

Ne pas mettre cette query dans `KNOWN_UNGATED_PUBLIC_QUERIES`.

- [ ] **Step 2: Implement listVisitorMessages**

Query publique. Args : `secret`, `token`, `paginationOpts`, `streamArgs: vStreamArgs`.
`assertSharedSecret` + `verifyChatSessionToken` (null → `INVALID_SESSION`) +
ligne `chatSessions`. Puis **obligatoirement** `syncStreams` — la doc
streaming dit que les deltas n'arrivent pas par `listUIMessages` seul :

```ts
import { paginationOptsValidator } from "convex/server"
import { vStreamArgs, listUIMessages, syncStreams } from "@convex-dev/agent"

const paginated = await listUIMessages(ctx, components.agent, {
  threadId: parsed.threadId,
  paginationOpts: args.paginationOpts,
})
const streams = await syncStreams(ctx, components.agent, {
  threadId: parsed.threadId,
  streamArgs: args.streamArgs,
})
return { ...paginated, streams }
```

Astro : premier poll = la valeur « lister les flux » du type `StreamArgs`
exporté à côté de `vStreamArgs` (souvent `{ kind: "list" }` — **lire le
type installé**, ne pas inventer). L'îlot fusionne `streams` dans le
texte affiché.

- [ ] **Step 4: Pass + commit**

```bash
pnpm --filter @astrotan/backend test convex/chat.test.ts convex/pages.publicQueryFamily.test.ts
```

### Task 8: Portes Astro

**Files:**
- Create: `apps/web/src/lib/chatSessionToken.ts` (1re barrière, même wire format — comme preview côté web)
- Create: `apps/web/src/pages/api/chat/start.ts`
- Create: `apps/web/src/pages/api/chat/message.ts`
- Create: `apps/web/src/pages/api/chat/messages.ts`
- Modify: `docker/docker-compose.yml` — `CHAT_SESSION_SECRET: ${CHAT_SESSION_SECRET:?…}` sur `web` (la lecture `process.env` naît ici)
- Test: `apps/web/src/pages/api/chat/start.test.ts` (gardes honeypot/secret dans un helper testé — `contact.ts` n'a pas de test de route dédié)

**Pas** de `presence.ts` en phase 1.

- [ ] **Step 1: Write the failing test**

Tester le helper de réponse : secret absent → JSON `{ code: "indisponible" }` status 503 ; honeypot rempli → `{ ok: true }` sans appeler Convex (mock client).

- [ ] **Step 2: Implement les routes**

Calquer `api/contact.ts` : `prerender = false`, `LEAD_SUBMIT_SECRET`, honeypot `site_web`, `empreinteOrigine`, `adresseDuVisiteur`, `getConvexClient().mutation(api.chat.start, …)`.
Réponses **JSON** (l'îlot n'est pas un form GET-redirect), pas de 303.
Vérifier le HMAC **avant** `listVisitorMessages` / `send`.

Plafond body : mêmes `MAX_LEAD_*`.

- [ ] **Step 3: Tests web**

```bash
pnpm --filter @astrotan/web test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: portes Astro /api/chat

EOF
)"
```

### Task 9: Bulle + gate

**Files:**
- Create: `apps/web/src/components/chat/ChatBubble.tsx`
- Create: `apps/web/src/components/chat/ChatBubble.astro`
- Create: `apps/web/src/components/chat/chat-bubble.test.tsx` (si l'app web a déjà un runner composants ; sinon test du module d'état pur `chatWidgetState.ts`)
- Modify: layout du site qui porte déjà le bandeau consentement — **sous** le bandeau en z-index

- [ ] **Step 1: État pur testé**

```ts
test("sans token, l'écran est la gate", () => {
  expect(nextScreen({ token: null, agentEnabled: true })).toBe("gate")
})
test("agentEnabled false : widget caché", () => {
  expect(nextScreen({ token: "x", agentEnabled: false })).toBe("hidden")
})
```

- [ ] **Step 2: Îlot**

React island : gate (e-mail, nom, honeypot caché), puis fil. Poll 400 ms
tant qu'un objet `streams` est ouvert, sinon 2 s. Fusionner les deltas
dans le texte assistant affiché. `sessionStorage` clé `astrotan.chatSession`
(le jeton seul). Textes FR. Accessible : bouton « Aide », `aria-live` sur
les réponses. Pas de heartbeat présence.

`ChatBubble.astro` : `const settings = await getConvexClient().query(api.settings.get, {})` puis monte l'îlot ssi `settings?.agentEnabled === true`.

- [ ] **Step 3: Tests + commit**

```bash
pnpm --filter @astrotan/web test
```

### Task 10: RGPD — registre, pas le bandeau

**Files:**
- Modify: `apps/web/src/config/legal.ts`
- Modify: `apps/web/src/config/legal.test.ts` (il refuse une durée qui n'est pas celle de `retention.ts`)
- Modify: `packages/backend/convex/lib/leadCascade.ts` + test
- Create: `apps/web/src/config/consent.chat.test.ts` **ou** étendre un test existant : `consentVersion === "1.0.0"`

- [ ] **Step 1: Write the failing test**

`legal.test.ts` : la nouvelle `purpose` est publiée ; `retention` contient `1095`.
`leadCascade` : après insert session (+ présence si la ligne existe),
`deleteLeadCascade` les efface. Suppression du thread — noms documentés
(`threads.mdx`, `/get-convex/agent`) :

```ts
// userId à createThread = String(leadId)
await agent.deleteThreadsByUserId(ctx, { userId: String(leadId) })
// ou, un thread : agent.deleteThreadAsync(ctx, { threadId }) depuis MutationCtx
```

**Pas** de `deleteThread` nu. Lire les exports du package installé. Si
seules les méthodes d'instance existent, un helper `lib/deleteLeadThread.ts`
construit un `Agent` minimal **uniquement** pour appeler ces méthodes
(pas pour parler à OpenRouter) — ou `ctx.runMutation(components.agent.threads.…)`
si le composant expose la mutation. Un test de cascade échoue tant que le
thread reste.

```ts
test("consentVersion reste 1.0.0 tant que le chat n'a pas de cookie", async () => {
  const { consentConfig } = await import("./consent")
  expect(consentConfig.consentVersion).toBe("1.0.0")
})
```

- [ ] **Step 2: Ligne processings**

Purpose **exact** :

`Répondre, dans le chat du site, aux questions d'un visiteur et qualifier sa demande`

Destinataires : Convex, Inc. ; OpenRouter, Inc. ; « et, le cas échéant, les services que le responsable a connectés depuis l'administration (agenda, serveurs d'assistance) ».

Durée : recopier le motif 1095 jours / `LEAD_RETENTION_DAYS` (le test relit `retention.ts`).

- [ ] **Step 3: Pass**

```bash
pnpm --filter @astrotan/web test
pnpm --filter @astrotan/backend test convex/lib/leadCascade.ts convex/_dataRegistry.test.ts convex/retention.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: déclarer le traitement chat et cascade le thread

EOF
)"
```

### Task 11: Écran `/settings/agent` + montage bulle

**Files:**
- Create: `apps/admin/src/routes/_authed/settings/agent.tsx`
- Create: `apps/admin/src/routes/_authed/settings/agent.test.tsx` (chrome, comme `ia.test.tsx`)
- Modify: `apps/admin/src/components/settings-nav.tsx` + `settings-nav.test.tsx`

- [ ] **Step 1: Test nav**

```ts
expect(SETTINGS_PAGES.find((p) => p.to === "/settings/agent")).toMatchObject({
  label: "Agent",
})
```

- [ ] **Step 2: Page**

Formulaire FR : interrupteur « Afficher la bulle sur le site », nom d'affichage, instructions, base de savoir (`textarea` bornée). Sauve via `settings.updateAgent`. Lien vers `/settings/ia` si OpenRouter non configuré (`secrets.status`). Pas de saisie de clé ici.

- [ ] **Step 3:**

```bash
pnpm --filter @astrotan/admin test
```

**Fin de phase 1.** Vérifier à la main (Antoine) : allumer l'agent, poser une clé OpenRouter déjà saisie, ouvrir le site, gate e-mail, un échange. Sans clé : message d'indisponibilité.

---

## Chunk 2 — Phase 2: inbox, présence, handover

### Task 12: `takeOver` / `releaseToAi` + messages staff

**Files:**
- Create: `packages/backend/convex/chatStaff.ts`
- Test: `packages/backend/convex/chat.handover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("takeOver pose controller staff et un leadEvent handover", async () => {
  await admin.mutation(api.chatStaff.takeOver, { leadId })
  // controller === "staff", event type handover
})

test("un editor peut prendre la main", async () => { /* requireRole owner/admin/editor */ })

test("après takeover, send visiteur n'appelle pas stream", async () => { /* … */ })

test("releaseToAi rend controller ai", async () => { /* … */ })
```

- [ ] **Step 2: Implement**

`requireRole(["owner","admin","editor"])`. Événement `handover` avec `from`/`to`/`actorId`/`actorName` (recopie du nom, comme `leads.move`).

`chat.staffReply` :

```ts
import { saveMessage } from "@convex-dev/agent"

await saveMessage(ctx, components.agent, {
  threadId,
  order: "next",
  agentName: actorName,
  message: { role: "assistant", content: body },
})
```

Doc : « Save a human message as an agent ».

- [ ] **Step 3:**

```bash
pnpm --filter @astrotan/backend test convex/chat.handover.test.ts
```

Registre : `chatStaff.takeOver`, `chatStaff.releaseToAi`, `chatStaff.staffReply`.
Barrel : `import "../convex/chatStaff"`.

### Task 13: `listStaffMessages` + présence

**Files:**
- Modify: `packages/backend/convex/chatStaff.ts`
- Create: `apps/web/src/pages/api/chat/presence.ts`
- Test: `packages/backend/convex/chat.staff.test.ts`

Query staff (doc « Expose Stream Deltas via Query ») — **dans `chatStaff.ts`** :

```ts
import { paginationOptsValidator } from "convex/server"
import { vStreamArgs, listUIMessages, syncStreams } from "@convex-dev/agent"

export const listStaffMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    await assertThreadOnALead(ctx, args.threadId)
    const paginated = await listUIMessages(ctx, components.agent, args)
    const streams = await syncStreams(ctx, components.agent, args)
    return { ...paginated, streams }
  },
})
```

Heartbeat : `chatStaff.staffHeartbeat` (upsert `chatPresence`). Query
`chatStaff.presence` (session) : `{ visitorOnline, staffOnline }` à
partir de `visitorLastSeenAt` et `chatPresence`, seuil 45 s.

`chat.visitorHeartbeat` : mutation **secrète** (Astro, phase 2), pose
`visitorLastSeenAt`. Porte `/api/chat/presence` **créée ici**, pas en
Task 8.

Enseigner d'éventuelles formes nouvelles à `publicQueryFamily` (si `presence` visiteur est publique).

```bash
pnpm --filter @astrotan/backend test convex/chat.staff.test.ts convex/pages.publicQueryFamily.test.ts
```

### Task 14: Panneau `/leads`

**Files:**
- Create: `apps/admin/src/components/lead-chat-panel.tsx`
- Create: `apps/admin/src/components/lead-chat-panel.test.tsx`
- Modify: `apps/admin/src/routes/_authed/leads.tsx`

```tsx
import { useUIMessages, SmoothText } from "@convex-dev/agent/react"

const { results, status, loadMore } = useUIMessages(
  api.chatStaff.listStaffMessages,
  { threadId },
  { initialNumItems: 32, stream: true },
)
```

Pastille « visiteur en ligne » / « conseiller en ligne ». Boutons « Prendre la main » / « Rendre à l'assistant ». Textarea + envoyer → `chatStaff.staffReply`. FR. Pas de TanStack Query.

Test source (comme `-leads.test.tsx`) : le fichier importe `useUIMessages` et `api.chatStaff.takeOver`.

```bash
pnpm --filter @astrotan/admin test
```

**Fin de phase 2.** Vérifier navigateur admin : deux onglets, takeover coupe la prochaine réponse IA.

---

## Chunk 3 — Phase 3: Google Calendar

### Task 15: Secrets et OAuth

**Files:**
- Modify: `packages/backend/convex/secrets.ts` (`SECRET_NOMS` + `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`)
- Modify: `packages/backend/convex/secrets.test.ts` (une query ne rend jamais `iv` / `chiffre`)
- Modify: `packages/backend/convex/schema.ts` (`googleCalendarClientId?`, `googleCalendarId?`)
- Create: `packages/backend/convex/connectors.ts`
- Create: `apps/admin/src/routes/api/connectors/google/callback.ts` (TanStack Start server)
- Modify: `/settings/agent`

- [ ] **Step 1: Tests secrets** — ajouter les noms à la liste close ; `set` refuse un nom hors liste ; `status` rend `configured` sans valeur.

- [ ] **Step 2: Flux**

`connectors.googleAuthUrl` (query owner/admin) : URL `https://accounts.google.com/o/oauth2/v2/auth`, `redirect_uri = ${SITE_URL}/api/connectors/google/callback`, scopes `calendar.freebusy` + `calendar.events`, `access_type=offline`, `prompt=consent`.
Callback serveur : échange `code` → refresh, `connectors.storeGoogleRefresh` mutation qui `chiffrer` via le même chemin que `secrets.set`.
Pas de route sur `*.convex.site`. Pas d'OAuth visiteur.

- [ ] **Step 3:**

```bash
pnpm --filter @astrotan/backend test convex/secrets.test.ts convex/connectors.test.ts
pnpm --filter @astrotan/admin test
```

### Task 16: Outils Calendar

**Files:**
- Create: `packages/backend/convex/lib/calendarTools.ts`
- Test: `packages/backend/convex/lib/calendarTools.test.ts` (fetch mocké)

```ts
export const calendarFreeBusy = createTool({
  description: "Créneaux occupés sur les 14 prochains jours.",
  args: z.object({
    timeMin: z.string(),
    timeMax: z.string(),
  }),
  handler: async (ctx, args) => { /* refresh, GET freebusy, borne 14j */ },
})

export const calendarCreateEvent = createTool({
  description: "Crée un événement et invite l'e-mail du lead de ce fil.",
  args: z.object({
    summary: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  handler: async (ctx, args) => {
    const email = await ctx.runQuery(internal.chat.leadEmailForThread, {
      threadId: ctx.threadId,
    })
    // jamais args.email
  },
})
```

Sans refresh : retour `{ code: "CALENDAR_DISCONNECTED" }`.
Brancher ces outils dans `makeVisitorAgent` **en plus** des outils pages.

```bash
pnpm --filter @astrotan/backend test convex/lib/calendarTools.test.ts
```

**Fin de phase 3.**

---

## Chunk 4 — Phase 4: MCP admin

### Task 17: Table et CRUD

**Files:**
- Modify: `schema.ts` (`mcpServers`)
- Modify: `_dataRegistry.ts` — `createdBy` → « Savoir qui a publié, modifié ou téléversé quoi »
- Create: `packages/backend/convex/mcpServers.ts`
- Test: `packages/backend/convex/mcpServers.test.ts`

- [ ] **Step 1: Tests**

```ts
test("refuse transport stdio", async () => {
  await expect(
    admin.mutation(api.mcpServers.create, {
      name: "x",
      transport: "stdio",
      url: "https://example.com/mcp",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_TRANSPORT" } })
})

test("refuse http non-localhost en prod", async () => {
  await expect(
    admin.mutation(api.mcpServers.create, {
      name: "x",
      transport: "http",
      url: "http://evil.example/mcp",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_URL" } })
})

test("un editor ne crée pas de serveur", async () => { /* refuse */ })
```

`transport` validator : `"http" | "sse"` seulement.

En-têtes : mutation séparée qui chiffre dans le magasin dédié (préfixe contrôlé, **pas** un `nom` libre depuis le client). `secrets.status`-like : `headersConfigured: boolean`.

- [ ] **Step 2: Implement + UI** sur `/settings/agent` (liste, URL, transport, interrupteur, champ en-tête write-only).

```bash
pnpm --filter @astrotan/backend test convex/mcpServers.test.ts convex/_dataRegistry.test.ts
```

### Task 18: Charger les outils MCP dans le stream

**Files:**
- Create: `packages/backend/convex/lib/loadMcpTools.ts`
- Test: `packages/backend/convex/lib/loadMcpTools.test.ts`
- Modify: `visitorAgent` / `chatStream.stream`

Doc Context7 `/vercel/ai` + ai-sdk.dev :

```ts
import { createMCPClient } from "@ai-sdk/mcp"

const client = await createMCPClient({
  transport: { type: server.transport, url: server.url, headers },
})
const toolSet = await client.tools()
// préfixer les clés : `${server.name}__${toolName}`
```

`@ai-sdk/mcp` s'installe **ici**, pas au chunk 0.

```ts
import { createMCPClient } from "@ai-sdk/mcp"

const { tools, close } = await loadMcpTools(ctx)
try {
  await agent.streamText(
    ctx,
    { threadId },
    { promptMessageId, tools: { ...native, ...tools } },
    { saveStreamDeltas: true },
  )
} finally {
  await close()
}
```

`try/finally`, pas `onEnd` / `onError` de l'AI SDK : `Agent.streamText` ne
documente pas qu'il les retransmet. Un serveur injoignable : catch,
continuer, ne pas faire échouer le tour. Préférer `type: "http"` ;
SSE = connexion longue dans une action Convex (timeout).

Collision : le préfixe empêche l'override silencieux documenté (« subsequent tool sets override »).

```bash
pnpm --filter @astrotan/backend test convex/lib/loadMcpTools.test.ts
```

**Fin de phase 4.**

---

## Chunk 5 — Phase 5: RAG FAQ / pages

Ne pas commencer avant qu'Antoine le demande. La phase 1 reste correcte sans embeddings.

### Task 19: Monter `@convex-dev/rag`

**Files:**
- `package.json` backend : `@convex-dev/rag`
- `convex.config.ts` : `app.use(rag)` (doc Context7 `/get-convex/rag`)
- Create: `packages/backend/convex/lib/siteRag.ts`

```ts
import { RAG } from "@convex-dev/rag"
import { components } from "../_generated/api"

export function siteRag() {
  return new RAG(components.rag, {
    textEmbeddingModel: /* modèle + dimension : lire la doc provider AU MOMENT de cette phase */,
    embeddingDimension: /* idem */,
    filterNames: ["source"],
  })
}
```

- [ ] Codegen humain `npx convex dev --once`
- [ ] `internalAction` `rag.reindex` : owner/admin. **Pas** de
  `rag.delete({ namespace })` — ça n'existe pas. `rag.list` paginé sur
  le namespace `"site"`, puis `rag.delete(ctx, { entryId })` pour chaque
  entrée, puis `rag.add` de `agentKnowledge` (`source: "knowledge"`) et
  de chaque page dont `getPublishedPage` + GET 200 (`source: "page"`)
- [ ] `createTool` `searchKnowledge` → `rag.search({ namespace: "site", query, limit: 8, vectorScoreThreshold: 0.5 })`
- [ ] Bouton « Réindexer » sur `/settings/agent`
- [ ] Tests : reindex n'ajoute pas un slug brouillon ; search est une action (pas une query)

```bash
pnpm --filter @astrotan/backend test convex/lib/siteRag.test.ts
pnpm --filter @astrotan/backend exec tsc --noEmit
```

**Fin de phase 5.**

---

## Vérifications transverses (chaque chunk)

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
pnpm --filter @astrotan/backend test
pnpm --filter @astrotan/web test
pnpm --filter @astrotan/admin test
node scripts/check-env-wiring.mjs
```

Humain, après tout push de `convex/` : `npx convex dev --once`.

Ne pas lancer le playground. Ne pas ajouter TanStack Query. Ne pas committer de `.env`.

## Ordre d'exécution pour un agent

1. Chunk 0 → 1 (phase 1 entière) → s'arrêter, montrer à Antoine.
2. Chunk 2 (phase 2) → s'arrêter.
3. Chunk 3, 4, 5 : chacun sur demande, jamais en avance.

Subagent-driven-development : un sous-agent **frais par task**, revue en deux passes, TDD dans l'ordre des cases.
