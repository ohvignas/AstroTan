# Rangée de connecteurs (Agenda + MCP SSE) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les cartes-formulaires Calendar et MCP de `/settings/agent` par une rangée de connecteurs : un bouton Google Agenda (logo officiel + « Connecter son agenda ») qui lance l’OAuth natif déjà en place, et un bouton « + Ajouter un connecteur » qui ouvre un dialog SSE. **Puis** fusionner `/settings/ia` dans cette même page sous le nom **Agent IA & Modèle IA** (`/settings/ia` redirige, une entrée de menu).

**Architecture:** Le backend Phase 3 (OAuth Google, `calendarFreeBusy` / `calendarCreateEvent`, secrets chiffrés) et Phase 4 (`mcpServers` / `mcpSecrets`, `@ai-sdk/mcp`) restent. On ajoute seulement les trous UX : `googleStatus`, déconnexion, e-mail du compte lié, `authorizeUrl` optionnel, outils calendrier injectés seulement si un refresh token existe, callback qui ferme un popup. L’admin jette `AgentCalendarCard` / `AgentMcpCard` au profit d’une rangée + deux dialogs shadcn. Les mutations / queries d’IA (`settings.update` pour les modèles, `secrets.set` + `secretCheck` pour OpenRouter) restent : seul le route et le layout changent. Quatre `SettingsGroup` sur `/settings/agent` : Identité, Modèle IA, Applications, Base de savoir. La bulle d’aperçu (`AgentPreviewBubble` / `ChatWidget`) reste.

**Tech Stack:** Convex (expand-only), TanStack Start, shadcn/ui + `SettingsGroup` existants, `convex/react` (pas TanStack Query), OAuth Google Calendar API v3, `@ai-sdk/mcp` transport `sse`. Skills `@.claude/skills/convex-function`, `@.claude/skills/ui-ux-pro-max`, `@.agents/skills/frontend-design`, `@superpowers/test-driven-development`.

---

## Contraintes (lire avant tout)

- **Arbre de travail sale.** Ne pas revert, stash, ni « nettoyer » RAG, ChatWidget, shimmer, extract PDF, e-mail-après-premier-message, ni aucun autre fichier hors de la liste ci-dessous.
- **Ne pas jeter le backend qui marche.** Réutiliser `connectors.ts`, `calendarTools.ts`, `mcpServers.ts`, `loadMcpTools.ts`, `/api/connectors/google/callback`.
- **`settings.get` est public.** Aucun jeton, aucune URL MCP, aucun e-mail de compte Google dans cette projection.
- Schéma **expand-only**. stdio MCP déjà refusé. HTTP reste accepté en base (lignes existantes) ; le **nouveau** dialog ne crée que du `sse`.
- Fichiers < 200 lignes. TDD Convex. Helpers de test hors `convex/` sauf `*.test.ts`.
- Ne pas lancer `npx convex dev` interactif.
- **Commits :** les étapes ci-dessous les prévoient (skill writing-plans, Conventional Commits en anglais). **Ne pas committer tant qu’Antoine n’a pas dit.**
- UI en français, sentence-case. Code en anglais.

---

## Recherche — OAuth natif gagne

| Option | Transport | Auth | Verdict |
|---|---|---|---|
| **OAuth natif déjà dans le dépôt** (Calendar API v3, Phase 3) | HTTPS REST | Client OAuth de l’installateur, refresh chiffré | **Retenu.** Un clic, popup/redirect, outils déjà câblés et bornés (free/busy 14 j + créer un event avec l’e-mail du lead). |
| MCP officiel Google `https://calendarmcp.googleapis.com/mcp/v1` ([doc](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server), Developer Preview, màj 2026-08-31) | **HTTP** (pas SSE) | OAuth 2.0 du *host* MCP (Antigravity / Claude), `authProvider`, activer `calendarmcp.googleapis.com` | **Refusé pour le bouton Agenda.** Mauvais transport pour le brief SSE, OAuth MCP pas un bearer collé, expose `delete_event` / `update_event` à l’agent visiteur, timeout Convex. Documenté comme optionnel via « Ajouter un connecteur » seulement si l’adoptant a déjà un host qui parle OAuth MCP — **pas** le chemin du premier bouton. |
| `@cocal/google-calendar-mcp` | **stdio** (`npx`) ; HTTP possible s’il l’héberge lui-même | Fichier credentials GCP | **Inutilisable tel quel.** Convex ne spawn pas. |
| `am2rican5/mcp-google-calendar --sse` | SSE si process local | credentials.json | Même blocage : process à héberger. |
| Composio / Zapier MCP / hosts SSE tiers | SSE ou HTTP | Compte + OAuth chez le tiers | Optionnel via le dialog « Ajouter un connecteur », jamais à la place du bouton Agenda. |

**Pourquoi OAuth natif :** le brief demande « connecter son compte Google », pas « coller une URL MCP ». Le câblage existe (`googleAuthUrl` → `{SITE_URL}/api/connectors/google/callback` → `exchangeGoogleCode` → `GOOGLE_CALENDAR_REFRESH_TOKEN`). Un MCP Calendar, même officiel, ajoute un vendor, un second OAuth, et des outils trop larges pour un agent public.

`@ai-sdk/mcp` `createMCPClient` : `transport: { type: "sse", url, headers?, authProvider? }`. On continue à passer `headers` (Bearer chiffré). On n’implémente **pas** `authProvider` (OAuth MCP côté Convex) dans ce lot — trop large. Le dialog ouvre l’URL d’autorisation du fournisseur dans une fenêtre, l’humain colle ensuite le bearer s’il en a un.

---

## Décisions de design (ui-ux-pro-max + frontend-design)

Script lancé :

```bash
python3 /Users/antoinevigneau/.claude/skills/ui-ux-pro-max/scripts/search.py \
  "admin dashboard SaaS connectors integrations OAuth MCP" --design-system -p "AstroTan"
```

**Recommandation du script — à jeter :** style « Data-Dense Dashboard », fond `#020617`, accent acide `#22C55E`, Fira Code / Fira Sans. C’est le défaut IA n°2 (noir + vert acide) et ça se bat avec Geist + shadcn de l’admin.

Recherches domaine :

- `ux "oauth connect button dialog"` → surtout « ne pas casser Back ». Donc : popup OAuth si possible, sinon redirect ; le callback revient sur `/settings/agent` (pas `location.replace` destructeur d’historique sauf dans le popup qui se ferme).
- `ux "empty state integrations"` → message + action, pas un blanc. Ici l’état vide **est** le bouton « + Ajouter un connecteur » plus une phrase d’une ligne sous la rangée.
- `style` shadcn → Material You / Bento / layering 3D. **Non.** On reste sur `SettingsGroup` (`rounded-xl bg-card p-4 ring-1 ring-foreground/10`) et le `Dialog` de `InviteDialog` (`users.tsx`).

**Système (pas une seconde identité) :**

| Jeton | Source |
|---|---|
| Fond / carte | `--card`, `--background`, `--foreground` déjà dans l’admin |
| Bordure | `ring-foreground/10`, `border-border` |
| CTA primaire | `Button` `default` (« Connecter son agenda ») — **un seul** par carte |
| Secondaire | `Button` `outline` (« Ajouter un connecteur ») |
| Destructif | `Button` `ghost` ou `destructive` (« Déconnecter ») |
| Type | Geist déjà chargé. Sentence-case. Pas d’ALL-CAPS, pas d’eyebrow `01 / 02` |
| Cibles | `min-h-11` (44px) + `gap-2` (≥ 8px). Labels visibles, jamais icône seule |
| Focus | `focus-visible:ring-3` déjà sur `Button` — ne pas le retirer |
| Motion | 150–200 ms fade/zoom du Dialog existant ; `prefers-reduced-motion` déjà géré par les primitives |

**Signature (un seul risque, frontend-design) :** la marque officielle Google Calendar (icône produit 2020, non redessinée) sur un fond blanc de 28×28, seul objet coloré de la rangée. Pas de bouton « Sign in with Google » arc-en-ciel recopié, pas de gradient, pas de crème + terracotta.

**Marque Google :** vendor l’icône produit Calendar 2020 **inaltérée** (ne pas redessiner le « 31 » ni le G). Source : icône produit Wikimedia / Google Brand Resource, fichier `apps/admin/src/assets/google-calendar.svg`. `alt="Google Agenda"`. Guidelines : icône produit seulement pour indiquer l’action « connecter cet agenda », jamais comme logo d’AstroTan ; fond clair derrière l’icône (pas sur `primary`).

**Copie FR :**

| Contrôle | Texte |
|---|---|
| Bouton déconnecté | Connecter son agenda |
| Bouton connecté | e-mail du compte + Déconnecter |
| Secondaire | Ajouter un connecteur (PlusIcon + texte) |
| Dialog Google, credentials manquants | Titre « Connecter Google Agenda ». Description : « L’agent pourra proposer des créneaux et poser un rendez-vous sur cet agenda. » |
| Dialog Google, prêt | « Une fenêtre Google va s’ouvrir. Autorisez l’accès à l’agenda de ce site. » CTA « Continuer vers Google » |
| Dialog MCP | Titre « Ajouter un connecteur ». Description : « Serveur MCP en SSE. stdio est refusé. » |
| Lien auth MCP | Ouvrir la connexion |
| Vide MCP | « Aucun connecteur pour l’instant. » à côté du + |
| Erreur OAuth | « La connexion Google a été refusée ou interrompue. » près du bouton |
| Spinner | « Ouverture… » / « Ajout… » — bouton disabled |

---

## Wireframes ASCII

### `/settings/agent` — rangée (sous Identité / savoir)

```
┌─ Connecteurs ─────────────────────────────────────────────────────────┐
│ L’agent n’utilise un agenda que si un compte est lié.                 │
│                                                                       │
│  ┌──────────────────────────────┐  ┌─────────────────────────────┐    │
│  │ [📅]  Connecter son agenda   │  │ [+]  Ajouter un connecteur  │    │
│  └──────────────────────────────┘  └─────────────────────────────┘    │
│                                                                       │
│  Aucun connecteur pour l’instant.                                     │
└───────────────────────────────────────────────────────────────────────┘
```

### État connecté

