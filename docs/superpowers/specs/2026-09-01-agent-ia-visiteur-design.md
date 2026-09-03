# Agent IA visiteur — bulle, qualification, inbox, outils

**Date** : 1er septembre 2026
**Statut** : relue contre Context7 le 1er septembre 2026 — écarts d'API
corrigés, prêt à exécuter la phase 1
**Invariants** : [`2026-08-27-astrotan-design.md`](2026-08-27-astrotan-design.md),
[`2026-08-29-secrets-et-chiffrement.md`](2026-08-29-secrets-et-chiffrement.md)
**Skills** : `consent-rgpd`, `convex-function`, `convex` (dépôt).
`convex-create-component` vit chez l'opérateur
(`~/.claude/skills/convex-create-component`), pas dans ce repo — on n'écrit
pas un composant, on **installe** `@convex-dev/agent`.
**Sources API (1er septembre 2026, Context7)** :

| Source | Library ID Context7 | Ce qu'on en retient |
|---|---|---|
| Vercel AI SDK | `/vercel/ai`, `/websites/ai-sdk_dev` | **AI SDK 7** (`ai@^7`). `streamText` / `generateText`, `tool({ inputSchema })` (plus `parameters`). `stopWhen: isStepCount(n)` **dans `ai`**. `@ai-sdk/mcp` → `createMCPClient` HTTP/SSE/stdio |
| `@convex-dev/agent` | `/get-convex/agent` | **`@convex-dev/agent@^0.7` exige `ai@^7`** (`MIGRATION.md`). `new Agent` — **pas** de `defineAgent`. `languageModel` (pas le `chat:` des pages docs.convex.dev périmées). `createThread`, `createTool` (`args` Zod), `saveMessage` **autonome**, `listUIMessages`, `syncStreams` + `vStreamArgs`, `useUIMessages`, `saveStreamDeltas`, `deleteThreadAsync` / `deleteThreadSync` / `deleteThreadsByUserId`. `stepCountIs` **réexporté par l'agent** |
| Convex Agents (llms) | `/llmstxt/convex_dev_llms-full_txt` | Aperçu + playground `definePlaygroundAPI` (refusé comme surface produit). Certaines pages montrent encore `@convex-dev/agents` (pluriel) et `chat:` — **ne pas copier** |
| `@openrouter/ai-sdk-provider` | `/openrouterteam/ai-sdk-provider` | **v3.x = AI SDK 7**. `createOpenRouter({ apiKey, appName, appUrl }).chat(modelId)` |
| `@convex-dev/rag` | `/get-convex/rag` | `new RAG`, `rag.add`, `rag.search`, `rag.list`, `rag.delete({ entryId })` — **pas** de delete-par-namespace. Phase 5 seulement |

Cette livraison ajoute **un** agent sur le site public : il répond, qualifie,
et (aux phases 3–4) prend rendez-vous. L'administration voit le fil dans
`/leads`, peut couper ou rendre la main, et branche des outils. Ce n'est
pas un second CMS, pas un second canal de leads, pas un playground Convex
livré aux adoptants.

## 1. Objectif

Un visiteur ouvre une bulle, donne son e-mail **avant** le premier message,
parle à un agent. Une fiche `leads` existe dès cette porte — unicité par
e-mail, statut `new` si la fiche est créée. Un membre du staff ouvre
`/leads`, voit si le visiteur est en ligne, lit le transcript, écrit en
direct, coupe l'IA ou la relance.

Cinq phases, chacune livrable et testable seule. On n'installe pas la
phase N+1 pour faire marcher la phase N.

| Phase | Ce qui marche à la fin | Ce qui n'y est pas |
|---|---|---|
| 1 | Bulle, gate e-mail, fil, fiche lead, refus propre sans clé | Inbox live, calendrier, MCP, RAG |
| 2 | Inbox dans `/leads`, présence, handover humain ↔ IA | Connecteurs, MCP |
| 3 | Outil Google Calendar (OAuth, freebusy + créer un événement) | MCP, RAG |
| 4 | Serveurs MCP HTTP/SSE configurés dans l'admin | RAG |
| 5 | `@convex-dev/rag` sur base rédigée + pages publiées | Rien d'autre à inventer |

## 2. Décisions, et ce qu'elles ferment