```
│  ┌─────────────────────────────────────────────┐  ┌──────────────────┐ │
│  │ [📅]  marie@cabinet.fr                      │  │ [+] Ajouter…     │ │
│  │      Connecté · Agenda principal            │  │                  │ │
│  │                    [ Déconnecter ]          │  │                  │ │
│  └─────────────────────────────────────────────┘  └──────────────────┘ │
│  ┌──────────────────────────────┐                                      │
│  │ Notion CRM  [SSE]  [o] on    │  [Ouvrir la connexion] [Retirer]     │
│  └──────────────────────────────┘                                      │
```

### Dialog Google (credentials absents)

```
┌─ Connecter Google Agenda ─────────────────────────┐
│ L’agent pourra proposer des créneaux et poser un  │
│ rendez-vous sur cet agenda.                       │
│                                                   │
│ Identifiant client OAuth                          │
│ [________________________________]                │
│ Secret client                                     │
│ [____________________]  (write-only)              │
│ Agenda (laisser vide = principal)                 │
│ [________________________________]                │
│                                                   │
│              [ Annuler ]  [ Continuer vers Google ]│
└───────────────────────────────────────────────────┘
```

### Dialog Google (déjà configuré)

```
┌─ Connecter Google Agenda ─────────────────────────┐
│ Une fenêtre Google va s’ouvrir. Autorisez l’accès │
│ à l’agenda de ce site.                            │
│                                                   │
│              [ Annuler ]  [ Continuer vers Google ]│
└───────────────────────────────────────────────────┘
```

### Dialog MCP SSE

```
┌─ Ajouter un connecteur ───────────────────────────┐
│ Serveur MCP en SSE. stdio est refusé.             │
│                                                   │
│ Nom                                               │
│ [ Support     ]                                   │
│ URL SSE                                           │
│ [ https://mcp.exemple.com/sse ]                   │
│ URL d’autorisation (optionnel)                    │
│ [ https://mcp.exemple.com/connect ]               │
│ [ Ouvrir la connexion ]  ← new window si URL ok   │
│ Jeton Bearer (optionnel, chiffré, jamais relu)    │
│ [____________________]                            │
│                                                   │
│                    [ Annuler ]  [ Ajouter ]       │
└───────────────────────────────────────────────────┘
```

---

## Flux runtime

### Après « Connecter son agenda »

1. Si `googleStatus.ready === false` → dialog credentials → `updateGoogle` + `secrets.set(GOOGLE_CALENDAR_CLIENT_SECRET)` → puis étape 2.
2. `googleAuthUrl` → `window.open` (popup 480×720). Si bloqué : `window.location.assign` (comportement actuel).
3. Google consent → `{SITE_URL}/api/connectors/google/callback?code=`.
4. Callback : `exchangeGoogleCode` (existant) range le refresh ; **nouveau** : lit `access_token` du même JSON, `GET https://www.googleapis.com/calendar/v3/calendars/primary`, pose `googleCalendarEmail` (champ settings privé, pas un secret).
5. Si `window.opener` : `postMessage` same-origin puis `window.close()`. Sinon redirect 303 `/settings/agent?calendar=ok` (existant).
6. La query `googleStatus` se met à jour (Convex) → tuile e-mail + Déconnecter.

### Déconnecter

`connectors.disconnectGoogle` : efface la ligne `GOOGLE_CALENDAR_REFRESH_TOKEN` **en base** et `googleCalendarEmail`. Si le refresh vient de l’env Convex (`source === "environnement"`), le bouton est disabled et une phrase dit que l’opérateur doit retirer la variable — même règle que les autres secrets.

### Agent visiteur et outils calendrier

Aujourd’hui `chatStream.stream` injecte **toujours** `calendarTools` ; les outils rendent `CALENDAR_DISCONNECTED`. Le brief : les outils n’existent **que** si un compte est lié.

```
lireSecret(GOOGLE_CALENDAR_REFRESH_TOKEN) ?
  tools += calendarTools
  instruction : « Ne jamais promettre un créneau sans avoir utilisé l'outil calendrier. »
:
  pas d'outils calendar
  instruction : « L'agenda n'est pas connecté. Proposer de laisser un créneau souhaité en texte, sans promettre une confirmation. »
```

MCP : inchangé — `loadMcpTools` pour chaque serveur `enabled`.

---

## Variables d’environnement (ne pas en inventer)

Il n’y a **pas** de `GOOGLE_CALENDAR_CLIENT_ID` dans ce dépôt. Le client id vit dans `settings.googleCalendarClientId` (privé). Documenter les noms **réels** :

| Nom | Où | Rôle |
|---|---|---|
| `SITE_URL` | env Convex | Origine **admin** (`http://localhost:3001` en local). Redirect OAuth = `{SITE_URL}/api/connectors/google/callback`. |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | env Convex **ou** secret chiffré | Secret OAuth. Précédence : env gagne. |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | écrit par le callback | Ne pas inventer. Vide = normal. |
| `SECRETS_KEY` | env Convex | Chiffre refresh + bearer MCP. |
| Client id | champ settings, saisi dans le dialog si absent | Public OAuth, jamais dans `settings.get`. |

Redirect à déclarer dans la console Google Cloud (application Web) :

```
http://localhost:3001/api/connectors/google/callback
```

et en prod `{admin SITE_URL}/api/connectors/google/callback`.

Aucun `PUBLIC_*` nouveau. `apps/web` n’a toujours ni session ni clé admin.

---

## File Structure

À faire **avant** les tâches. Un fichier = une responsabilité. Tout nouveau fichier < 200 lignes.

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/googleOAuth.ts` *(créer)* | Purs : échanger un `code`, lire l’e-mail `calendars/primary`. Zéro `ctx`. |
| `packages/backend/convex/lib/googleOAuth.test.ts` *(créer)* | Fetch mocké. |
| `packages/backend/convex/connectors.ts` | **Modifier** : `googleStatus`, `disconnectGoogle`, `rangerEmail` (internal) ; `exchangeGoogleCode` pose l’e-mail via le helper. Extraire le fetch hors du fichier si on dépasse 200 lignes. |
| `packages/backend/convex/connectors.test.ts` | **Étendre** : status, disconnect, editor forbidden. |
| `packages/backend/convex/schema.ts` | Expand : `settings.googleCalendarEmail?`, `mcpServers.authorizeUrl?`. |
| `packages/backend/convex/content.ts` | `MAX_GOOGLE_CALENDAR_EMAIL`, `MAX_MCP_AUTHORIZE_URL`. |
| `packages/backend/convex/settings.ts` | **Ne pas** ajouter l’e-mail à `get` ni forcément à `getPrivate` — il sort par `googleStatus`. |
| `packages/backend/convex/settings.publicProjection.test.ts` | Semer `googleCalendarEmail` dans `semerLaLigneEntiere` (le test d’égalité schéma l’exige). **Pas** dans `AUTORISES` ni `AUTORISES_PRIVE`. |
| `packages/backend/convex/mcpServers.ts` | `authorizeUrl?` sur `create` + `list`. |
| `packages/backend/convex/mcpServers.test.ts` | create + list expose l’URL, refuse stdio, refuse http hors localhost. |
| `packages/backend/convex/chatStream.ts` | N’injecter `calendarTools` que si refresh présent. |
| `packages/backend/convex/lib/visitorAgent.ts` | Instruction calendrier conditionnelle. |
| `packages/backend/convex/lib/visitorAgent.test.ts` *(créer)* | Les deux formulations. |
| `apps/admin/src/routes/api/connectors/google/callback.ts` | HTML de fermeture popup si `window.opener`, sinon 303 actuel. |
| `apps/admin/src/lib/oauthPopup.ts` *(créer)* | `openOAuthPopup` + listener `postMessage`. |
| `apps/admin/src/lib/oauthPopup.test.ts` *(créer)* | URL / features / origin check. |
| `apps/admin/src/assets/google-calendar.png` *(créer)* | Icône produit officielle, inaltérée (même import que `icon_astrotan.png`). |
| `apps/admin/src/components/google-calendar-mark.tsx` *(créer)* | `<img>` 20×20, alt, fond blanc. |
| `apps/admin/src/components/agent-connectors-row.tsx` *(créer)* | Rangée : tuile Google + liste MCP + bouton +. |
| `apps/admin/src/components/agent-google-connect-dialog.tsx` *(créer)* | Dialog credentials / confirmation. |
| `apps/admin/src/components/agent-mcp-dialog.tsx` *(créer)* | Dialog SSE + authorize URL + bearer. |
| `apps/admin/src/components/agent-connectors-row.test.ts` *(créer)* | Source-scan : logo, libellés FR, pas `settings.get`, pas stdio. |
| `apps/admin/src/routes/_authed/settings/agent.tsx` | Remplacer les deux cartes par `AgentConnectorsRow`. Chunk 6 : quatre sections, monter `AiPage`. |
| `apps/admin/src/routes/_authed/settings/agent.test.tsx` | Attendre `AgentConnectorsRow`, plus `AgentCalendarCard` / `AgentMcpCard`. Chunk 6 : `AiPage`, plus de `Link` vers `/settings/ia`. |
| `apps/admin/src/components/agent-calendar-card.tsx` | **Supprimer** après bascule. |
| `apps/admin/src/components/agent-calendar-card.test.ts` | **Supprimer**. |
| `apps/admin/src/components/agent-mcp-card.tsx` | **Supprimer**. |
| `apps/admin/src/components/agent-mcp-card.test.ts` | **Supprimer**. |
| `apps/admin/src/components/settings-nav.tsx` | **Chunk 6.** Retirer `/settings/ia` de `SETTINGS_PAGES` et de `SettingsPath`. Une entrée `/settings/agent`, libellé **Agent IA & Modèle IA**. |
| `apps/admin/src/components/settings-nav.test.tsx` | **Chunk 6.** Ordre du menu, libellé, `ia.tsx` = redirect (même motif que `referencement`). |
| `apps/admin/src/routes/_authed/settings/ia.tsx` | **Chunk 6.** `beforeLoad` → `throw redirect({ to: "/settings/agent" })`. Plus de formulaire. |
| `apps/admin/src/routes/_authed/settings/ia.test.tsx` | **Chunk 6.** Source-scan redirect, plus `AiPage` / `SettingsFormShell`. |
| `apps/admin/src/components/settings-environment.tsx` | **Chunk 6.** `AiPage` : un seul `SettingsGroup` « Modèle IA » (clé + modèles). Mutations inchangées. |
| `apps/admin/src/components/settings-environment.test.tsx` | **Chunk 6.** `h2` « Modèle IA », toujours « Clé OpenRouter » + « Vérifier et enregistrer ». |
| `apps/admin/src/lib/pageErrors.ts` | **Chunk 6.** « Réglages → IA » → « Réglages → Agent IA & Modèle IA ». |
| `apps/admin/src/lib/pageErrors.test.ts` | **Chunk 6.** Même phrase. |
| `apps/admin/src/lib/settingsErrors.ts` | **Chunk 6.** `OPENROUTER_NOT_CONFIGURED` pointe vers la section Modèle IA (même page). |
| `apps/admin/src/lib/settingsErrors.test.ts` | **Chunk 6.** |
| `scripts/bootstrap.mjs` | **Chunk 6.** Commentaire `/settings/ia` → `/settings/agent`. |
| `scripts/check-env-wiring.mjs` | **Chunk 6.** Idem. |
| `docker/README.md` | **Chunk 6.** Idem (câblage `SECRETS_KEY`). |
| `AGENTS.md` | **Chunk 6.** Idem. |

Fichiers **lus, pas touchés** sauf besoin avéré : `calendarTools.ts` (outils), `loadMcpTools.ts`, `secrets.ts` (`SECRET_NOMS` déjà bon), `apps/web/**`, RAG, ChatWidget, shimmer, extract PDF.

Patterns à recopier : `InviteDialog` (`apps/admin/src/routes/_authed/users.tsx:502-674`) pour le Dialog ; `connectors.test.ts` et `mcpServers.test.ts` pour le préambule env ; `SecretField` seulement **dans** le dialog Google pour le secret Calendar (Chunks 1–5). Chunk 6 : `SecretField` reste celui d’`AiPage` pour `OPENROUTER_API_KEY` — on le déplace, on n’en crée pas un second. Redirect signet : `referencement.tsx`.

---

## Chunk 1: Backend Google — statut, e-mail, déconnexion, outils conditionnels

### Task 1: Helper d’échange + e-mail (pur)

**Files:**
- Create: `packages/backend/convex/lib/googleOAuth.ts`
- Test: `packages/backend/convex/lib/googleOAuth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, expect, test, vi } from "vitest"
import { exchangeGoogleCode, readPrimaryCalendarEmail } from "./googleOAuth"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("exchangeGoogleCode refuse une réponse sans refresh_token", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ access_token: "a" }), { status: 200 })),
  )
  await expect(
    exchangeGoogleCode({
      code: "x",
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "s",
      redirectUri: "http://localhost:3001/api/connectors/google/callback",
    }),
  ).rejects.toMatchObject({ code: "CALENDAR_DISCONNECTED" })
})

test("readPrimaryCalendarEmail lit id sur calendars/primary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ id: "marie@cabinet.fr" }), { status: 200 }),
    ),
  )
  await expect(readPrimaryCalendarEmail("access")).resolves.toBe("marie@cabinet.fr")
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @astrotan/backend test convex/lib/googleOAuth.test.ts
```

Expected: FAIL — `Cannot find module './googleOAuth'` ou export manquant.

- [ ] **Step 3: Write minimal implementation**

```ts
export class GoogleOAuthError extends Error {
  code = "CALENDAR_DISCONNECTED" as const
}

export async function exchangeGoogleCode(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ refreshToken: string; accessToken: string | null }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
    }),
  })
  if (!response.ok) throw new GoogleOAuthError()
  const json: unknown = await response.json()
  if (typeof json !== "object" || json === null) throw new GoogleOAuthError()
  const refresh =
    "refresh_token" in json && typeof json.refresh_token === "string"
      ? json.refresh_token
      : ""
  if (refresh.length === 0) throw new GoogleOAuthError()
  const access =
    "access_token" in json && typeof json.access_token === "string"
      ? json.access_token
      : null
  return { refreshToken: refresh, accessToken: access }
}

export async function readPrimaryCalendarEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { authorization: `Bearer ${accessToken}` } },
  )
  if (!response.ok) return null
  const json: unknown = await response.json()
  if (typeof json !== "object" || json === null) return null
  const id = "id" in json && typeof json.id === "string" ? json.id.trim() : ""
  return id.length > 0 ? id : null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @astrotan/backend test convex/lib/googleOAuth.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add packages/backend/convex/lib/googleOAuth.ts packages/backend/convex/lib/googleOAuth.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): extract Google OAuth token exchange helper

EOF
)"
```

### Task 2: Schéma expand — e-mail du compte lié

**Files:**
- Modify: `packages/backend/convex/schema.ts` (objet `settings`, après `googleCalendarId`)
- Modify: `packages/backend/convex/content.ts` (après `MAX_GOOGLE_CALENDAR_ID`)
- Modify: `packages/backend/convex/settings.publicProjection.test.ts` (`semerLaLigneEntiere` seulement)

- [ ] **Step 1: Write the failing assertion**

Dans `semerLaLigneEntiere`, ajouter `googleCalendarEmail: "sentinelle-google-email@exemple.fr"`. Le test `Object.keys(ligne).sort()` vs `CHAMPS_DE_LA_TABLE` (vers la ligne 362) **échoue** tant que le champ n’est pas dans le schéma.

Ne **pas** ajouter le champ à `AUTORISES` ni `AUTORISES_PRIVE`.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @astrotan/backend test convex/settings.publicProjection.test.ts
```

Expected: FAIL — clé `googleCalendarEmail` absente du schéma / inégalité des clés.

- [ ] **Step 3: Expand schema + borne**

`content.ts` :

```ts
export const MAX_GOOGLE_CALENDAR_EMAIL = 254
```

`schema.ts` dans `settings` :

```ts
googleCalendarClientId: v.optional(v.string()),
googleCalendarId: v.optional(v.string()),
// Expand : e-mail (ou id) du compte Google lié. Pas un secret.
// Jamais dans settings.get. Lu par connectors.googleStatus.
googleCalendarEmail: v.optional(v.string()),
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/backend test convex/settings.publicProjection.test.ts
```

Expected: PASS. Vérifier que `JSON.stringify` de `settings.get` ne contient pas `sentinelle-google-email`.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/content.ts packages/backend/convex/settings.publicProjection.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): expand settings with googleCalendarEmail

EOF
)"
```

### Task 3: `googleStatus` + `disconnectGoogle` + e-mail à l’échange

**Files:**
- Modify: `packages/backend/convex/connectors.ts`
- Test: `packages/backend/convex/connectors.test.ts`

Si `connectors.ts` dépasse ~180 lignes après l’ajout : déplacer le corps de `exchangeGoogleCode` vers les helpers Task 1 (déjà prévu) et garder ici l’orchestration.

- [ ] **Step 1: Write the failing tests** (ajouter en bas de `connectors.test.ts`)

```ts
test("googleStatus est déconnecté sans refresh", async () => {
  const { identity } = await seedOwner()
  const status = await identity.query(api.connectors.googleStatus, {})
  expect(status).toEqual({
    connected: false,
    ready: false,
    email: null,
    refreshSource: "aucune",
    calendarId: "primary",
  })
})

test("un editor ne déconnecte pas", async () => {
  const t = makeTestConvex()
  const email = `cal-ed-${Date.now()}@example.com`
  const password = "correct horse battery staple calendar"
  const user = await seedUser(t, { email, password, name: "Editor cal", role: "editor" })
  await signIn(t, email, password)
  const editor = await identityFor(t, user.id)
  await expect(editor.mutation(api.connectors.disconnectGoogle, {})).rejects.toThrow()
})

test("disconnectGoogle retire le refresh en base et l'e-mail", async () => {
  const { t, identity } = await seedOwner()
  await identity.action(api.connectors.storeGoogleRefresh, {
    refreshToken: "refresh-a-effacer",
  })
  await t.mutation(internal.connectors.rangerEmail, {
    email: "marie@cabinet.fr",
  })
  await identity.mutation(api.connectors.disconnectGoogle, {})
  const status = await identity.query(api.connectors.googleStatus, {})
  expect(status.connected).toBe(false)
  expect(status.email).toBeNull()
  const etat = await identity.query(api.secrets.status, {})
  const ligne = etat.secrets.find((s) => s.nom === "GOOGLE_CALENDAR_REFRESH_TOKEN")
  expect(ligne?.source).toBe("aucune")
})
```

En tête du fichier de test : `import { api, internal } from "./_generated/api"`.

`googleCalendarEmail` n’est **pas** un argument de `updateGoogle` (évite qu’un client pose un e-mail de fantaisie). `exchangeGoogleCode` écrit l’e-mail via `internal.connectors.rangerEmail`. Le test de déconnexion pose l’e-mail avec `t.run` / `identity.action` après un `rangerEmail` exposé seulement en internal — depuis le test Convex on appelle `t.mutation(internal.connectors.rangerEmail, …)` :

```ts
import { internal } from "./_generated/api"
// dans le test disconnect, après storeGoogleRefresh :
await identity.mutation(internal.connectors.rangerEmail, {
  email: "marie@cabinet.fr",
})
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @astrotan/backend test convex/connectors.test.ts
```

Expected: FAIL — `api.connectors.googleStatus is not a function` (ou équivalent).

- [ ] **Step 3: Implement**

Ne **pas** créer `secrets.statusPourNoms`. Dans `googleStatus`, recopier la précédence de `secrets.status` pour **deux** noms seulement, sans déchiffrer (l’existence de la ligne + `process.env[nom]` suffisent ; env gagne) :

```ts
function sourceDuNom(
  nom: "GOOGLE_CALENDAR_CLIENT_SECRET" | "GOOGLE_CALENDAR_REFRESH_TOKEN",
  rowPresent: boolean,
): "environnement" | "base" | "aucune" {
  if (process.env[nom]) return "environnement"
  if (rowPresent) return "base"
  return "aucune"
}

export const googleStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const settings = await ctx.db.query("settings").first()
    const secretRow = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_CLIENT_SECRET"))
      .unique()
    const refreshRow = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_REFRESH_TOKEN"))
      .unique()
    const refresh = sourceDuNom("GOOGLE_CALENDAR_REFRESH_TOKEN", refreshRow !== null)
    const secret = sourceDuNom("GOOGLE_CALENDAR_CLIENT_SECRET", secretRow !== null)
    const clientId = settings?.googleCalendarClientId?.trim() ?? ""
    return {
      connected: refresh !== "aucune",
      ready: clientId.length > 0 && secret !== "aucune",
      email: settings?.googleCalendarEmail?.trim() || null,
      refreshSource: refresh,
      calendarId: settings?.googleCalendarId?.trim() || "primary",
    }
  },
})
```

`rangerEmail` — `internalMutation`, pas de session, uniquement depuis `exchangeGoogleCode` et les tests :

```ts
export const rangerEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim()
    if (email.length > MAX_GOOGLE_CALENDAR_EMAIL) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field: "googleCalendarEmail",
        max: MAX_GOOGLE_CALENDAR_EMAIL,
      })
    }
    const settings = await ctx.db.query("settings").first()
    const value = email.length === 0 ? undefined : email
    if (settings) {
      await ctx.db.patch(settings._id, { googleCalendarEmail: value })
      return settings._id
    }
    return ctx.db.insert("settings", { siteName: "Mon site", googleCalendarEmail: value })
  },
})
```

Dans le test, appeler `t.mutation(internal.connectors.rangerEmail, { email })` (le `t` de `seedOwner`, à renvoyer : `return { t, identity }`).

`disconnectGoogle` mutation owner/admin :

```ts
export const disconnectGoogle = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_REFRESH_TOKEN"))
      .unique()
    if (row !== null) await ctx.db.delete(row._id)
    const settings = await ctx.db.query("settings").first()
    if (settings) await ctx.db.patch(settings._id, { googleCalendarEmail: undefined })
    return null
  },
})
```

Réécrire `exchangeGoogleCode` : importer `exchangeAuthorizationCode` et `readPrimaryCalendarEmail` depuis `./lib/googleOAuth`. Remplacer le `fetch` inline. Après `storeGoogleRefresh`, si `accessToken` : `const email = await readPrimaryCalendarEmail(accessToken)` puis `ctx.runMutation(internal.connectors.rangerEmail, { email: email ?? "" })`.

Enregistrer `connectors.disconnectGoogle` dans `MUTATION_REGISTRY`.

`googleAuthUrl` : inchangé (toujours `{SITE_URL}/api/connectors/google/callback`).

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/backend test convex/connectors.test.ts
```

Expected: PASS, y compris les anciens (`googleAuthUrl`, editor, store).

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add packages/backend/convex/connectors.ts packages/backend/convex/connectors.test.ts packages/backend/convex/secrets.ts
git commit -m "$(cat <<'EOF'
feat(connectors): expose Google Calendar status and disconnect

EOF
)"
```

### Task 4: Outils calendrier seulement si connecté

**Files:**
- Modify: `packages/backend/convex/chatStream.ts` (~ligne 85)
- Modify: `packages/backend/convex/lib/visitorAgent.ts`
- Create: `packages/backend/convex/lib/visitorAgent.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { expect, test } from "vitest"
import { buildInstructions, type AgentConfig } from "./visitorAgent"

const base: AgentConfig = {
  agentKnowledge: null,
  openRouterModel: null,
  agentEnabled: true,
  siteName: "Cabinet",
  agentDisplayName: "Léa",
  agentInstructions: null,
}

test("sans agenda, l'instruction ne parle pas d'outil calendrier", () => {
  const text = buildInstructions(base, { calendarConnected: false })
  expect(text).toContain("n'est pas connecté")
  expect(text).not.toContain("sans avoir utilisé l'outil calendrier")
})

test("avec agenda, l'instruction exige l'outil", () => {
  const text = buildInstructions(base, { calendarConnected: true })
  expect(text).toContain("sans avoir utilisé l'outil calendrier")
})
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @astrotan/backend test convex/lib/visitorAgent.test.ts
```

Expected: FAIL — 2e argument inconnu / texte absent.

- [ ] **Step 3: Implement**

`buildInstructions(privee, options?: { calendarConnected?: boolean })` :

```ts
const calendarRule =
  options?.calendarConnected === true
    ? "Ne jamais promettre un créneau sans avoir utilisé l'outil calendrier."
    : "L'agenda n'est pas connecté. Proposer de laisser un créneau souhaité en texte, sans promettre une confirmation."
```

`makeVisitorAgent` : passer `{ calendarConnected: "calendarFreeBusy" in tools }`.

`chatStream.stream` :

```ts
const refresh = await lireSecret(ctx, "GOOGLE_CALENDAR_REFRESH_TOKEN")
const tools = {
  ...visitorPageTools,
  ...(refresh ? calendarTools : {}),
  ...knowledgeTools,
  ...mcpTools,
}
```

Importer `lireSecret` depuis `./secrets`.

- [ ] **Step 4: Run pass**

```bash
pnpm --filter @astrotan/backend test convex/lib/visitorAgent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add packages/backend/convex/chatStream.ts packages/backend/convex/lib/visitorAgent.ts packages/backend/convex/lib/visitorAgent.test.ts
git commit -m "$(cat <<'EOF'
fix(agent): attach calendar tools only when Google is connected

EOF
)"
```

**Self-review Chunk 1 :** pas de TODO, snippets complets, TDD, expand-only, `settings.get` intact, outils conditionnels alignés spec §6.7. `googleStatus` ne déchiffre rien. Fichiers découpés (`googleOAuth.ts`). OK.

---

## Chunk 2: Backend MCP — `authorizeUrl` expand, dialog SSE

### Task 5: Champ `authorizeUrl`

**Files:**
- Modify: `packages/backend/convex/schema.ts` (`mcpServers`)
- Modify: `packages/backend/convex/content.ts`
- Modify: `packages/backend/convex/mcpServers.ts`
- Test: `packages/backend/convex/mcpServers.test.ts`

- [ ] **Step 1: Failing test**

```ts
test("create sse avec authorizeUrl, list la rend, jamais les en-têtes", async () => {
  const { identity } = await seedActor("admin")
  const id = await identity.mutation(api.mcpServers.create, {
    name: "composio",
    transport: "sse",
    url: "https://mcp.exemple.com/sse",
    authorizeUrl: "https://mcp.exemple.com/connect",
  })
  const listed = await identity.query(api.mcpServers.list, {})
  expect(listed).toEqual([
    expect.objectContaining({
      _id: id,
      name: "composio",
      transport: "sse",
      authorizeUrl: "https://mcp.exemple.com/connect",
      headersConfigured: false,
    }),
  ])
  expect(JSON.stringify(listed)).not.toContain("Authorization")
})

test("authorizeUrl http hors localhost est refusée", async () => {
  const { identity } = await seedActor("admin")
  await expect(
    identity.mutation(api.mcpServers.create, {
      name: "x",
      transport: "sse",
      url: "https://exemple.com/sse",
      authorizeUrl: "http://evil.example/connect",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_URL" } })
})
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @astrotan/backend test convex/mcpServers.test.ts
```

Expected: FAIL — `authorizeUrl` rejeté par le validateur d’args.

- [ ] **Step 3: Implement**

`content.ts` : `export const MAX_MCP_AUTHORIZE_URL = 500`

`schema.ts` :

```ts
mcpServers: defineTable({
  name: v.string(),
  transport: v.union(v.literal("http"), v.literal("sse")),
  url: v.string(),
  enabled: v.boolean(),
  createdBy: v.string(),
  authorizeUrl: v.optional(v.string()),
}).index("by_enabled", ["enabled"]),
```

`create` args : `authorizeUrl: v.optional(v.string())`. Si présent et non vide : `assertLength` + `assertMcpUrl`. Insert le champ.

`list` et `enabledForStream` : inclure `authorizeUrl: row.authorizeUrl ?? null` dans `list` seulement (`enabledForStream` n’en a pas besoin pour `createMCPClient`).

Transport `http` **toujours accepté** par le backend (lignes existantes + tests actuels). Le dialog UI n’enverra que `sse`.

- [ ] **Step 4: Run pass**

```bash
pnpm --filter @astrotan/backend test convex/mcpServers.test.ts
```

Expected: PASS (anciens + nouveaux).

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/content.ts packages/backend/convex/mcpServers.ts packages/backend/convex/mcpServers.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): store optional authorize URL on SSE connectors

EOF
)"
```

**Self-review Chunk 2 :** expand-only, stdio toujours refusé, URL allowlist réutilisée, pas de secret dans `list`. OK.

---

## Chunk 3: Callback popup OAuth

### Task 6: Fermer le popup, sinon redirect

**Files:**
- Modify: `apps/admin/src/routes/api/connectors/google/callback.ts`
- Create: `apps/admin/src/lib/oauthPopup.ts`
- Test: `apps/admin/src/lib/oauthPopup.test.ts`

Le callback actuel (303 vers `/settings/agent?calendar=ok|erreur`) reste le repli **sans** opener (onglet plein). Avec opener : page HTML minimale same-origin qui `postMessage` puis `close()`.

- [ ] **Step 1: Failing test du helper**

```ts
import { expect, test } from "vitest"
import { OAUTH_POPUP_MESSAGE_TYPE, isOAuthPopupMessage } from "./oauthPopup"

test("n'accepte qu'un message same-shape", () => {
  expect(isOAuthPopupMessage({ type: OAUTH_POPUP_MESSAGE_TYPE, ok: true })).toBe(true)
  expect(isOAuthPopupMessage({ type: "autre", ok: true })).toBe(false)
  expect(isOAuthPopupMessage(null)).toBe(false)
})
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @astrotan/admin test src/lib/oauthPopup.test.ts
```

Expected: FAIL — module absent.

- [ ] **Step 3: Implement helper + callback**

`oauthPopup.ts` :

```ts
export const OAUTH_POPUP_MESSAGE_TYPE = "astrotan-google-calendar" as const

export type OAuthPopupMessage = { type: typeof OAUTH_POPUP_MESSAGE_TYPE; ok: boolean }

export function isOAuthPopupMessage(data: unknown): data is OAuthPopupMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === OAUTH_POPUP_MESSAGE_TYPE &&
    "ok" in data &&
    typeof data.ok === "boolean"
  )
}

export function openOAuthPopup(url: string): Window | null {
  return window.open(url, "astrotan-google-calendar", "popup=yes,width=480,height=720")
}

export function listenOAuthPopup(
  onResult: (ok: boolean) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (!isOAuthPopupMessage(event.data)) return
    onResult(event.data.ok)
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}
```

`callback.ts` — garder `fetchAuthAction(api.connectors.exchangeGoogleCode, { code })`. Ensuite :

- Construire `ok` booléen comme aujourd’hui.
- Répondre `text/html; charset=utf-8` avec un HTML **sans secret** :

```html
<!doctype html>
<title>Google Agenda</title>
<script>
  const ok = true; /* ou false, interpolé depuis le serveur — booléen seul */
  const payload = { type: "astrotan-google-calendar", ok };
  if (window.opener && window.opener !== window) {
    window.opener.postMessage(payload, window.location.origin);
    window.close();
  } else {
    location.replace("/settings/agent?calendar=" + (ok ? "ok" : "erreur"));
  }