| Décision | Conséquence |
|---|---|
| Un seul agent | Une classe `Agent`, un thread par fiche. Pas d'agent « FAQ » à côté d'un agent « RDV ». Les outils s'ajoutent au même objet. |
| E-mail avant le 1er message | Pas de thread anonyme. Pas de message user tant que `chat.start` n'a pas rendu un jeton. |
| Table `leads` existante, unicité e-mail | Pas de table `chatLeads`. Un habitué du formulaire qui ouvre la bulle **reste une seule carte**. |
| Inbox dans `/leads` | Pas de route `/inbox`. Le panneau de chat s'ouvre sur la fiche déjà là. |
| Humain coupe ou rend la main | Pas le motif « outil `askHuman` sans handler » de la doc agent (l'IA demande un humain). Ici le staff **décide**. `saveMessage` sert à écrire le tour humain. |
| Savoir = identité + base rédigée + pages **publiées** | La base ne porte pas le corps des pages (invariant 5). L'outil lit le HTML **déjà public** sur `WEB_SITE_URL`, après un `getPublishedPage` qui a filtré `status === "published"`. |
| Connecteurs **et** MCP | Phase 3 = OAuth Google Calendar. Phase 4 = `createMCPClient` HTTP/SSE. Les deux alimentent le même `tools`. |
| `@convex-dev/agent` + `@ai-sdk/mcp` | Pas CopilotKit, pas Mastra, pas VoltAgent, pas `@convex-dev/rag` avant la phase 5. |
| Porte étroite comme `/api/contact` | Le navigateur visiteur **n'appelle jamais Convex**. Pas de `ConvexReactClient` dans `apps/web`. Pas de Bearer sur `*.convex.site`. Pas de secret dans `settings.get`. |
| Playground Convex | `definePlaygroundAPI` + `npx @convex-dev/agent-playground` **ne sont pas une surface produit**. L'inbox staff **est** le playground. Aucune étape d'installateur « lance cette commande ». |
| stdio MCP | Refusé. Le runtime Convex ne spawn pas de processus. Transports documentés pour nous : `type: "http"` et `type: "sse"` (`createMCPClient`). |
| Expand-only | Champs nouveaux en `v.optional`. Tables nouvelles. Aucun champ retiré. Les tables du composant agent sont **les siennes** — on n'y touche pas. |
| UI FR, code EN | Libellés, erreurs, registre : français. Identifiants, fichiers, messages de commit : anglais. |

## 3. Ce qui existe déjà, et ce qu'on ne reprend pas

| Déjà là | On s'en sert | On n'en fait pas |
|---|---|---|
| `leads.submit`, `/api/contact`, `LEAD_SUBMIT_SECRET`, rate limiter | Même secret, même empreinte d'origine, même unicité e-mail pour **ouvrir** la session | On n'écrit pas un second `submit` qui recopierait le corps du chat dans `leadMessages` |
| `leadMessages` | Reste le canal **formulaire** | Pas le transcript agent. Deux copies du même texte divergeraient. |
| `deleteLeadCascade` | Gagne la suppression du thread agent + des tables neuves | Une seconde cascade |
| Cloche `leadNotification` | Un `chat.start` qui **crée** une fiche déclenche le même résolveur qu'un `submit` | Un nouveau type d'e-mail « l'IA a parlé » |
| `lireSecret("OPENROUTER_API_KEY")`, `/settings/ia`, allowlist `openRouterModel` | Même clé, même modèle (défaut `x-ai/grok-4.6`) | Une seconde clé « agent » |
| `settings.get` projection explicite + `settings.publicProjection.test.ts` | `agentEnabled` (booléen) peut y entrer | Identité longue, base de savoir, URL MCP, jetons |
| Table `secrets`, `SECRETS_KEY` | Jetons OAuth, en-têtes MCP | Champ secret dans `settings` |
| `previewToken` (HMAC, vérifié deux fois) | Le jeton de session chat **copie ce schéma**, clé distincte `CHAT_SESSION_SECRET` | Réutiliser `PREVIEW_SECRET` (autre `type`, autre TTL, autre risque de rejeu) |
| `@convex-dev/rate-limiter` déjà dans `convex.config.ts` | Deux compteurs chat (origine, e-mail) | Un limiteur maison |
| `consentVersion` `1.0.0`, registre `processings` | Nouvelle **ligne de traitement** | Incrément de version en phase 1 (pas de cookie, pas de balise tierce) |
| `lib/openrouter.ts` `fetch` JSON | Reste pour SEO/GEO/images | L'agent n'appelle **pas** `completerJson`. Il passe par le provider AI SDK. |

`apps/web` parle à Convex uniquement via `ConvexHttpClient` **côté serveur**
(`src/lib/convexClient.ts`). Il n'y a aucun `.setAuth`. Cet invariant ne
bouge pas.

## 4. Ce qu'on prend des bibliothèques, ce qu'on écrit

### 4.1 `@convex-dev/agent` — on prend

Montage du composant, documenté :

```ts
// packages/backend/convex/convex.config.ts
import agent from "@convex-dev/agent/convex.config"
app.use(agent)
```

API retenue, noms **tels que `/get-convex/agent` 2026** les écrit
(`docs.convex.dev/agents/*` a 6–12 mois de retard sur plusieurs pages) :

| Symbole | Import | Rôle |
|---|---|---|
| `Agent` | `@convex-dev/agent` | `new Agent(components.agent, { languageModel, … })`. **Pas** de `defineAgent`. Instance construite **dans l'action** (la clé n'est pas figée au chargement du module) |
| `stepCountIs` | `@convex-dev/agent` | `stopWhen: stepCountIs(8)` sur l'`Agent`. L'AI SDK 7 exporte `isStepCount` depuis `ai` — on n'importe **pas** celui-là pour l'Agent |
| `createThread` | `@convex-dev/agent` | `createThread(ctx, components.agent, { userId, title })` — mutation **ou** action. `userId` = `leadId` en **string** (frontière de composant) |
| `createTool` | `@convex-dev/agent` | `{ description, args: z.object(…), handler(ctx, args, options) }`. `ctx` porte `runQuery`, `runMutation`, `threadId`. Ce n'est **pas** `tool({ inputSchema })` ni `parameters` |
| `agent.streamText` | instance, **action seulement** | Après `saveMessage` : `{ promptMessageId }` — **pas** un second `prompt` (ça dupliquerait le tour user). 4e arg : `{ saveStreamDeltas: true }` (option `{ chunking: "line", throttleMs: 1000 }` = l'exemple officiel, pas 200) |
| `saveMessage` | `@convex-dev/agent` **autonome** | **Mutation** `chat.send` : `saveMessage(ctx, components.agent, { threadId, prompt: body })` → `{ messageId }`. Pas `agent.saveMessage` ici : l'`Agent` n'existe que dans l'action (il exige la clé). Staff : `saveMessage(ctx, components.agent, { threadId, order: "next", agentName, message: { role: "assistant", content } })` |
| `listUIMessages` | `@convex-dev/agent` | Query paginée de messages UI |
| `syncStreams` + `vStreamArgs` | `@convex-dev/agent` | **Obligatoire** pour voir le texte arriver — staff **et** visiteur. `listUIMessages` seul ne fusionne pas les deltas |
| `useUIMessages`, `useSmoothText`, `SmoothText` | `@convex-dev/agent/react` | **Admin seulement** |
| `deleteThreadAsync` / `deleteThreadSync` / `deleteThreadsByUserId` | méthodes d'instance | **Pas** de `deleteThread` nu. Cascade : `userId` à la création = `String(leadId)`, donc `deleteThreadsByUserId` depuis la mutation (async) ou action sync. Vérifier l'export exact dans le package installé |

Le composant possède ses tables (threads, messages, deltas). L'app ne les
lit pas avec `ctx.db`. Elle passe par l'API ci-dessus. Un `Id` de table
app traverse la frontière en `v.string()`.

**Auth et env restent dans l'app** (skill `convex-create-component`) : le
composant ne voit ni `ctx.auth` ni `process.env` du déploiement, ni
`lireSecret`. L'action lit la clé, construit `createOpenRouter`, puis
`new Agent(components.agent, { languageModel: openrouter.chat(modelId), … })`.

On **n'écrit pas** un Agent au niveau module avec `openai.chat("gpt-4o-mini")`
comme l'exemple getting-started : cet exemple suppose une clé d'environnement
toujours là. Chez nous la clé peut n'exister que dans `secrets`, et
l'absence doit refuser proprement (`AGENT_UNCONFIGURED`).

### 4.2 `@convex-dev/agent` — on n'embarque pas

| API | Pourquoi |
|---|---|
| `definePlaygroundAPI` / `npx @convex-dev/agent-playground` / `npx convex run --component agent apiKeys:issue` | Surface de debug. Un template qui dit « lance cette commande » n'est pas livré. |
| Outil `askHuman` sans `execute` | Motif « l'IA interrompt pour poser une question au support ». Notre handover est un drapeau staff, pas un tool call. |
| `ConvexProviderWithPlayground` | Admin a déjà `ConvexProvider` + session Better Auth. |

### 4.3 AI SDK + `@ai-sdk/mcp` — on prend

- `createMCPClient` depuis `@ai-sdk/mcp`.
- Transport objet : `{ type: "http" \| "sse", url, headers? }`. Pas
  `Experimental_StdioMCPTransport`.
- `const toolSet = await client.tools()` puis fusion dans l'objet `tools`
  passé à `Agent` / `streamText`.
- `await client.close()` dans un `try/finally` autour de
  `agent.streamText` (l'Agent ne documente pas la retransmission de
  `onEnd` / `onError` du cookbook AI SDK). Plusieurs serveurs :
  `Promise.all(clients.map(c => c.close()))`.
- Outils AI SDK 6 **et 7** : le nom est la **clé** de l'objet `tools` ; plus
  de propriété `name`. Schéma : `inputSchema` (pas `parameters`). L'exemple
  `askHuman` de la doc agent montre encore `parameters` + `zod/v3` — ne pas
  le recopier. Après install, si les peers de l'agent imposent `zod/v3`
  pour `createTool`, l'importer ainsi.

Les outils **maison** restent `createTool` de `@convex-dev/agent` (`args` Zod,
handler avec `ctx`). Les outils MCP restent ceux de `client.tools()`. On ne
les réécrit pas.

### 4.4 `@openrouter/ai-sdk-provider` — on prend

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

const openrouter = createOpenRouter({
  apiKey,
  appName: "AstroTan",
  appUrl: process.env.WEB_SITE_URL, // attribution OpenRouter, jamais un domaine client en dur
})
// languageModel: openrouter.chat(resolveOpenRouterModel(privee?.openRouterModel))
```

Même allowlist que SEO (`lib/openRouterModels.ts`). Pas `@ai-sdk/openai`
pointé sur OpenRouter « à la main » : le provider officiel porte les
en-têtes et le routage.

### 4.5 `@convex-dev/rag` — phase 5 seulement

```ts
import rag from "@convex-dev/rag/convex.config.js"
app.use(rag)

const rag = new RAG(components.rag, {
  textEmbeddingModel: /* embedding OpenRouter ou modèle documenté à l'install */,
  embeddingDimension: /* celui du modèle retenu */,
  filterNames: ["source"],
})
await rag.add(ctx, { namespace: "site", text, filterValues: [{ name: "source", value: "page" }] })
await rag.search(ctx, { namespace: "site", query, limit: 8, vectorScoreThreshold: 0.5 })
// Suppression : rag.delete(ctx, { entryId }) — pas de delete-par-namespace.
// Réindex : rag.list paginé, delete chaque entryId, puis add.
```

Phase 1 à 4 : l'agent lit la base rédigée en entier (bornée) et les pages
via l'outil HTTP. Pas d'embeddings, pas de coût caché.

### 4.6 Ce qu'on écrit (et seulement ça)

| Unité | Responsabilité | Ne fait pas |
|---|---|---|
| `lib/chatSessionToken.ts` | HMAC autonome ; le jeton **embarque** leadId + threadId (base64url) | Auth Better Auth |
| `lib/chatRateLimit.ts` | Deux buckets (origine, e-mail) | Limite du formulaire (reste `leadRateLimit`) |
| `lib/visitorAgent.ts` | Construit l'`Agent` **dans l'action** (clé, modèle, instructions, outils du palier) | HTTP visiteur, `saveMessage` de la mutation |
| `lib/publishedPageText.ts` | Après `getPublishedPage`, GET `WEB_SITE_URL` + extraction texte | Lire un brouillon, utiliser un jeton preview |
| `chat.ts` | `start`, `send`, `listVisitorMessages` (+ heartbeats visiteur en phase 2) | Stream, staff, UI |
| `chatStream.ts` | `internalAction` stream + `getAgentConfig` + index des pages publiées | Porte HTTP |
| `chatStaff.ts` | Phase 2 : takeover, `staffReply`, `listStaffMessages`, présence staff | Porte publique |
| `connectors.ts` | OAuth Google, outils calendrier (phase 3) | MCP |
| `mcpServers.ts` | CRUD serveurs, chargement `createMCPClient` (phase 4) | stdio |
| `/api/chat/start`, `/message`, `/messages`, `/presence` | Portes Astro, secret serveur, honeypot, empreinte | Client Convex navigateur |
| Îlot bulle (`ChatBubble`) | Gate, fil, poll des messages via Astro | `useUIMessages` |
| Panneau `/leads` | `useUIMessages`, présence, takeover | Porte publique |
| `/settings/agent` | Identité, base, interrupteur, (plus tard) Calendar + MCP | Clé OpenRouter (reste `/settings/ia`) |

Fichiers < 200 lignes. Helpers purs hors handlers. Fixtures de test dans
`packages/backend/testing/`, jamais sous `convex/` à nom simple.

## 5. Architecture

```
Visiteur                    apps/web (Node)              Convex
  │                              │                          │
  │  POST /api/chat/start        │                          │
  │  (email, name, honeypot)     │  chat.start              │
  │ ──────────────────────────►  │  secret + origin hash    │
  │                              │ ──────────────────────── ► leads (get-or-create)
  │                              │                          │ createThread (composant)
  │  Set-Cookie session? non     │  jeton HMAC              │ chatSessions
  │  body: { token }             │ ◄────────────────────────│
  │ ◄──────────────────────────  │                          │
  │  token → sessionStorage      │                          │
  │                              │                          │
  │  POST /api/chat/message      │  chat.send               │
  │ ──────────────────────────►  │ ──────────────────────── ► saveMessage autonome
  │                              │                          │ → { messageId }
  │                              │                          │ si controller=ai :
  │                              │                          │   schedule chatStream
  │                              │                          │   promptMessageId
  │  GET  /api/chat/messages     │  chat.listVisitorMessages│ listUIMessages
  │  (poll pendant stream)       │ ──────────────────────── ► + syncStreams

  │ ◄──────────────────────────  │                          │
                                    Staff (admin, session)
                                         │
                                         │ useUIMessages(chatStaff.listStaffMessages, {stream:true})
                                         │ chatStaff.takeOver / releaseToAi
                                         │ saveMessage autonome (assistant, agentName, order:"next")
```

Trois portes, pas une de plus :

1. **Astro → Convex (visiteur)** : mutations/queries **publiques** qui
   exigent `LEAD_SUBMIT_SECRET` (écritures) et/ou le jeton HMAC (lecture
   du fil). Même contrat que `leads.submit` / `previewPage`.
2. **Admin → Convex** : session Better Auth, `requireRole` à chaque
   fonction. L'UI masque.
3. **Action agent → OpenRouter / Google / MCP** : `lireSecret` +
   connecteurs. Jamais un jeton en clair dans une query.

`*.convex.site` sert déjà Better Auth. Le chat visiteur **n'y ajoute
aucune route HTTP**. Pas de webhook public « l'agent répond ici ».

### 5.1 Pourquoi le visiteur ne s'abonne pas à Convex

`useUIMessages` est le bon hook — pour un client qui a déjà une session.
Le mettre dans `apps/web` ouvrirait un `ConvexReactClient` dans le
navigateur, donc une famille de queries publiques appelables hors de la
porte Astro. La preview a déjà ce modèle (jeton HMAC), et c'est un
compromis accepté pour un GET de page. Un fil de chat est une **écriture
continue** + de la donnée personnelle : on garde le secret côté serveur
et on **poll** `/api/chat/messages` (toutes les 400 ms tant qu'un flux
est actif, 2 s au repos). L'admin, lui, s'abonne.

Le poll n'est pas `useUIMessages` : la query visiteur a **quand même**
`streamArgs: vStreamArgs` et appelle `syncStreams`. `listUIMessages` seul
ne rend pas les deltas. Astro relit le type `StreamArgs` du package
installé (premier poll = la valeur « lister les flux du thread », souvent
`{ kind: "list" }`) et fusionne `streams` dans le JSON. L'îlot affiche le
texte partiel ; `status === "streaming"` s'il reste un flux ouvert.

## 6. Unités

### 6.1 Session de chat (`chatSessions`)

Table app, expand. Une ligne par jeton encore valable.

```
chatSessions
  leadId: Id<"leads">
  threadId: string          // id du composant agent
  tokenHash: string         // SHA-256 du jeton, jamais le jeton
  expiresAt: number
  index by_lead, by_thread, by_tokenHash
```

Le format `${expiresAt}.${hex}` de la preview **ne suffit pas** : Astro
n'a ni `leadId` ni `threadId` avant l'appel réseau, et le HMAC signe
justement ce triplet. Un jeton qui n'embarque pas les deux ids est
invérifiable côté Astro (la « 1re barrière » serait un mensonge).

Fil de fer :

- message signé : `chatSession:${leadId}:${threadId}:${expiresAt}`
- jeton : `${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex}`
  (base64url **sans padding**, alphabet `-_` — aucun `.` dans les
  segments, le parse est univoque)
- `verifyChatSessionToken(token)` rend `{ leadId, threadId, expiresAt }`
  ou `null`. **Jamais** d'exception sur un jeton attaquant (même
  discipline que `previewToken` : false/null, pas un throw). L'absence
  ou la trop courte `CHAT_SESSION_SECRET` throw — c'est une
  configuration, pas une entrée.
- `chat.send` / `listVisitorMessages` lèvent `INVALID_SESSION` quand
  verify rend `null`, **ou** quand aucune ligne `chatSessions` n'a ce
  `tokenHash` (révocation).

TTL **24 h**, renouvelé à chaque `chat.send` (nouvelle ligne ou patch
du hash — l'ancien jeton cesse de matcher). Vérifié dans Astro **avant**
tout appel réseau, puis dans Convex.

`CHAT_SESSION_SECRET` ≥ 32 caractères, lu au point d'usage. Câblage
**complet**, pas une ligne de README :

| Endroit | Quoi |
|---|---|
| `scripts/bootstrap.mjs` `GENERATED` | `{ key: "CHAT_SESSION_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 }` + `convex env set` |
| `LOCAL_TARGETS` web | injecté dans `apps/web/.env.local` **comme** `PREVIEW_SECRET` (aujourd'hui `LEAD_SUBMIT_SECRET` n'y est pas injecté — ne pas recopier cet oubli) |
| `.env.vps` | une ligne à côté de `LEAD_SUBMIT_SECRET` |
| `packages/backend/.env.example` | documentée (contrôle Convex de `check-env-wiring`) |
| `apps/web/.env.example` | documentée |
| `docker/.env.example` | documentée |
| `docker/docker-compose.yml` service `web` | `CHAT_SESSION_SECRET: ${CHAT_SESSION_SECRET:?…}` — dès qu'une lecture `process.env.CHAT_SESSION_SECRET` existe sous `apps/web`, le wiring check l'exige |

Le jeton vit en **`sessionStorage`**, clé `astrotan.chatSession`. Pas de
cookie. Fermer l'onglet = reparler à la gate (même e-mail → même fiche).

### 6.2 Fiche lead (expand)

Champs **optionnels** ajoutés à `leads` :

| Champ | Sens | Défaut d'absence |
|---|---|---|
| `threadId` | Thread agent, string | Pas de chat |
| `controller` | `"ai"` \| `"staff"` | `"ai"` |
| `visitorLastSeenAt` | Heartbeat visiteur | Hors ligne |
| `source` | `"contact"` \| `"chat"` | Inconnu (fiches déjà là) |

`source` s'écrit **une fois**, à la création. Un chat sur une fiche née
du formulaire ne change pas `source`. Un `chat.start` sur e-mail inconnu
crée la fiche (`status: "new"`, `source: "chat"`, `name` = saisie ou
partie locale de l'e-mail) et déclenche la cloche / l'e-mail
`leadNotification`. Un e-mail déjà connu **réutilise** la fiche : on ne
remet pas un `won` / `lost` / `qualified` à `new` ; on pose `threadId` s'il
manque, on touche `lastMessageAt`.

`leadEvents.type` gagne les littéraux optionnels `"chat_started"` et
`"handover"` (union élargie = expand). Pas de copie du texte des messages
agent dans `leadEvents`.

**`leads.timeline` doit gagner deux `kind`.** Aujourd'hui le `else` traite
tout ce qui n'est pas `message` / `status` comme `created` — un
`handover` s'afficherait « fiche créée ». Étendre `LeadTimelineEntry` +
`RANG` + la boucle. Sans ça le schéma expand est une régression UI.

### 6.3 Présence staff (`chatPresence`) — **phase 2 seulement pour l'API**

La table et `leads.visitorLastSeenAt` se **créent en phase 1** (expand).
Aucune route, aucune mutation, aucun poll de présence avant la phase 2.
La bulle phase 1 n'envoie pas de heartbeat.

```
chatPresence
  threadId: string
  actorId: string           // Better Auth user id
  lastSeenAt: number
  index by_thread
```

En ligne = `now - lastSeenAt < 45_000`. Heartbeat staff toutes les 15 s
depuis le panneau ouvert (mutation authentifiée). Heartbeat visiteur :
`POST /api/chat/presence` → `leads.visitorLastSeenAt`. Un staff voit
« visiteur en ligne » ; le visiteur voit « un conseiller est là » (booléen,
pas le nom — le site public ne divulgue pas l'identité du compte).

### 6.4 Réglages agent (expand `settings`)

| Champ | Projection | Borne |
|---|---|---|
| `agentEnabled` | `get` **et** `getPrivate` | booléen, défaut = éteint |
| `agentDisplayName` | `getPrivate` seulement | 80 |
| `agentInstructions` | `getPrivate` seulement | 4 000 |
| `agentKnowledge` | `getPrivate` seulement | 20 000 |

`settings.update` existant s'élargit, ou mutation dédiée
`settings.updateAgent` (owner/admin). Un editor **lit**, il n'écrit pas
(même règle que les modèles OpenRouter).

`agentEnabled === true` allume la bulle. Sans clé OpenRouter, `chat.send`
refuse `AGENT_UNCONFIGURED` : la bulle affiche « L'assistant est
indisponible. » — pas une stack, pas un 500 nu.

La clé OpenRouter **reste** sur `/settings/ia`. `/settings/agent` porte
l'identité, la base, l'interrupteur, puis (phases 3–4) Calendar et MCP.

### 6.5 Savoir, phase 1

Instructions système, dans cet ordre, toujours reconstruites à l'action
(rien de figé qui mentionnerait un nom de client) :

1. Identité : `agentDisplayName`, `siteName`, `agentInstructions`.
2. Base rédigée : `agentKnowledge` (tronquée à la borne, déjà validée à
   l'écriture).
3. Consignes dures du template : ne pas inventer ; ne pas citer de
   brouillon ; ne pas promettre un créneau sans outil calendrier ; si
   l'outil page échoue, le dire ; qualifier (besoin, délai, téléphone)
   sans interroger en rafale ; langue = celle du visiteur, défaut
   français.
4. Outil `listPublishedPages` : slugs + titres des pages `published`.
5. Outil `readPublishedPage` : `getPublishedPage` puis GET
   `${WEB_SITE_URL}/{slug}` (ou `/` si slug d'accueil), extraction texte,
   plafond 8 000 caractères. 404 ou non-published → « page introuvable ».

`WEB_SITE_URL` est déjà une variable Convex. L'action ne lit pas
`settings.get` pour un secret.

### 6.6 Handover (phase 2)

`controller` sur la fiche, pas sur le composant.

- `chat.takeOver` (staff) : `controller = "staff"`, événement `handover`
  (`from: "ai", to: "staff"`).
- `chat.releaseToAi` : inverse.
- `chat.send` visiteur : `saveMessage` **autonome** (user) **dans les deux
  cas**. Puis, **seulement** si `controller === "ai"`,
  `scheduler.runAfter(0, internal.chatStream.stream, { threadId, promptMessageId })`.
  Si staff : stop. Le visiteur voit son message ; la réponse humaine
  arrivera via `saveMessage`.
- Réponse staff : `saveMessage(ctx, components.agent, { threadId, order: "next", agentName, message: { role: "assistant", content } })`
  — doc agent `human-agents.mdx` (« Save a human message as an agent »).
  `order: "next"` est **réel** dans `/get-convex/agent` ; absent des pages
  docs.convex.dev plus vieilles — le garder.
- Un `streamText` déjà lancé n'est pas préempté au milieu du token. Le
  prochain tour visiteur, si takeover entre-temps, ne relance pas l'IA.
  Suffisant en V1. `abortStream` existe (`threadId` + `order`) — on ne
  l'appelle pas en phase 1–2.

### 6.7 Google Calendar (phase 3)

Connecteur, pas un MCP. Tokens (access + refresh) chiffrés dans `secrets`
sous des noms **fermés** ajoutés à `SECRET_NOMS` :
`GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`. Le
client id (public OAuth) vit dans `settings` privé,
`googleCalendarClientId`.

Flux : le staff colle client id + secret (écran agent) → « Connecter
Google Agenda » → redirection OAuth depuis **l'origine admin**
(`SITE_URL`, déjà `trustedOrigins`) → callback TanStack Start
`/api/connectors/google/callback` → mutation Convex qui chiffre le
refresh token. Le visiteur ne voit jamais cette origine.

Scopes : `https://www.googleapis.com/auth/calendar.freebusy` et
`https://www.googleapis.com/auth/calendar.events`. Un seul agenda
(`primary`, ou `googleCalendarId` privé).

Outils `createTool` :

- `calendarFreeBusy` : fenêtre bornée (14 jours max).
- `calendarCreateEvent` : titre, début, fin, e-mail du **lead de ce
  thread** comme invité — jamais un e-mail inventé par le modèle. Si le
  lead n'a pas d'e-mail (impossible après la gate) : refuse.

Sans refresh token : les outils rendent « calendrier non connecté » ;
l'agent propose de laisser un créneau souhaité en texte.

### 6.8 Serveurs MCP (phase 4)

```
mcpServers
  name: string
  transport: "http" | "sse"
  url: string
  enabled: boolean
  createdBy: string
  index by_enabled
```

En-tête `Authorization` (ou autre) : table `secrets`, nom
`MCP_SERVER_{id}_HEADERS` (JSON d'en-têtes, chiffré). `SECRET_NOMS` est
aujourd'hui une liste close : on l'ouvre à un préfixe contrôlé **ou** on
range ces jetons dans une table `mcpSecrets` chiffrée avec la même
`chiffrer` / `lireCleMaitresse`, **hors** `settings`. La liste close
actuelle (`OPENROUTER_API_KEY`, …) ne doit pas devenir un `v.string()`
libre depuis le client.

À chaque `streamText` : pour chaque serveur `enabled`, `createMCPClient`,
`tools()`, fusion (le dernier gagne en cas de collision de nom — doc
officielle ; on préfixe `{name}__` pour l'éviter). `close()` dans un
`try/finally` autour de `agent.streamText` — **pas** `onEnd` / `onError`
de l'AI SDK : l'Agent ne documente pas qu'il les retransmet. Échec de
connexion d'**un** serveur : on log, on continue avec les autres + les
outils maison. Un serveur qui fait échouer tout le tour est un défaut.

Transport **préféré** : `type: "http"` (Streamable HTTP, tour court).
`type: "sse"` est autorisé par le validateur mais risqué dans une action
Convex (connexion longue, timeout). L'UI le dit. stdio : refusé à
l'écriture.

Allowlist d'hôtes : URL `https:` seulement. Pas `http://` hors localhost
de dev. Pas `file:`. Pas stdio.

### 6.9 RAG (phase 5)

Namespace unique `"site"` (un déploiement = un site). Filtres
`source: "knowledge" | "page"`. Réindex : action staff « Réindexer »
qui `rag.list` (paginé, `namespaceId` du namespace `"site"`) puis
`rag.delete(ctx, { entryId })` pour chaque entrée, puis `rag.add` de
`agentKnowledge` + texte des pages dont `getPublishedPage` réussit et
dont le GET `WEB_SITE_URL` répond 200. **Il n'existe pas** de
`rag.delete({ namespace })`. Outil `searchKnowledge` =
`rag.search`. La lecture page entière (phase 1) **reste** : le RAG
complète, il ne retire pas la citation d'une page précise.

Embeddings : modèle et dimension **lus dans la doc du provider au moment
de la phase 5**, pas inventés ici. Si OpenRouter n'offre pas l'embedding
retenu, on pose un secret d'embedding dédié sur le même schéma
`lireSecret` — on n'écrit pas de clé en dur.

## 7. Flux de données

### 7.1 Ouverture

1. Widget visible ssi `settings.get().agentEnabled === true`.
2. Gate : e-mail (même `looksLikeEmail` / bornes que le formulaire), nom
   optionnel, honeypot `site_web`.
3. `POST /api/chat/start` : secret présent sinon redirect/JSON
   `indisponible` ; honeypot → succès faux ; empreinte origine ; mutation
   `chat.start`.
4. `chat.start` : secret, rate limit (mêmes plafonds que le contact pour
   **cette** mutation de création — `LEAD_ORIGIN_LIMIT_*` /
   `LEAD_EMAIL_LIMIT_*` — c'est une création de fiche, pas un tour de
   conversation), get-or-create `by_email`. **Contrairement à
   `leads.submit`**, un e-mail déjà là **ne** repasse **pas** en `new`
   et **n'écrit pas** de `leadMessages`. Création : `status: "new"`,
   `source: "chat"`, `name` = trim ou partie locale de l'e-mail (pas
   d'`EMPTY` si le nom manque), `messageCount: 0`, `lastMessageAt: now`.
   `createThread` si `threadId` absent, insert `chatSessions`, signe le
   jeton, événement `chat_started` si premier thread.
5. Si la fiche est **créée** (pas réutilisée) : même trio que `submit` —
   `ecrireCloches` (`cle: "leadNotification"`, titre « Nouveau chat sur
   le site »), `internal.leads.notifyStaff`, `internal.leads.deliverWebhook`
   — avec `body: "Session de chat ouverte."`, sans ligne `leadMessages`.
   Un n8n qui n'écoute que `submit` raterait sinon tous les chats.
6. Réponse JSON `{ token, leadId, threadId, expiresAt }`. L'îlot ne
   persiste que `token` dans `sessionStorage`.

### 7.2 Message visiteur

1. `POST /api/chat/message` : jeton + corps (max `MAX_LEAD_BODY_LENGTH`).
2. Astro vérifie le HMAC, envoie `chat.send` avec secret + jeton + corps
   + empreinte.
3. Rate limit **conversation** : 20 messages / h / origine, 30 / h /
   e-mail (`lib/chatRateLimit.ts`). Distinct du contact.
4. `chat.send` vérifie secret + HMAC + ligne `chatSessions`, rate limit
   conversation, `saveMessage(ctx, components.agent, { threadId, prompt: body })`
   → `{ messageId }`, `lastMessageAt`, et si
   `(lead.controller ?? "ai") === "ai"` :
   `ctx.scheduler.runAfter(0, internal.chatStream.stream, { threadId, promptMessageId: messageId })`.
5. `chatStream.stream` (internalAction) : `lireSecret("OPENROUTER_API_KEY")`,
   construit l'agent, charge les outils du palier,
   `agent.streamText(ctx, { threadId }, { promptMessageId }, { saveStreamDeltas: true })`.
   **Interdit** de repasser `prompt: body` (second message user).
6. L'îlot poll `GET /api/chat/messages` jusqu'à ce qu'aucun flux
   `streams` ne soit ouvert.

### 7.3 Staff

`chatStaff.listStaffMessages` : `requireRole(["owner","admin","editor"])`,
vérifie que `threadId` appartient à **une** fiche, puis

```ts
const paginated = await listUIMessages(ctx, components.agent, args)
const streams = await syncStreams(ctx, components.agent, args)
return { ...paginated, streams }
```

`listVisitorMessages` a **la même forme de deltas** (`streamArgs` +
`syncStreams`). L'argument HMAC s'appelle **`token`** — même discriminant
que `pages.previewPage` : `pages.publicQueryFamily.test.ts` classe alors
la query dans la famille preview et **n'exige pas** une branche
`secret+token+paginationOpts` dans la boucle publique. Un test dédié
dans `chat.test.ts` couvre le refus sans jeton. Ne pas la mettre dans
`KNOWN_UNGATED_PUBLIC_QUERIES`.

Hook admin :

```ts
const { results, status, loadMore } = useUIMessages(
  api.chatStaff.listStaffMessages,
  { threadId },
  { initialNumItems: 32, stream: true },
)
```

`SmoothText` / `useSmoothText` sur les messages `status === "streaming"`.

`api.leads.get` **n'existe pas**. Les tests lisent la fiche par
`t.run(ctx => ctx.db.get(leadId))` ou `leads.board`.

## 8. Erreurs

| Code | Où | Comportement visiteur | Comportement staff |
|---|---|---|---|
| `AGENT_DISABLED` | start/send si `!agentEnabled` | Bulle cachée ; si course, « L'assistant est désactivé. » | — |
| `AGENT_UNCONFIGURED` | stream sans clé OpenRouter | « L'assistant est indisponible. » | Bannière sur `/settings/agent` + `/settings/ia` |
| `INVALID_EMAIL` / `EMPTY` / `TOO_LONG` / `FIELD_TOO_LONG` | start/send | Message de champ, pas de 500 | Idem bornes côté admin |
| `RATE_LIMITED` | start/send | « Trop de messages, réessayez dans un moment. » | — |
| `INVALID_SESSION` | jeton absent, expiré, mal signé | Retour gate, sessionStorage vidé | — |
| `OPENROUTER_REFUSED` / `UNAVAILABLE` | stream | « L'assistant est momentanément injoignable. » | Même phrase + lien réglages |
| `CALENDAR_DISCONNECTED` | outils phase 3 | L'agent le dit dans le fil | CTA « Connecter » |
| `MCP_UNREACHABLE` | un serveur phase 4 | Tour continue sans ces outils | Pastille « injoignable » sur la ligne serveur |
| Secret `LEAD_SUBMIT_SECRET` / `CHAT_SESSION_SECRET` absent | Astro ou Convex | `indisponible` | — |

Aucune stack OpenRouter, aucune URL Convex, aucun fragment de jeton dans
une réponse publique. `settings.get` ne gagne **que** `agentEnabled`.

Honeypot : même contrat que le contact — succès faux, pas d'écriture.

## 9. Tests

Préambule d'environnement sur **chaque** nouveau fichier de test
(`BETTER_AUTH_SECRET`, `SITE_URL`, `PREVIEW_SECRET`, plus
`LEAD_SUBMIT_SECRET` et `CHAT_SESSION_SECRET`). Skill `convex-function`.

`makeTestConvex` (`packages/backend/testing/betterAuthFixture.ts`)
enregistre déjà `betterAuth`, Resend et le rate limiter. Il **doit**
enregistrer `@convex-dev/agent/test` (même motif `*.register(t)`) avant
tout test qui appelle `createThread` / `saveMessage`. Un second
`convexTest` local dans `chat.test.ts` est interdit.

| Invariant | Test |
|---|---|
| Pas de start sans e-mail valide | `chat.start` refuse |
| E-mail connu → une fiche | `by_email`, pas de seconde carte |
| E-mail nouveau → `new` + cloche | `status === "new"`, notification créée |
| `won` existant + chat → reste `won` | pas de reset |
| Secret faux / vide → refuse | comme `leads.submit` |
| Jeton expiré / segment tampered / hash inconnu | `verify` rend `null` ; la mutation lève `INVALID_SESSION` |
| `controller=staff` → `stream` non planifié | spy scheduler |
| `listStaffMessages` sans session | refuse |
| `listVisitorMessages` sans secret ni jeton | refuse |
| `listVisitorMessages` a un champ `token` | classée preview-family — **pas** de branche à inventer dans la boucle publique |
| `leads.timeline` | `chat_started` et `handover` ont leur `kind`, jamais repliés sur `created` |
| Projection `settings.get` | `AUTORISES` gagne `agentEnabled` **seulement** |
| `agentKnowledge` trop long | `FIELD_TOO_LONG` aux deux bornes |
| `readPublishedPage` sur slug brouillon | null / « introuvable », **zéro** GET preview |
| `deleteLeadCascade` | plus de `chatSessions`, plus de `chatPresence`, thread agent supprimé via l'API du composant |
| Retention 1095 j | les sessions partent **avec** la fiche (cascade), pas une durée fantôme |
| Registre | `_dataRegistry` + `legal.test.ts` : nouvelles tables classées ; nouvelle finalité publiée |
| `consentVersion` | inchangé en phase 1 ; test de non-régression `1.0.0` jusqu'à un cookie |
| Matrice | chaque mutation publique dans `MUTATION_REGISTRY` + barrel `registryModules.ts` |
| MCP stdio | un test de politique refuse `transport: "stdio"` à l'écriture |
| Collision noms MCP | préfixe, les deux outils restent adressables |

Commandes :

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
pnpm --filter @astrotan/backend test
pnpm --filter @astrotan/web test
pnpm --filter @astrotan/admin test
```

Après tout changement sous `convex/` : un humain lance
`npx convex dev --once` (un agent ne le lance pas). `tsc` et vitest ne
voient pas ce que le bundler Convex refuse.

## 10. RGPD

### 10.1 Traitement nouveau — à publier

Une ligne dans `processings` (`apps/web/src/config/legal.ts`), purpose
exact aussi dans `TABLE_COVERAGE` :

- **Finalité** : « Répondre, dans le chat du site, aux questions d'un
  visiteur et qualifier sa demande ».
- **Données** : adresse électronique, nom le cas échéant, contenu des
  messages, horodatages, identifiant de fil, empreinte d'origine (même
  définition que le formulaire : condensé adresse+secret, jamais
  l'adresse), user-agent si transmis.
- **Base** : mesures précontractuelles / intérêt légitime — la personne
  a saisi son e-mail pour être recontactée. Ce n'est pas un consentement
  cookie.
- **Destinataires** : Convex, Inc. (hébergement) ; **OpenRouter, Inc.**
  (inférence — les messages lui sont envoyés) ; en phase 3, Google
  (Agenda) si le connecteur est lié ; en phase 4, chaque serveur MCP que
  l'adoptant a lui-même branché (le registre le dit : « les services
  d'assistance que le responsable a connectés »).
- **Durée** : la même que les leads — **1095 jours** après
  `lastMessageAt`, purge `retention.purge` via `deleteLeadCascade`. Une
  suppression admin efface tout de suite, thread compris.

Les tables `chatSessions` et `chatPresence` se déclarent sur **cette**
finalité (ce sont des mécaniques du même échange). Les tables internes
du composant agent portent le transcript : elles n'apparaissent pas dans
`appSchema.tables`, donc `_dataRegistry.test.ts` ne les voit pas. Le
commentaire de `TABLE_COVERAGE` + la ligne de traitement ci-dessus
couvrent ce trou **par écrit** : supprimer la fiche **doit** appeler
l'API de suppression de thread du composant, et un test de cascade le
prouve.

`leadEvents` : les nouveaux types restent sur la finalité déjà publiée
« Suivre, dans l'administration, le traitement d'une demande ».

### 10.2 Consentement cookies — phase 1

Pas de cookie. Pas de balise tierce nouvelle. `consentVersion` **reste
`1.0.0`**. `sessionStorage` tient le jeton le temps de l'onglet : c'est
strictement nécessaire au service que la personne vient de demander, ce
n'est pas un traceur, ça ne survit pas à l'onglet, ça ne circule pas
vers un domaine tiers.

Le jour où l'on voudra **reprendre** le fil après fermeture (cookie
httpOnly ou `localStorage`), on incrémente `consentVersion`, on déclare
le cookie dans `DEPOSITS` / `cookies.astro`, et on relit `consent-rgpd`.
Ce n'est pas la phase 1.

OpenRouter n'est pas un script dans la page. C'est un destinataire
serveur. Le bandeau ne s'en mêle pas ; le registre oui.

### 10.3 Phase 3–4 — destinataires variables

Google Calendar et un serveur MCP n'existent que si l'adoptant les
branche. Le texte du registre doit rester **vrai** sur un déploiement
qui n'a rien branché : la phrase « le cas échéant » / « si vous les avez
connectés depuis l'administration » est obligatoire. Une phrase qui
affirmerait « nous transmettons à Google » sur un site sans OAuth serait
une déclaration fausse.

## 11. Invariants — à ne pas casser

1. `apps/web` : pas de session, pas de clé admin, pas de
   `ConvexReactClient`. Toute écriture visiteur passe par une route
   Astro qui détient `LEAD_SUBMIT_SECRET`.
2. Toute query publique de lecture de fil vérifie le HMAC. Une query
   staff vérifie le rôle **et** l'appartenance `threadId` → lead.
3. `settings.get` ne rend ni savoir, ni instructions, ni URL MCP, ni
   état OAuth détaillé au-delà d'un booléen non secret
   (`agentEnabled`). Test de projection.
4. Aucun secret dans `settings`. OAuth et en-têtes MCP : chiffrement
   d'enveloppe, `SECRETS_KEY`.
5. Pages : l'outil ne lit que `published`, jamais `previewPage`.
6. Expand-only. Composant agent : tables isolées, pas de `v.id("leads")`
   dans le composant.
7. Une fiche supprimée emporte messages formulaire, événements,
   notifications, sessions, présence, **et** le thread agent.
8. `MUTATION_REGISTRY` + barrel pour toute mutation publique nouvelle.
9. Pas de balise tierce dans le HTML de la bulle. Pas d'appel navigateur
   vers `openrouter.ai`.
10. Le template câble `CHAT_SESSION_SECRET` dans bootstrap /
    check-env-wiring / `.env.example` / compose `web`. Une ligne de
    README n'est pas un câblage.
11. Premier compte / OpenRouter : si la clé manque, refus propre, pas
    une checklist « pensez à exporter ».
12. Aucun nom d'organisation d'exemple (marque d'un client) dans les
    instructions par défaut, les fixtures, ou les extraits de plan.

## 12. Câblage template (pas une checklist humaine)

| Mécanisme | Quoi |
|---|---|
| `scripts/bootstrap.mjs` | `GENERATED` + `convex env set` + inject `LOCAL_TARGETS` web (comme `PREVIEW_SECRET`) + ligne `.env.vps` |
| `scripts/check-env-wiring.mjs` | Lecture Convex ↔ `.env.example` backend ; lecture `apps/web` ↔ `environment:` compose (`:?`) |
| `docker/.env.example` + `docker-compose.yml` | Variable documentée **et** exigée sur le service `web` |
| Build | Rien à figer au build (pas de `PUBLIC_*` nouveau) |
| Runtime conteneur `web` | `CHAT_SESSION_SECRET` + `LEAD_SUBMIT_SECRET` |
| Écran `/settings/agent` | Identité, base, interrupteur ; phases 3–4 : OAuth et MCP |
| Écran `/settings/ia` | Clé OpenRouter (déjà là). Sans elle l'agent refuse `AGENT_UNCONFIGURED` |

`pnpm bootstrap` déjà rejouable. On n'ajoute pas d'étape « après le
premier deploy, lance X » hors celles qui existent déjà (`seed`,
invitation). Pas de `npx @convex-dev/agent-playground` dans le runbook
adoptant.

## 13. Schéma — expand only, inventaire

**`leads`** : `threadId?`, `controller?`, `visitorLastSeenAt?`, `source?`.

**`leadEvents.type`** : union + `"chat_started"` | `"handover"`.
`LeadTimelineEntry` + `leads.timeline` + `RANG` dans le même commit.

**`settings`** : `agentEnabled?`, `agentDisplayName?`, `agentInstructions?`,
`agentKnowledge?`, plus en phase 3 `googleCalendarClientId?`,
`googleCalendarId?`.

**Tables nouvelles** : `chatSessions`, `chatPresence`, (phase 4)
`mcpServers`.

**`SECRET_NOMS` / magasin chiffré** : phase 3 client secret + refresh
Google ; phase 4 en-têtes MCP.

**Composant** : tables agent (et rag en phase 5) — hors schéma app.

**`_dataRegistry`** : classer `chatSessions`, `chatPresence`, `mcpServers`
(mcpServers : `createdBy` désigne un admin → finalité « Savoir qui a
publié, modifié ou téléversé quoi » ; les deux autres → finalité chat).

## 14. UI

- Site : bulle coin inférieur droit (au-dessus du bandeau consentement
  s'il est `bottom-left` — `z-index` sous le bandeau, jamais par-dessus
  un `<dialog>` de cookies). Textes FR. Gate puis fil. État vide :
  « Écrivez-nous, une personne ou l'assistant vous répond. »
- Admin `/leads` : sur une fiche avec `threadId`, onglet ou colonne
  « Conversation ». Pastille présence. Boutons « Prendre la main » /
  « Rendre à l'assistant ». Textarea staff.
- `/settings/agent` : nouvelle entrée `SETTINGS_PAGES`, après IA.
  Pas de modèle OpenRouter ici.

Pas de maquette pixel-perfect dans cette spec : le skill
`frontend-design` / `design.md` s'applique à l'implémentation.

## 15. Hors scope (fermé, pas reporté en silence)

- Compte visiteur, mot de passe, magic link.
- Pièces jointes, voix, SMS.
- Plusieurs agents, A/B de prompts.
- CopilotKit, Mastra, VoltAgent, LangGraph.
- Playground Convex livré (`definePlaygroundAPI`, `npx @convex-dev/agent-playground`).
- MCP stdio ; SSE persistante comme transport par défaut.
- `defineAgent` (n'existe pas). `deleteThread` nu (n'existe pas).
- AI SDK 5 ou 6 comme runtime de l'agent.
- Lire les brouillons de pages.
- Cookie de reprise de fil (phase ultérieure + `consentVersion`).
- TanStack Query (interdit repo).
- Appeler OpenRouter depuis `apps/web`.
- Bearer `*.convex.site` pour le visiteur.
- Contenu de page en base.

## 16. Self-review

- Pas de TBD : ce qui n'est pas en phase 1 a un numéro de phase et une
  API.
- Pas de contradiction : un agent, une fiche, une porte, un destinataire
  d'inférence, un interrupteur public.
- Pas de marque client en dur dans les extraits, fixtures, ou
  instructions par défaut.
- `consentVersion` : inchangé tant qu'il n'y a pas cookie / balise.
- Secrets : trois lieux, jamais `settings.get`.
- Rollback : expand-only, donc un sha antérieur ignore les champs
  nouveaux.
- Packages : versions **non inventées** — Task 0 lit les
  `peerDependencies` de `@convex-dev/agent@^0.7`. Attendus documentés le
  1er septembre 2026 : `ai@^7`, `@ai-sdk/provider@^4`, `zod` selon le
  peer (souvent `zod/v3` dans les extraits agent). OpenRouter provider
  **v3** pour AI SDK 7. **Pas** `ai@^6`. `@ai-sdk/mcp` uniquement en
  phase 4.
- Jeton de session : auto-contenu, verify → payload ou `null`.
- `saveMessage` autonome dans la mutation ; `promptMessageId` dans
  l'action.
- Suppression de thread : `deleteThreadAsync` / `deleteThreadsByUserId`,
  pas `deleteThread`.
- Fichiers Convex du chat < 200 lignes : `chat.ts` / `chatStream.ts` /
  `chatStaff.ts`.