</script>
```

`ok` interpolé uniquement comme `true`/`false` littéral, jamais le `code`. Interdire tout reflet de query string dans le HTML.

`location.replace` ici est OK : c’est la page intermédiaire du callback, pas la page settings (Back du navigateur ne doit pas ré-échanger le code).

- [ ] **Step 4: Run pass**

```bash
pnpm --filter @astrotan/admin test src/lib/oauthPopup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/lib/oauthPopup.ts apps/admin/src/lib/oauthPopup.test.ts apps/admin/src/routes/api/connectors/google/callback.ts
git commit -m "$(cat <<'EOF'
feat(admin): close Google OAuth popup after calendar callback

EOF
)"
```

**Self-review Chunk 3 :** pas de fuite du `code` dans le HTML, origin check, fallback 303/replace préservé. OK.

---

## Chunk 4: UI admin — rangée + dialogs

Respecter `@.claude/skills/ui-ux-pro-max` et `@.agents/skills/frontend-design` : tokens admin, pas de nouvelle marque. Dialog = copie de `InviteDialog` (contrôle `open`, reset à la fermeture, `Annuler` / CTA, erreur près des champs, bouton disabled pendant l’async).

### Task 7: Marque Calendar + tests de source de la rangée

**Files:**
- Create: `apps/admin/src/assets/google-calendar.png`
- Create: `apps/admin/src/components/google-calendar-mark.tsx`
- Create: `apps/admin/src/components/agent-connectors-row.tsx` (squelette d’abord pour faire échouer le test)
- Test: `apps/admin/src/components/agent-connectors-row.test.ts`

- [ ] **Step 1: Write the failing source-scan**

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "agent-connectors-row.tsx"), "utf8")

describe("rangée de connecteurs", () => {
  test("un clic Agenda, un ajout MCP, rien dans settings.get", () => {
    expect(source).toContain("Connecter son agenda")
    expect(source).toContain("Ajouter un connecteur")
    expect(source).toContain("GoogleCalendarMark")
    expect(source).toContain("api.connectors.googleStatus")
    expect(source).toContain("api.connectors.googleAuthUrl")
    expect(source).toContain("api.mcpServers.create")
    expect(source).toContain('transport: "sse"')
    expect(source).not.toMatch(/value=["']stdio["']/)
    expect(source).not.toContain("api.settings.get")
    expect(source).not.toContain("*.convex.site")
    expect(source).toContain("min-h-11")
  })
})
```

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @astrotan/admin test src/components/agent-connectors-row.test.ts
```

Expected: FAIL — fichier absent.

- [ ] **Step 3: Vendor l’icône + mark + rangée minimale qui fait passer le scan**

1. Télécharger l’icône produit Calendar 2020 **officielle, inaltérée**. Le dépôt importe déjà des PNG via `import astrotanIcon from "@/assets/icon_astrotan.png"` (`app-sidebar.tsx`). Même motif : poser `apps/admin/src/assets/google-calendar.png` (ou `.svg` si le typage Vite accepte ; sinon PNG officiel, pas un redraw). Commentaire au-dessus de l’import : source + « do not redraw ».
2. `google-calendar-mark.tsx` :

```tsx
import mark from "@/assets/google-calendar.png"

export function GoogleCalendarMark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-md bg-white ring-1 ring-foreground/10">
      <img src={mark} width={size} height={size} alt="Google Agenda" />
    </span>
  )
}
```

3. Implémenter la rangée (Task 8) dans le même pas si ça tient < 200 lignes ; sinon squelette avec les chaînes du test, puis Task 8 complète.

- [ ] **Step 4: Run pass** (après Task 8 si le squelette ne suffit pas)

```bash
pnpm --filter @astrotan/admin test src/components/agent-connectors-row.test.ts
```

Expected: PASS.

### Task 8: Rangée + dialog Google + dialog MCP

**Files:**
- Create: `apps/admin/src/components/agent-connectors-row.tsx`
- Create: `apps/admin/src/components/agent-google-connect-dialog.tsx`
- Create: `apps/admin/src/components/agent-mcp-dialog.tsx`
- Create: tests source-scan pour chaque dialog (même motif, < 40 lignes chacun)

Découper pour rester < 200 lignes / fichier :

- `agent-connectors-row.tsx` — layout, tuile Google (états), liste MCP (switch + retirer + lien authorize), ouverture des dialogs.
- `agent-google-connect-dialog.tsx` — champs + Continuer vers Google.
- `agent-mcp-dialog.tsx` — nom, URL SSE, authorizeUrl, bearer, Ouvrir la connexion.

Props / data :

```tsx
// row
const status = useQuery(api.connectors.googleStatus, canWrite ? {} : "skip")
const authUrl = useQuery(
  api.connectors.googleAuthUrl,
  canWrite && status?.ready ? {} : "skip",
)
const disconnect = useMutation(api.connectors.disconnectGoogle)
const servers = useQuery(api.mcpServers.list)
```

Tuile Google déconnectée : `Button` `className="min-h-11"` `variant="default"` avec `GoogleCalendarMark` + « Connecter son agenda ». `onClick` : si `status.ready` → ouvrir dialog confirmation (ou directement popup) ; sinon dialog credentials.

Continuer vers Google :

```ts
const url = authUrl?.url
if (!url) return
const popup = openOAuthPopup(url)
if (popup === null) window.location.assign(url)
else {
  const stop = listenOAuthPopup((ok) => {
    stop()
    setGoogleError(ok ? null : "La connexion Google a été refusée ou interrompue.")
    setGoogleOpen(false)
  })
}
```

Connecté : mark + `{status.email ?? "Compte Google"}` + « Connecté · Agenda principal » (ou l’id `calendarId` si ≠ `primary`) + `Button variant="ghost" className="min-h-11"` « Déconnecter ». Disabled si `refreshSource === "environnement"` + phrase « Ce jeton vient de l’environnement Convex. »

Pas d’avatar Google (pas de scope `userinfo` / photo — l’e-mail de `calendars/primary` suffit ; ne pas inventer un second scope).

Dialog Google credentials : `Field` + `FieldLabel` visibles (pas placeholder-only). Client id → `connectors.updateGoogle`. Secret → `secrets.onSave("GOOGLE_CALENDAR_CLIENT_SECRET", …)` déjà branché via `useSecretsAccess`. Calendar id optionnel. Erreur sous le champ. `Annuler` = `DialogClose`. Pendant submit : disabled + « Enregistrement… » puis enchaîner popup.

Dialog MCP :

```ts
await create({ name, transport: "sse", url, authorizeUrl: authorize || undefined })
if (bearer.trim()) {
  await setHeaders({
    id,
    headersJson: JSON.stringify({ Authorization: `Bearer ${bearer.trim()}` }),
  })
}
```

Bouton « Ouvrir la connexion » : `disabled` si `authorizeUrl` vide ou `assert` front (https / localhost) ; `window.open(authorizeUrl, "_blank", "noopener,noreferrer")`. Ce n’est **pas** le submit.

Liste MCP dans la rangée : une ligne par serveur (`name`, `transport`, switch `setEnabled`, lien « Ouvrir la connexion » si `authorizeUrl`, `Retirer`). Pas de JSON d’en-têtes en clair. Phrase « en-têtes configurés » si `headersConfigured`.

Accessibilité : `aria-busy` sur le CTA async ; la croix du Dialog a déjà `sr-only` « Close » — ne pas y toucher dans ce lot. Titres de dialog en français.

- [ ] **Step 4 (suite): tests dialogs**

`agent-google-connect-dialog.test.ts` : contient « Connecter Google Agenda », « Continuer vers Google », `GOOGLE_CALENDAR_CLIENT_SECRET`, pas `api.settings.get`.

`agent-mcp-dialog.test.ts` : contient `transport: "sse"`, « Ouvrir la connexion », `setHeaders`, `stdio est refusé`, pas de `value="stdio"`.

- [ ] **Step 5: Run**

```bash
pnpm --filter @astrotan/admin test \
  src/components/agent-connectors-row.test.ts \
  src/components/agent-google-connect-dialog.test.ts \
  src/components/agent-mcp-dialog.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/assets/google-calendar.png \
  apps/admin/src/components/google-calendar-mark.tsx \
  apps/admin/src/components/agent-connectors-row.tsx \
  apps/admin/src/components/agent-connectors-row.test.ts \
  apps/admin/src/components/agent-google-connect-dialog.tsx \
  apps/admin/src/components/agent-google-connect-dialog.test.ts \
  apps/admin/src/components/agent-mcp-dialog.tsx \
  apps/admin/src/components/agent-mcp-dialog.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add settings connector row for Calendar and MCP

EOF
)"
```

**Self-review Chunk 4 :** un CTA primaire, 44px, FR, pas de slop visuel, secrets hors `settings.get`, SSE only à la création, lien authorize en new window. OK.

---

## Chunk 5: Branchement page + vérif navigateur

### Task 9: Remplacer les cartes sur `/settings/agent`

**Files:**
- Modify: `apps/admin/src/routes/_authed/settings/agent.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/agent.test.tsx`
- Delete: `apps/admin/src/components/agent-calendar-card.tsx`
- Delete: `apps/admin/src/components/agent-calendar-card.test.ts`
- Delete: `apps/admin/src/components/agent-mcp-card.tsx`
- Delete: `apps/admin/src/components/agent-mcp-card.test.ts`

- [ ] **Step 1: Faire échouer le test de route**

Remplacer le test « porte les cartes Agenda et MCP » par :

```ts
test("porte la rangée de connecteurs, plus les cartes-formulaires", () => {
  expect(source).toContain("AgentConnectorsRow")
  expect(source).not.toContain("AgentCalendarCard")
  expect(source).not.toContain("AgentMcpCard")
  expect(source).not.toContain("GOOGLE_CALENDAR_CLIENT_SECRET")
})
```

Le secret client ne doit plus apparaître **dans la page** (seulement dans le dialog).

- [ ] **Step 2: Run fail**

```bash
pnpm --filter @astrotan/admin test src/routes/_authed/settings/agent.test.tsx
```

Expected: FAIL — `AgentConnectorsRow` absent, `AgentCalendarCard` encore là.

- [ ] **Step 3: Brancher**

Dans `agent.tsx`, retirer les imports et le JSX de `AgentCalendarCard` / `AgentMcpCard`. Ajouter :

```tsx
<AgentConnectorsRow canWrite={canWrite} secrets={secrets} />
```

`AgentConnectorsRow` prend `secrets` pour `onSave` / `onClear` / états dans le dialog Google uniquement.

`?calendar=erreur|ok` (redirect sans popup) : dans `agent.tsx`,

```tsx
export const Route = createFileRoute("/_authed/settings/agent")({
  validateSearch: (search: Record<string, unknown>) => ({
    calendar:
      search.calendar === "ok" || search.calendar === "erreur"
        ? search.calendar
        : undefined,
  }),
  component: AgentRoute,
})
```

Passer `calendar={Route.useSearch().calendar}` à la rangée. Si `"erreur"`, un `<p role="alert">` sous la tuile : « La connexion Google a été refusée ou interrompue. » Si `"ok"`, rien de plus (Convex a déjà mis à jour `googleStatus`).

- [ ] **Step 4: Run pass + lint des fichiers touchés**

```bash
pnpm --filter @astrotan/admin test src/routes/_authed/settings/agent.test.tsx src/components/agent-connectors-row.test.ts
pnpm --filter @astrotan/backend test convex/connectors.test.ts convex/mcpServers.test.ts convex/lib/visitorAgent.test.ts convex/lib/googleOAuth.test.ts
```

Expected: PASS. Plus aucune référence à `agent-calendar-card` / `agent-mcp-card` (`rg AgentCalendarCard apps/admin` → vide).

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/routes/_authed/settings/agent.tsx \
  apps/admin/src/routes/_authed/settings/agent.test.tsx
git rm apps/admin/src/components/agent-calendar-card.tsx \
  apps/admin/src/components/agent-calendar-card.test.ts \
  apps/admin/src/components/agent-mcp-card.tsx \
  apps/admin/src/components/agent-mcp-card.test.ts
git commit -m "$(cat <<'EOF'
refactor(admin): replace agent calendar and MCP cards with connector row

EOF
)"
```

### Task 10: Vérification navigateur sur localhost:3001

Prérequis : `pnpm dev` déjà lancé par Antoine (ne pas lancer `convex dev`). Admin : `http://localhost:3001/settings/agent` (session owner/admin).

- [ ] **Step 1: État vide**

Ouvrir `/settings/agent`. Sous le bloc identité : rangée « Connecter son agenda » (logo Calendar + texte) et « + Ajouter un connecteur ». Pas de champs Client id / Secret / URL MCP sur la page. Tab : les deux boutons reçoivent le focus ring. Cibles ≥ 44px.

- [ ] **Step 2: Dialog MCP**

Cliquer « Ajouter un connecteur ». Titre FR, labels visibles, Annuler ferme. « Ouvrir la connexion » disabled sans URL. Remplir nom + `https://example.com/sse`, Ajouter. Une ligne apparaît. Switch off/on. Retirer. Relancer avec authorize URL + bearer : le bearer disparaît du champ après save ; `list` ne le montre pas.

- [ ] **Step 3: Google — credentials puis OAuth**

Sans client id : clic Agenda → dialog champs. Annuler. Rouvrir, saisir un faux id → Continuer : bouton disabled pendant l’appel ; si `googleAuthUrl` jette, erreur près du CTA.

Avec un vrai client Google (console Cloud, redirect `http://localhost:3001/api/connectors/google/callback`) + secret déjà en env ou saisi : Continuer ouvre le popup Google (ou redirect). Consentir. Revenir : tuile affiche l’e-mail (ou l’id primary), « Déconnecter » visible.

- [ ] **Step 4: Déconnecter + agent**

Déconnecter → retour à « Connecter son agenda ». Sur le site public, l’agent ne doit plus avoir les tools calendar (vérif : un tour de preview bulle, ou log tools — ne pas inventer un RDV). Reconnecter. La preview / un fil test peut parler de créneaux seulement après reconnect.

- [ ] **Step 5: Régression**

Identité agent, fichiers de savoir, bulle d’aperçu : inchangés. `/settings/ia` existe encore à ce stade — la fusion est le Chunk 6, ne pas y toucher ici. Mobile 375px : la rangée passe en colonne (`flex-col sm:flex-row`), pas de scroll horizontal.

Si un écart : corriger, re-vérifier le flux cassé, ne pas déclarer fini sur un screenshot unique.

---

## Hors lot (ne pas faire)

- Implémenter `authProvider` OAuth MCP de `@ai-sdk/mcp`.
- Brancher `calendarmcp.googleapis.com` comme bouton Agenda.
- Ajouter TanStack Query.
- Scopes `userinfo` / photo de profil Google.
- Champ `GOOGLE_CALENDAR_CLIENT_ID` dans l’env (n’existe pas ; le client id reste un champ settings saisi dans le dialog).
- Supprimer le transport `http` du schéma MCP.
- Toucher `apps/web`, RAG, ChatWidget, shimmer, extract PDF, e-mail-après-premier-message.
- Inventer un champ « greeting » / premier message : il n’existe pas. Les consignes (`agentInstructions`) restent dans Identité.
- Réécrire `settings.update`, `secrets.set` ou `secretCheck` pour OpenRouter. Le Chunk 6 déplace le route, pas les mutations.
- Éditer à la main `apps/admin/src/routeTree.gen.ts` (le plugin TanStack le régénère).
- Réécrire les specs / plans historiques (`2026-09-01-agent-ia-visiteur*`, etc.).

---

## Chunk 6: Fusion Agent + IA — une page, une entrée de menu

**Dépend de** Chunks 1–5 (`AgentConnectorsRow` déjà monté sur `/settings/agent`).

**Pourquoi cet ordre de sections** (et pas l’ordre actuel de `/settings/agent`, qui mélange identité + fichiers dans un seul `SettingsGroup` sans titre, puis Agenda / MCP, et laisse le modèle sur une autre URL) :

1. **Identité de l’agent** — qui parle (nom, avatar, bulle on/off, consignes). Déjà sur agent. Pas de champ greeting à créer : `agentInstructions` est le texte le plus proche, et il reste ici.
2. **Modèle IA** — ce qui est aujourd’hui `/settings/ia` (clé OpenRouter + « Vérifier et enregistrer » + sélecteurs texte / image). Sans clé la bulle affiche `AGENT_UNCONFIGURED` : le mettre juste sous l’identité supprime le hop et la bannière « Configurer la clé sur l’écran IA ».
3. **Applications** — tuile Google Agenda + « + Ajouter un connecteur » (Chunks 1–5). Après « qui » et « quel cerveau », « quels outils ». Aujourd’hui Agenda / MCP sont *sous* les fichiers : ça enterre le CTA OAuth.
4. **Base de savoir** — fichiers + Réindexer + badges d’index. Déjà sur agent, aujourd’hui collé à l’identité. Un groupe à part = un CTA primaire (ajouter / réindexer), pas un quatrième champ du formulaire nom.
5. **Bulle d’aperçu** — `AgentPreviewBubble` (`fixed` bas, `ChatWidget` partagé). Ne pas la déplacer, ne pas la réécrire.

`AiPage` aujourd’hui = **deux** `SettingsGroup` (« Clé OpenRouter » + modèles sans titre). Les fusionner en **un** groupe « Modèle IA » : pas de soupe de cartes, un CTA primaire (« Vérifier et enregistrer »), les sélecteurs enregistrent au `onChange` comme aujourd’hui.

Système visuel : le même que le haut du plan (`SettingsGroup` `rounded-xl bg-card p-4 ring-1 ring-foreground/10`, sentence-case, `min-h-11`, pas de seconde identité). Secret déjà en progressive disclosure (`SecretField` : masque, « Connecté », password).

Pas de fil d’Ariane à ajouter : `SettingsPageHeader` n’en a pas, la sidebar dit « Réglages ».

`/settings/ia` **reste un fichier de route** et redirige — c’est du câblage (bookmarks, `pageErrors` d’hier, liens collés), pas une ligne de README. Motif : `apps/admin/src/routes/_authed/settings/referencement.tsx`.

### Wireframe — page fusionnée

```
h1  Agent IA & Modèle IA          ← une entrée de menu, même libellé

┌─ Identité de l’agent ─────────────────────────────────────────────┐
│ [ ] Afficher la bulle sur le site                                 │
│ Nom d'affichage  [____________]                                   │
│ Avatar           […]                                              │
│ Instructions     [____________]                                   │
└───────────────────────────────────────────────────────────────────┘

┌─ Modèle IA ───────────────────────────────────────────────────────┐
│ Clé OpenRouter                                                    │
│ OPENROUTER_API_KEY          [••••]  [ Vérifier et enregistrer ]   │
│                             Connecté                              │
│ Modèle de texte   [ Grok 4.6          ▾ ]                         │
│ Modèle d'image    [ Gemini 3 Pro Image ▾ ]                        │
└───────────────────────────────────────────────────────────────────┘

┌─ Applications ────────────────────────────────────────────────────┐
│ [📅] Connecter son agenda     [+] Ajouter un connecteur           │
│ (rangée Chunks 1–5 ; titre « Connecteurs » du wireframe Chunk 4    │
│  devient « Applications » ici — ne pas nester deux SettingsGroup) │
└───────────────────────────────────────────────────────────────────┘

┌─ Base de savoir ──────────────────────────────────────────────────┐
│ fichiers · badges · [ Réindexer ]                                 │
└───────────────────────────────────────────────────────────────────┘

                    (○) bulle d’aperçu — inchangée
```

### Task 11: `AiPage` — un seul groupe « Modèle IA »

**Files:**
- Modify: `apps/admin/src/components/settings-environment.tsx` (`AiPage`, ~L125–160)
- Test: `apps/admin/src/components/settings-environment.test.tsx` (`describe("AiPage")`)

`/settings/ia` rend encore `AiPage` à ce stade : le test HTML reste vert sur le composant, pas sur la route.

- [ ] **Step 1: Write the failing assertions**

Dans `describe("AiPage")`, test « mène à l'endroit où la clé se fabrique » : aujourd’hui il attend `Clé OpenRouter` (titre du premier groupe). Ajouter :

```ts
test("un seul groupe Modèle IA, pas deux cartes", () => {
  const html = render(pageIa(bloc()))
  expect(html).toContain("Modèle IA")
  expect((html.match(/<h2\b/g) ?? []).length).toBe(1)
  expect(html).toContain("Clé OpenRouter")
  expect(html).toContain("Vérifier et enregistrer")
  expect(html).toContain("Modèle de texte")
  expect(html).toMatch(/Modèle d(?:'|&#x27;)image/)
})
```

Garder les tests existants (Connecté, editor, précédence env). Ils doivent continuer à passer après le collapse.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @astrotan/admin test src/components/settings-environment.test.tsx
```

Expected: FAIL — `Modèle IA` absent ; deux `<h2>` (ou un seul « Clé OpenRouter »).

- [ ] **Step 3: Write minimal implementation**

Remplacer le corps de `AiPage` (les deux `SettingsGroup`) par :

```tsx
export function AiPage({ secrets, canWrite, ...models }: AiPageProps) {
  return (
    <SettingsGroup title="Modèle IA">
      {secrets.cleMaitresse === null ? (
        <p className="text-sm text-muted-foreground">
          Réservée au propriétaire et aux administrateurs.
        </p>
      ) : (
        <>
          {secrets.cleMaitresse === "posee" ? null : (
            <CleMaitresseBandeau etat={secrets.cleMaitresse} />
          )}
          <Field>
            <FieldLabel>Clé OpenRouter</FieldLabel>
            <ChampSecret
              bloc={secrets}
              nom="OPENROUTER_API_KEY"
              consequence="La génération des champs SEO et GEO depuis l'éditeur ne fonctionnera plus."
            >
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                openrouter.ai/keys
                <ExternalLinkIcon aria-hidden="true" className="size-3" />
              </a>
            </ChampSecret>
          </Field>
        </>
      )}
      <AiModelFields canWrite={canWrite} {...models} />
    </SettingsGroup>
  )
}
```

Importer `Field` / `FieldLabel` depuis `@/components/ui/field` si pas déjà là.

Ne pas changer les props (`onSaveModel`, `onSaveImageModel`, `secrets`). Ne pas toucher `ChampSecret` / `SecretField`.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @astrotan/admin test src/components/settings-environment.test.tsx
```

Expected: PASS (anciens + nouveau).

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/components/settings-environment.tsx \
  apps/admin/src/components/settings-environment.test.tsx
git commit -m "$(cat <<'EOF'
refactor(admin): collapse OpenRouter settings into one Modèle IA group

EOF
)"
```

### Task 12: Monter IA sur `/settings/agent`, quatre sections

**Files:**
- Modify: `apps/admin/src/routes/_authed/settings/agent.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/agent.test.tsx`

`AgentConnectorsRow` est déjà dans la page (Task 9). Ici on **réordonne** et on monte `AiPage`. Si la rangée a déjà ouvert un `SettingsGroup` titré « Connecteurs », retirer ce wrapper (ou passer le titre) pour n’avoir **qu’un** groupe « Applications » — ne pas nester.

Auto-save : **inchangé** — seulement `agentEnabled` / `agentDisplayName` / `agentInstructions` / `agentAvatarMediaId` via `settings.updateAgent`. Les modèles partent au `onChange` (`settings.update`). La clé part au clic « Vérifier et enregistrer ». Ne **pas** recopier les `throw` de `IaForm` (`auto: {}`) : ils casserait la barre d’identité.

- [ ] **Step 1: Faire échouer le test de route**

Remplacer le test « enregistre via settings.updateAgent, jamais settings.update » et ajouter :

```ts
test("porte AiPage et les quatre sections, plus de lien vers /settings/ia", () => {
  expect(source).toContain("AiPage")
  expect(source).toContain("Identité de l'agent")
  expect(source).toContain("Applications")
  expect(source).toContain("Base de savoir")
  expect(source).toContain("AgentConnectorsRow")
  expect(source).toContain("AgentKnowledgeFiles")
  expect(source).toContain("AgentPreviewBubble")
  expect(source).toContain("api.settings.updateAgent")
  expect(source).toContain("onSaveModel")
  expect(source).toContain("onSaveImageModel")
  expect(source).not.toContain('to="/settings/ia"')
  expect(source).not.toContain("Configurer la clé sur l'écran IA")
  expect(source).not.toContain("AgentCalendarCard")
  expect(source).not.toContain("AgentMcpCard")
})
```

L’ordre dans le source doit être Identité → `AiPage` → `AgentConnectorsRow` → Base de savoir → `AgentPreviewBubble` (la bulle reste *hors* du `SettingsFormShell`, comme aujourd’hui).

```ts
test("l'ordre des sections est identité, modèle, applications, savoir", () => {
  const identite = source.indexOf("Identité de l'agent")
  const ai = source.indexOf("<AiPage")
  const apps = source.indexOf("Applications")
  const savoir = source.indexOf("Base de savoir")
  const bulle = source.indexOf("AgentPreviewBubble")
  expect(identite).toBeGreaterThan(-1)
  expect(ai).toBeGreaterThan(identite)
  expect(apps).toBeGreaterThan(ai)
  expect(savoir).toBeGreaterThan(apps)
  expect(bulle).toBeGreaterThan(savoir)
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @astrotan/admin test src/routes/_authed/settings/agent.test.tsx
```

Expected: FAIL — `AiPage` / titres de sections absents ; le `Link` `/settings/ia` est encore là.

- [ ] **Step 3: Write minimal implementation**

Dans `agent.tsx` :

1. Importer `AiPage` depuis `@/components/settings-environment`.
2. Importer `useMutation(api.settings.update)` **en plus** de `updateAgent` — uniquement pour les deux callbacks modèles.
3. Retirer le `Link` et le paragraphe `openRouterMissing` (la clé est sur la page).
4. Découper l’unique `SettingsGroup` actuel :

```tsx
<SettingsFormShell
  to="/settings/agent"
  canWrite={canWrite}
  autoSave={autoSave}
  unsavedLabel="L'affichage, le nom ou les consignes de l'agent"
>
  <SettingsGroup title="Identité de l'agent">
    {/* switch bulle, nom, AgentAvatarField, instructions — JSX actuel */}
  </SettingsGroup>

  <AiPage
    secrets={secrets}
    canWrite={canWrite}
    openRouterModel={settings?.openRouterModel ?? null}
    openRouterImageModel={settings?.openRouterImageModel ?? null}
    onSaveModel={(id) => update({ openRouterModel: id })}
    onSaveImageModel={(id) => update({ openRouterImageModel: id })}
  />

  <SettingsGroup
    title="Applications"
    description="L'agent n'utilise un agenda que si un compte est lié."
  >
    <AgentConnectorsRow canWrite={canWrite} secrets={secrets} />
  </SettingsGroup>
  {/* Si AgentConnectorsRow a déjà cette phrase ou un SettingsGroup
      « Connecteurs », ne la garder qu'ici — un seul cadre, un seul titre. */}

  <SettingsGroup title="Base de savoir">
    <AgentKnowledgeFiles disabled={!canWrite} />
  </SettingsGroup>
</SettingsFormShell>
<AgentPreviewBubble avatarUrl={settings?.agentAvatarUrl ?? null} />
```

Garder `validateSearch` / `?calendar=` de la Task 9.

Si `agent.tsx` dépasse ~180 lignes : extraire le bloc identité dans `apps/admin/src/components/agent-identity-fields.tsx` (props : les quatre états + setters + `canWrite`). Ne pas extraire autrement.

Retirer l’import `Link` s’il ne sert plus.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/admin test \
  src/routes/_authed/settings/agent.test.tsx \
  src/components/settings-environment.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/routes/_authed/settings/agent.tsx \
  apps/admin/src/routes/_authed/settings/agent.test.tsx \
  apps/admin/src/components/agent-identity-fields.tsx
git commit -m "$(cat <<'EOF'
feat(admin): merge OpenRouter settings onto the agent page

EOF
)"
```

(`agent-identity-fields.tsx` seulement s’il a été créé.)

### Task 13: Une entrée de menu + redirect `/settings/ia`

**Files:**
- Modify: `apps/admin/src/components/settings-nav.tsx`
- Modify: `apps/admin/src/components/settings-nav.test.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/ia.tsx`
- Modify: `apps/admin/src/routes/_authed/settings/ia.test.tsx`
- Modify: `apps/admin/src/components/settings-page.tsx` (commentaire « sept pages » → six)
- Modify: `apps/admin/src/routes/_authed/settings.tsx` (idem)
- Modify: `apps/admin/src/routes/_authed/settings/index.tsx` (idem)

`SettingsPath` retire `"/settings/ia"`. `SettingsFormShell to="…"` ne peut plus pointer vers ia — c’est voulu, le fichier ia n’a plus de shell.

Le test existant « un fichier hors menu n'est qu'une redirection de signet » **échoue** si on retire ia du menu sans redirect. Nav + redirect = un seul pas.

- [ ] **Step 1: Write the failing tests**

`settings-nav.test.tsx` — remplacer les deux tests « page agent s'appelle Agent » et « page ia s'appelle IA » :

```ts
test("porte les pages attendues, dans l'ordre du menu", () => {
  expect(SETTINGS_PAGES.map((page) => page.to)).toEqual([
    "/settings/identite",
    "/settings/webhook",
    "/settings/domaine",
    "/settings/emails",
    "/settings/mesure",
    "/settings/agent",
  ])
  expect(SETTINGS_PAGES.map((page) => page.to as string)).not.toContain(
    "/settings/ia",
  )
})

test("la page agent s'appelle Agent IA & Modèle IA", () => {
  expect(SETTINGS_PAGES.find((p) => p.to === "/settings/agent")).toMatchObject({
    label: "Agent IA & Modèle IA",
    title: "Agent IA & Modèle IA",
    description: "",
  })
})

test("/settings/ia redirige vers l'agent", () => {
  const source = ROUTE_FILES["../routes/_authed/settings/ia.tsx"]
  expect(source).toBeTruthy()
  expect(source).toContain("throw redirect")
  expect(source).toContain("/settings/agent")
  expect(source).not.toContain("AiPage")
  expect(source).not.toContain("SettingsFormShell")
})
```

`description: ""` : quatre `h2` disent déjà le contenu (même règle que Email / SEO & Pixel — pas un sommaire de 25 mots sous le `h1`). Le test « le titre de page commence par le libellé du menu » passe si `title === label`.

`ia.test.tsx` — remplacer le fichier :

```ts
import { describe, expect, test } from "vitest"
import source from "./ia.tsx?raw"

describe("settings/ia — signet", () => {
  test("redirige vers /settings/agent, plus de formulaire", () => {
    expect(source).toContain("throw redirect")
    expect(source).toContain("/settings/agent")
    expect(source).not.toContain("AiPage")
    expect(source).not.toContain("SettingsFormShell")
    expect(source).not.toContain("useAutoSave")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @astrotan/admin test \
  src/components/settings-nav.test.tsx \
  src/routes/_authed/settings/ia.test.tsx
```

Expected: FAIL — `/settings/ia` encore dans `SETTINGS_PAGES` ; `ia.tsx` contient encore `AiPage`.

- [ ] **Step 3: Implement**

`settings-nav.tsx` :

1. Retirer `"/settings/ia"` de `SettingsPath`.
2. Retirer l’objet `{ to: "/settings/ia", label: "IA", … }` de `SETTINGS_PAGES`.
3. Remplacer l’entrée agent :

```ts
{
  to: "/settings/agent",
  label: "Agent IA & Modèle IA",
  title: "Agent IA & Modèle IA",
  description: "",
},
```

Elle reste **après** « SEO & Pixel » (même place qu’aujourd’hui pour Agent ; IA disparaît, on ne glisse pas Agent au milieu).

4. Commentaire L17–18 (« Domaine, Mesure et IA portent maintenant les champs… ») : « Domaine, Mesure et Agent IA ».

`ia.tsx` — remplacer tout le fichier (motif `referencement.tsx`) :

```ts
import { createFileRoute, redirect } from "@tanstack/react-router"

// Signet : la clé OpenRouter et les modèles vivent sur /settings/agent
// (Agent IA & Modèle IA). La route reste pour ne pas 404 un bookmark.
export const Route = createFileRoute("/_authed/settings/ia")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/agent" })
  },
})
```

Ne pas éditer `routeTree.gen.ts` : le plugin le régénère ; la route `/settings/ia` continue d’exister (redirect).

Commentaires « sept pages » / « sept entrées » → « six » dans `settings-page.tsx`, `settings.tsx`, `index.tsx`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @astrotan/admin test \
  src/components/settings-nav.test.tsx \
  src/routes/_authed/settings/ia.test.tsx \
  src/routes/_authed/settings/agent.test.tsx
```

Expected: PASS. `rg 'to="/settings/ia"' apps/admin/src` → uniquement éventuellement plus rien (le redirect n’est pas un `to=`). `rg SettingsPath apps/admin` : plus de `"/settings/ia"`.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/components/settings-nav.tsx \
  apps/admin/src/components/settings-nav.test.tsx \
  apps/admin/src/routes/_authed/settings/ia.tsx \
  apps/admin/src/routes/_authed/settings/ia.test.tsx \
  apps/admin/src/components/settings-page.tsx \
  apps/admin/src/routes/_authed/settings.tsx \
  apps/admin/src/routes/_authed/settings/index.tsx
git commit -m "$(cat <<'EOF'
feat(admin): merge IA settings nav into Agent IA and redirect /settings/ia

EOF
)"
```

### Task 14: Copie — erreurs, commentaires de câblage

**Files:**
- Modify: `apps/admin/src/lib/pageErrors.ts`
- Modify: `apps/admin/src/lib/pageErrors.test.ts`
- Modify: `apps/admin/src/lib/settingsErrors.ts`
- Modify: `apps/admin/src/lib/settingsErrors.test.ts`
- Modify: `scripts/bootstrap.mjs` (commentaire ~L351)
- Modify: `scripts/check-env-wiring.mjs` (commentaire ~L58)
- Modify: `docker/README.md` (~L396)
- Modify: `AGENTS.md` (~L116)

Mesure / emails : **aucun** `Link` vers `/settings/ia` aujourd’hui. Rien à brancher là. Les phrases « Réglages → IA » vivent dans `pageErrors` (éditeur de page) et `settingsErrors` (réindex savoir, désormais **sur la même page**).

- [ ] **Step 1: Write the failing tests**

`pageErrors.test.ts` — remplacer « pointe vers Réglages → IA » :

```ts
test("OPENROUTER_NOT_CONFIGURED pointe vers Réglages → Agent IA & Modèle IA", () => {
  const message = describePageError(
    new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" }),
  )
  expect(message).toContain("Réglages → Agent IA & Modèle IA")
  expect(message).not.toContain("Réglages → IA.")
  expect(message).not.toBe("Une erreur inattendue est survenue.")
})
```

Garder les tests REFUSED / BAD_RESPONSE / BAD_IMAGE : mettre à jour leurs chaînes dans `pageErrors.ts` (y compris le `reason === "empty"` en dur L115) pour la même cible. Étendre les expects :

```ts
expect(describePageError(new ConvexError({ code: "OPENROUTER_REFUSED" }))).toContain(
  "Agent IA",
)
```

`settingsErrors.test.ts` :

```ts
test("OPENROUTER_NOT_CONFIGURED pointe vers la section Modèle IA", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" })),
  ).toMatch(/Modèle IA/)
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @astrotan/admin test \
  src/lib/pageErrors.test.ts \
  src/lib/settingsErrors.test.ts
```

Expected: FAIL — encore « Réglages → IA » / « écran IA ».

- [ ] **Step 3: Implement**

`pageErrors.ts` — les quatre phrases + le `empty` :

```ts
OPENROUTER_NOT_CONFIGURED:
  "OpenRouter n'est pas configuré. Ajoutez une clé dans Réglages → Agent IA & Modèle IA.",
OPENROUTER_REFUSED:
  "OpenRouter a refusé la clé. Vérifiez-la dans Réglages → Agent IA & Modèle IA.",
OPENROUTER_BAD_RESPONSE:
  "L'IA a renvoyé un texte que nous n'avons pas pu lire comme des métadonnées. Réessayez, ou changez de modèle dans Réglages → Agent IA & Modèle IA.",
OPENROUTER_BAD_IMAGE:
  "L'IA n'a pas renvoyé d'image utilisable. Réessayez, ou changez le modèle d'image dans Réglages → Agent IA & Modèle IA.",
```

et le `reason === "empty"` (aujourd’hui L115), **même verbe** qu’aujourd’hui :

```ts
return "L'IA n'a pas rempli les champs SEO ou GEO. Réessayez, ou changez de modèle dans Réglages → Agent IA & Modèle IA."
```

`settingsErrors.ts` :

```ts
OPENROUTER_NOT_CONFIGURED:
  "Sans clé OpenRouter, l'index de savoir ne peut pas être calculé. Configurez-la dans la section Modèle IA.",
```

Commentaires de câblage (même phrase, trois fichiers + AGENTS) :

- `scripts/bootstrap.mjs` : « `/settings/mesure` et `/settings/agent` sont alors décoratifs »
- `scripts/check-env-wiring.mjs` : idem
- `docker/README.md` : idem
- `AGENTS.md` : « `/settings/mesure` and `/settings/agent` do nothing »

Ne pas toucher les plans / specs datés.

- [ ] **Step 4: Run tests + grep**

```bash
pnpm --filter @astrotan/admin test \
  src/lib/pageErrors.test.ts \
  src/lib/settingsErrors.test.ts
rg -n '/settings/ia|Réglages → IA|écran IA' \
  apps/admin/src scripts/bootstrap.mjs scripts/check-env-wiring.mjs \
  docker/README.md AGENTS.md CLAUDE.md
```

Expected: tests PASS. Le grep ne doit plus montrer de **lien** vivant vers l’ancien écran (hors `ia.tsx` redirect, `routeTree.gen.ts`, et cette phrase de plan). `CLAUDE.md` n’a pas `/settings/ia` aujourd’hui — ne rien y ajouter.

- [ ] **Step 5: Commit** *(ne pas committer tant qu’Antoine n’a pas dit)*

```bash
git add apps/admin/src/lib/pageErrors.ts \
  apps/admin/src/lib/pageErrors.test.ts \
  apps/admin/src/lib/settingsErrors.ts \
  apps/admin/src/lib/settingsErrors.test.ts \
  scripts/bootstrap.mjs scripts/check-env-wiring.mjs \
  docker/README.md AGENTS.md
git commit -m "$(cat <<'EOF'
fix(admin): point OpenRouter copy at the merged agent settings page

EOF
)"
```

### Task 15: Vérification navigateur — page fusionnée

Prérequis : `pnpm dev` déjà lancé par Antoine. Session owner/admin. Ne pas lancer `convex dev`.

- [ ] **Step 1: Menu**

`http://localhost:3001/settings` → Identité. Le menu latéral a **une** entrée **Agent IA & Modèle IA**, plus d’entrée **IA** ni **Agent**. Clic → `/settings/agent`. `h1` = le libellé. Pas de phrase sous le titre. Pas de fil d’Ariane nouveau.

- [ ] **Step 2: Signet**

Ouvrir `http://localhost:3001/settings/ia` → atterrit sur `/settings/agent` (pas de flash de l’ancien formulaire). Back du navigateur : ne pas reboucler (TanStack `redirect` remplace l’entrée).

- [ ] **Step 3: Sections haut → bas**

Identité (bulle, nom, avatar, consignes) → Modèle IA (clé + Vérifier et enregistrer + deux sélecteurs) → Applications (tuile Agenda + Ajouter un connecteur) → Base de savoir (fichiers, Réindexer, badges) → bulle d’aperçu toujours en bas à droite (`ChatWidget`). Un seul `h1`. Quatre `h2`. Pas de champs Client id / Secret / URL MCP en clair sur la page.

- [ ] **Step 4: Gestes**

Identité : modifier le nom → barre d’enregistrement (auto-save). Modèle : changer le sélecteur texte → enregistré sans salir la barre. Clé déjà posée : « Connecté », pas de valeur en clair. Applications : dialogs Chunk 5. Savoir : Réindexer. Editor : lecture + bandeau rôles, pas de saisie de clé.

- [ ] **Step 5: Régressions + mobile**

Éditeur d’article : un refus OpenRouter dit « Réglages → Agent IA & Modèle IA ». `/settings/mesure`, `/settings/emails` : inchangés. 375px : menu en pastilles (le libellé long défile, `whitespace-nowrap` déjà là), sections en colonne, pas de scroll horizontal dans une carte.

Si un écart : corriger, re-vérifier le flux cassé, ne pas déclarer fini sur un screenshot unique.

**Self-review Chunk 6 :** pas de TODO, snippets complets, TDD, redirect = câblage, mutations IA intactes, un CTA par section, FR sentence-case, pas de greeting inventé, ChatWidget / RAG / shimmer / PDF non touchés, `settings.get` intact. OK.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-connecteurs-agenda-mcp.md`. Ready to execute?

**REQUIRED:** Use **superpowers:subagent-driven-development**. Fresh subagent per task + two-stage review. Do not implement in the planner session. Do not commit until Antoine says so.
