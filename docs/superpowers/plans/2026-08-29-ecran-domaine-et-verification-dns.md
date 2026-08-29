# Écran « Domaine » — saisie, vérification DNS, instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'écran `/settings/domaine`, aujourd'hui purement descriptif, par un écran où l'adoptant saisit son domaine, le fait vérifier, et obtient les enregistrements DNS exacts à créer chez son hébergeur — pour le site **et** pour l'envoi d'emails.

**Architecture:** Le domaine saisi est stocké dans `settings.declaredDomain` et ne pilote **rien** au runtime : il sert d'entrée à la vérification et de valeur de comparaison contre le domaine figé au build. La vérification interroge le DNS depuis une action Convex par DNS-over-HTTPS, le runtime Convex n'ayant pas de résolveur système. L'écran rend des instructions, pas des effets.

**Tech Stack:** Convex (`action`, `mutation`, `internalQuery`), React 19 + TanStack Start, `SettingsFormShell` + `useAutoSave` désarmé (motif `webhook.tsx`).

**Spec:** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md) et [`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`](../specs/2026-08-29-secrets-et-chiffrement.md)

## Pourquoi la saisie ne change pas le domaine

Ce point décide de tout l'écran, et le contredire produirait une fonctionnalité qui ment.

Changer de domaine se fait en **cinq** endroits, pas trois comme l'écran l'affirme aujourd'hui (`apps/admin/src/components/settings-environment.tsx:190-199`) :

1. les enregistrements DNS chez le registrar ;
2. `WEB_DOMAIN` / `ADMIN_DOMAIN` / `UMAMI_DOMAIN` dans le `docker/.env` du VPS (labels Traefik, certificats) ;
3. le **build-arg** `WEB_DOMAIN` de l'image web — `apps/web/astro.config.ts:13` le fige dans `security.allowedDomains` ;
4. le **build-arg** `VITE_WEB_SITE_URL` de l'image admin — liens d'aperçu ;
5. `SITE_URL` et `WEB_SITE_URL` dans l'environnement Convex.

Aucune de ces valeurs n'est lue depuis la base. `SITE_URL` est lue **au chargement du module** par Better Auth (`packages/backend/convex/auth.ts:391`) : la déplacer en base ferait diverger `baseURL` et `trustedOrigins` des liens d'email. Un champ qui « change le domaine » est donc impossible sans reconstruire les images.

Ce que le champ apporte à la place, et qui a une valeur réelle : **il rend la divergence visible**. Le conteneur refuse déjà de démarrer quand le `WEB_DOMAIN` du runtime diffère de celui du build (`apps/web/verifier-domaine.mjs:105-131`), mais rien ne compare le domaine que l'opérateur *croit* avoir déployé. L'écran le fera.

## Global Constraints

- **Invariant 1** — `apps/web` n'a ni clé admin ni session. `settings.get` est publique et non authentifiée : `declaredDomain` **n'entre pas** dans sa projection (`packages/backend/convex/settings.ts:87-102`). Il va dans `getPrivate` uniquement.
- **Invariant 3** — chaque mutation revérifie le rôle par `requireRole`. `lib/authz.test.ts` la déroulera rôle par rôle.
- **Invariant 6** — expand/migrate/contract. `declaredDomain` est ajouté en `v.optional()`, déployable seul.
- **Invariant 7** — un secret ne vit qu'à trois endroits. Un domaine n'est pas un secret ; rien de ce plan ne touche à `secrets`.
- **Règle Convex 1** — tout fichier à nom simple sous `packages/backend/convex/` est un point d'entrée de déploiement. Les fixtures de test vont dans `packages/backend/testing/`.
- **Règle Convex 2** — lancer `npx convex dev --once` réel avant de considérer une tâche finie. `tsc` et vitest ne voient pas ce que le runtime refuse.
- **Garde-fous à satisfaire** : `_registry.test.ts` exige l'égalité stricte dans les deux sens pour toute mutation **ou action publique** ; `_dataRegistry.test.ts` exige que toute table des deux schémas soit classée ; `legal.test.ts` exige que chaque `declaredAs` corresponde exactement à un `purpose` publié.
- Commentaires de code en français, messages de commit en anglais (Conventional Commits).
- TDD : test qui échoue, implémentation minimale, test qui passe, commit.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/hoteNu.ts` *(créer)* | Valider un hôte nu. Copie assumée de `apps/web/src/lib/allowedDomains.ts:53`, que `packages/backend` n'a pas le droit d'importer. |
| `packages/backend/convex/lib/doh.ts` *(créer)* | Client DNS-over-HTTPS : construire la requête, borner le temps, analyser la réponse. Pur sauf le `fetch`. |
| `packages/backend/convex/dns.ts` *(créer)* | Les deux actions publiques de vérification. Point d'entrée de déploiement. |
| `packages/backend/convex/schema.ts` *(modifier)* | `settings.declaredDomain: v.optional(v.string())`. |
| `packages/backend/convex/settings.ts` *(modifier)* | `declaredDomain` dans `getPrivate` et dans `update`, avec validation. |
| `packages/backend/convex/_registry.ts` *(modifier)* | Déclarer `dns.checkSite` et `dns.checkEmail`. |
| `apps/admin/src/routes/_authed/settings/domaine.tsx` *(réécrire)* | L'écran : un champ, une barre d'enregistrement, un bouton de vérification. |
| `apps/admin/src/components/domain-check.tsx` *(créer)* | Le rendu des résultats et des enregistrements à créer. |
| `apps/admin/src/components/settings-environment.tsx` *(modifier)* | Corriger les trois textes devenus faux. |

---

## Task 1: Valider un hôte nu, côté backend

**Files:**
- Create: `packages/backend/convex/lib/hoteNu.ts`
- Test: `packages/backend/convex/lib/hoteNu.test.ts`

**Interfaces:**
- Produces: `export function estHoteNu(valeur: string): boolean`, `export function normaliserHote(valeur: string): string | null`

`normaliserHote` met en minuscules, retire les espaces et un point final, et rend `null` si le résultat n'est pas un hôte nu.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { estHoteNu, normaliserHote } from "./hoteNu"

describe("estHoteNu", () => {
  test("accepte un domaine ordinaire et un sous-domaine", () => {
    expect(estHoteNu("exemple.fr")).toBe(true)
    expect(estHoteNu("admin.exemple.fr")).toBe(true)
    expect(estHoteNu("a-b.exemple.co.uk")).toBe(true)
  })

  test("refuse tout ce qui n'est pas un hôte", () => {
    // Ce sont exactement les formes qui font lever `domainesAutorises`
    // dans `apps/web/src/lib/allowedDomains.ts` : un schéma, un port ou un
    // chemin produisent un motif qu'Astro n'appariera jamais, donc une
    // validation d'hôte silencieusement inerte.
    for (const mauvais of [
      "https://exemple.fr",
      "exemple.fr:4321",
      "exemple.fr/chemin",
      "*.exemple.fr",
      "exemple",
      "",
      "   ",
      "-exemple.fr",
      "exemple-.fr",
    ]) {
      expect(estHoteNu(mauvais), mauvais).toBe(false)
    }
  })
})

describe("normaliserHote", () => {
  test("met en minuscules, retire les espaces et le point final", () => {
    expect(normaliserHote("  Exemple.FR.  ")).toBe("exemple.fr")
  })

  test("rend null quand la valeur n'est pas récupérable", () => {
    expect(normaliserHote("https://exemple.fr")).toBeNull()
    expect(normaliserHote("")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Depuis `packages/backend` :
`/Users/antoinevigneau/.nvm/versions/node/v22.21.1/bin/node node_modules/vitest/vitest.mjs run convex/lib/hoteNu.test.ts`
Attendu : ÉCHEC, « Failed to resolve import "./hoteNu" ».

- [ ] **Step 3: Write minimal implementation**

```ts
// Valider un hôte nu, côté backend.
//
// Duplication ASSUMÉE de `HOTE_NU` (`apps/web/src/lib/allowedDomains.ts`).
// `packages/backend` n'importe pas `apps/web` — la frontière est tenue par
// une règle ESLint (invariant 1) —, et une dépendance croisée pour une
// expression régulière coûterait plus cher que la copie. Les deux tests
// pointent la même liste de formes refusées : si l'une change, l'autre
// doit changer, et la divergence se voit à la relecture.
//
// « Nu » veut dire : ni schéma, ni port, ni chemin, ni joker. C'est ce que
// `WEB_DOMAIN` vaut dans `docker/.env`, et ce qu'Astro attend dans
// `security.allowedDomains`.
const HOTE_NU = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function estHoteNu(valeur: string): boolean {
  return HOTE_NU.test(valeur)
}

/**
 * L'hôte tel qu'on le comparera et l'interrogera, ou `null`.
 *
 * Le point final est légal en DNS (`exemple.fr.` est la forme absolue) et
 * se colle facilement à un copier-coller depuis une zone. Le garder ferait
 * échouer la comparaison avec `WEB_DOMAIN` sur un caractère invisible.
 */
export function normaliserHote(valeur: string): string | null {
  const nettoye = valeur.trim().toLowerCase().replace(/\.$/, "")
  return estHoteNu(nettoye) ? nettoye : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Même commande. Attendu : PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/hoteNu.ts packages/backend/convex/lib/hoteNu.test.ts
git commit -m "feat(dns): validate a bare host on the backend side"
```

---

## Task 2: Le client DNS-over-HTTPS

**Files:**
- Create: `packages/backend/convex/lib/doh.ts`
- Test: `packages/backend/convex/lib/doh.test.ts`

**Interfaces:**
- Consumes: `estHoteNu` de `lib/hoteNu.ts`
- Produces:
  - `export const RESOLVEUR = "https://cloudflare-dns.com/dns-query"`
  - `export type TypeDns = "A" | "AAAA" | "TXT" | "CNAME" | "MX"`
  - `export type ReponseDns = { statut: "ok"; valeurs: string[] } | { statut: "absent" } | { statut: "erreur"; raison: string }`
  - `export function urlRequete(nom: string, type: TypeDns): string`
  - `export function lireReponse(charge: unknown): ReponseDns`
  - `export async function resoudre(nom: string, type: TypeDns): Promise<ReponseDns>`

`urlRequete` et `lireReponse` sont pures et testées seules ; `resoudre` les assemble autour d'un `fetch`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest"
import { lireReponse, resoudre, urlRequete } from "./doh"

describe("urlRequete", () => {
  test("demande du JSON au résolveur, sur le nom et le type donnés", () => {
    const url = new URL(urlRequete("exemple.fr", "TXT"))
    expect(url.origin).toBe("https://cloudflare-dns.com")
    expect(url.searchParams.get("name")).toBe("exemple.fr")
    expect(url.searchParams.get("type")).toBe("TXT")
  })

  test("refuse un nom qui n'est pas un hôte, plutôt que de l'envoyer", () => {
    // Le nom part dans une URL vers un tiers. Une valeur non validée y
    // ferait passer des paramètres de requête supplémentaires.
    expect(() => urlRequete("exemple.fr&name=autre.fr", "A")).toThrow()
  })
})

describe("lireReponse", () => {
  test("Status 0 avec des réponses rend les valeurs", () => {
    expect(lireReponse({ Status: 0, Answer: [{ data: "203.0.113.7" }] })).toEqual({
      statut: "ok",
      valeurs: ["203.0.113.7"],
    })
  })

  test("Status 3 (NXDOMAIN) est « absent », pas une erreur", () => {
    // La différence porte tout l'écran : « le domaine n'existe pas encore »
    // appelle une instruction à suivre, « le résolveur n'a pas répondu »
    // appelle un nouvel essai. Les confondre ferait dire à l'écran de
    // créer un enregistrement qui existe déjà.
    expect(lireReponse({ Status: 3 })).toEqual({ statut: "absent" })
  })

  test("Status 0 sans réponse est « absent »", () => {
    expect(lireReponse({ Status: 0, Answer: [] })).toEqual({ statut: "absent" })
  })

  test("retire les guillemets que le résolveur met autour d'un TXT", () => {
    // Un TXT SPF revient `"v=spf1 include:amazonses.com ~all"`, guillemets
    // compris. Comparer sans les retirer ne trouve jamais `v=spf1`.
    expect(
      lireReponse({ Status: 0, Answer: [{ data: '"v=spf1 include:x ~all"' }] }),
    ).toEqual({ statut: "ok", valeurs: ["v=spf1 include:x ~all"] })
  })

  test("une charge inattendue est une erreur nommée, jamais une exception", () => {
    expect(lireReponse(null)).toEqual({
      statut: "erreur",
      raison: "Réponse illisible du résolveur DNS.",
    })
  })
})

describe("resoudre", () => {
  test("un résolveur injoignable rend une erreur, jamais une exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom") }))
    await expect(resoudre("exemple.fr", "A")).resolves.toEqual({
      statut: "erreur",
      raison: "Le résolveur DNS est injoignable.",
    })
    vi.unstubAllGlobals()
  })

  test("un statut HTTP non 200 rend une erreur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })))
    await expect(resoudre("exemple.fr", "A")).resolves.toMatchObject({
      statut: "erreur",
    })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

`… vitest.mjs run convex/lib/doh.test.ts` — ÉCHEC, module introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
import { estHoteNu } from "./hoteNu"

// Interroger le DNS depuis Convex.
//
// Le runtime Convex par défaut est un isolat V8 : ni `node:dns`, ni
// `node:net`. Aucun fichier de ce dépôt ne porte `"use node"`, et en poser
// un pour une résolution DNS ferait basculer tout le module dans un
// runtime plus lent et différemment contraint. Le DNS passe donc par
// HTTPS, comme les six autres appels sortants du dépôt.
//
// Cloudflare plutôt que Google : c'est le seul des deux qui publie une
// politique de non-conservation des requêtes, et l'écran envoie le domaine
// de l'adoptant. Le choix est écrit ici plutôt que dans un réglage — un
// résolveur configurable serait une valeur saisie par l'opérateur vers
// laquelle on ferait des requêtes sortantes, donc une surface SSRF pour
// une souplesse dont personne n'a besoin.
export const RESOLVEUR = "https://cloudflare-dns.com/dns-query"

/** 8 s, la même borne que les appels Umami (`analytics.ts`). */
const DELAI_MS = 8_000

export type TypeDns = "A" | "AAAA" | "TXT" | "CNAME" | "MX"

export type ReponseDns =
  | { statut: "ok"; valeurs: string[] }
  /** Le nom ne porte pas cet enregistrement — réponse ordinaire, pas une panne. */
  | { statut: "absent" }
  | { statut: "erreur"; raison: string }

export function urlRequete(nom: string, type: TypeDns): string {
  // `estHoteNu` avant l'interpolation, et non `encodeURIComponent` : le nom
  // vient d'un champ de saisie et part vers un tiers. Une validation qui
  // n'accepte QUE la forme attendue vaut mieux qu'un échappement qui laisse
  // passer des formes qu'on n'a pas imaginées.
  if (!estHoteNu(nom)) throw new Error(`Nom DNS invalide : ${nom}`)
  return `${RESOLVEUR}?name=${nom}&type=${type}`
}

export function lireReponse(charge: unknown): ReponseDns {
  if (typeof charge !== "object" || charge === null) {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
  const objet = charge as { Status?: unknown; Answer?: unknown }
  if (typeof objet.Status !== "number") {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
  // 3 = NXDOMAIN. 0 sans réponse = le nom existe mais pas ce type.
  if (objet.Status === 3) return { statut: "absent" }
  if (objet.Status !== 0) {
    return { statut: "erreur", raison: `Le résolveur DNS a répondu ${objet.Status}.` }
  }
  const reponses = Array.isArray(objet.Answer) ? objet.Answer : []
  const valeurs = reponses
    .map((ligne) => (ligne as { data?: unknown }).data)
    .filter((data): data is string => typeof data === "string")
    // Un TXT long est découpé en segments guillemetés et concaténés par le
    // résolveur : `"v=spf1 " "include:x ~all"`. On retire les guillemets et
    // on recolle, sinon aucune comparaison ne trouve jamais rien.
    .map((data) => data.replace(/"\s*"/g, "").replace(/^"|"$/g, "").trim())
    .filter((valeur) => valeur.length > 0)
  return valeurs.length === 0 ? { statut: "absent" } : { statut: "ok", valeurs }
}

export async function resoudre(nom: string, type: TypeDns): Promise<ReponseDns> {
  let reponse: Response
  try {
    reponse = await fetch(urlRequete(nom, type), {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DELAI_MS),
    })
  } catch {
    // Le nom invalide lève aussi ici. Dans les deux cas l'écran doit
    // afficher une ligne, jamais faire tomber la vérification entière.
    return { statut: "erreur", raison: "Le résolveur DNS est injoignable." }
  }
  if (!reponse.ok) {
    return { statut: "erreur", raison: `Le résolveur DNS a répondu ${reponse.status}.` }
  }
  try {
    return lireReponse(await reponse.json())
  } catch {
    return { statut: "erreur", raison: "Réponse illisible du résolveur DNS." }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Même commande. Attendu : PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/doh.ts packages/backend/convex/lib/doh.test.ts
git commit -m "feat(dns): query DNS over HTTPS, since the Convex runtime has no resolver"
```

---

## Task 3: Stocker le domaine déclaré

**Files:**
- Modify: `packages/backend/convex/schema.ts` (table `settings`, ligne ~304-352)
- Modify: `packages/backend/convex/settings.ts` (`getPrivate` ~126-164, `update` ~327-368)
- Test: `packages/backend/convex/settings.test.ts`, `packages/backend/convex/settings.publicProjection.test.ts`

**Interfaces:**
- Consumes: `normaliserHote` de `lib/hoteNu.ts`
- Produces: `settings.getPrivate` rend `declaredDomain: string | null` ; `settings.update` accepte `declaredDomain: v.optional(v.union(v.string(), v.null()))`

- [ ] **Step 1: Write the failing test**

Dans `settings.test.ts` :

```ts
test("declaredDomain n'accepte qu'un hôte nu, et une chaîne vide l'efface", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, { declaredDomain: "  Exemple.FR.  " })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.declaredDomain).toBe(
    "exemple.fr",
  )

  await expect(
    owner.identity.mutation(api.settings.update, { declaredDomain: "https://exemple.fr" }),
  ).rejects.toThrow()

  await owner.identity.mutation(api.settings.update, { declaredDomain: null })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.declaredDomain).toBeNull()
})
```

Dans `settings.publicProjection.test.ts`, ajouter `declaredDomain` aux champs semés par la fixture (elle sème désormais la ligne entière) et vérifier qu'il **n'apparaît pas** dans `settings.get`.

- [ ] **Step 2: Run test to verify it fails**

`… vitest.mjs run convex/settings.test.ts` — ÉCHEC : `declaredDomain` n'est pas un argument accepté.

- [ ] **Step 3: Write minimal implementation**

Dans `schema.ts`, table `settings`, à la suite de `emailFrom` :

```ts
    /**
     * Le domaine que l'opérateur DIT avoir déployé.
     *
     * Ne pilote rien : le domaine réel est figé au build
     * (`security.allowedDomains`) et posé au runtime par Traefik. Cette
     * valeur sert à deux choses, et à deux choses seulement — vérifier le
     * DNS, et détecter que l'opérateur croit avoir déployé autre chose que
     * ce que l'image contient.
     */
    declaredDomain: v.optional(v.string()),
```

Dans `settings.ts`, `getPrivate`, à côté de `emailFrom` :

```ts
      declaredDomain: settings.declaredDomain ?? null,
```

Dans les arguments de `update` :

```ts
    // `| null` explicite, comme `leadWebhookUrl` : absent veut dire « laisse
    // tel quel », `null` veut dire « efface ». Une chaîne vide serait la
    // troisième façon de dire l'une des deux, donc la source du prochain
    // malentendu.
    declaredDomain: v.optional(v.union(v.string(), v.null())),
```

Dans le corps de `update`, avant l'écriture :

```ts
    if (args.declaredDomain !== undefined && args.declaredDomain !== null) {
      const hote = normaliserHote(args.declaredDomain)
      if (hote === null) {
        throw new ConvexError({ code: "INVALID_DOMAIN", field: "declaredDomain" })
      }
      args = { ...args, declaredDomain: hote }
    }
```

- [ ] **Step 4: Run test to verify it passes**

`… vitest.mjs run convex/settings.test.ts convex/settings.publicProjection.test.ts` — PASS.

- [ ] **Step 5: Vérifier le déploiement réel**

```bash
cd packages/backend && npx convex dev --once
```

Attendu : le schéma élargi est accepté. `declaredDomain` est `v.optional`, donc additif — aucune ligne existante n'est invalidée (invariant 6, étape *expand*).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/settings.ts \
        packages/backend/convex/settings.test.ts \
        packages/backend/convex/settings.publicProjection.test.ts
git commit -m "feat(settings): store the domain the operator says they deployed"
```

---

## Task 4: Les deux vérifications DNS

**Files:**
- Create: `packages/backend/convex/dns.ts`
- Create: `packages/backend/convex/dns.test.ts`
- Modify: `packages/backend/convex/_registry.ts`

**Interfaces:**
- Consumes: `resoudre`, `normaliserHote`
- Produces:
  - `export type Verdict = { cle: string; libelle: string; attendu: string; trouve: string[]; etat: "ok" | "manquant" | "different" | "indisponible"; instruction: string }`
  - `export const checkSite = action({ args: { domaine: v.string() }, ... }): Promise<Verdict[]>`
  - `export const checkEmail = action({ args: { domaine: v.string() }, ... }): Promise<Verdict[]>`

**Ce que chaque vérification demande :**

| Clé | Nom interrogé | Type | Attendu |
|---|---|---|---|
| `site` | `<domaine>` | A | une adresse IPv4 quelconque, non privée |
| `admin` | `admin.<domaine>` | A | idem |
| `spf` | `<domaine>` | TXT | un enregistrement commençant par `v=spf1` et contenant `amazonses.com` |
| `dkim` | `resend._domainkey.<domaine>` | TXT | un enregistrement commençant par `p=` ou `v=DKIM1` |
| `dmarc` | `_dmarc.<domaine>` | TXT | un enregistrement commençant par `v=DMARC1` |

- [ ] **Step 1: Write the failing test**

```ts
import { convexTest } from "convex-test"
import { expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { makeTestConvex, seedActor } from "../testing/harness"

/** Un faux résolveur : une réponse par nom+type demandé. */
function stubDns(reponses: Record<string, string[]>) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url))
    const cle = `${u.searchParams.get("name")}/${u.searchParams.get("type")}`
    const valeurs = reponses[cle]
    return new Response(
      JSON.stringify(
        valeurs === undefined
          ? { Status: 3 }
          : { Status: 0, Answer: valeurs.map((data) => ({ data })) },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
}

test("checkSite : A présent sur les deux hôtes rend deux verdicts ok", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({ "exemple.fr/A": ["203.0.113.7"], "admin.exemple.fr/A": ["203.0.113.7"] }),
  )
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["site", "ok"],
    ["admin", "ok"],
  ])
  vi.unstubAllGlobals()
})

test("checkSite : un enregistrement absent porte l'instruction à suivre", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["203.0.113.7"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  const ligne = verdicts.find((v) => v.cle === "admin")!
  expect(ligne.etat).toBe("manquant")
  // L'écran n'a pas à composer la phrase : le verdict la porte, pour que
  // la formulation soit testée plutôt que rendue.
  expect(ligne.instruction).toContain("admin")
  vi.unstubAllGlobals()
})

test("checkSite : une adresse privée n'est pas un site joignable", async () => {
  // Un A qui pointe vers 192.168.x.x est une erreur de configuration
  // fréquente derrière un routeur domestique. « ok » ici enverrait
  // l'adoptant chercher ailleurs pendant des heures.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", stubDns({ "exemple.fr/A": ["192.168.1.10"] }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.find((v) => v.cle === "site")!.etat).toBe("different")
  vi.unstubAllGlobals()
})

test("checkEmail : SPF, DKIM et DMARC, chacun sa ligne", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal(
    "fetch",
    stubDns({
      "exemple.fr/TXT": ['"v=spf1 include:amazonses.com ~all"'],
      "resend._domainkey.exemple.fr/TXT": ['"p=MIGfMA0G"'],
    }),
  )
  const verdicts = await admin.identity.action(api.dns.checkEmail, { domaine: "exemple.fr" })
  expect(verdicts.map((v) => [v.cle, v.etat])).toEqual([
    ["spf", "ok"],
    ["dkim", "ok"],
    ["dmarc", "manquant"],
  ])
  vi.unstubAllGlobals()
})

test("un résolveur en panne rend « indisponible », jamais « manquant »", async () => {
  // La distinction décide de ce que l'adoptant fait ensuite : « manquant »
  // veut dire « créez cet enregistrement », « indisponible » veut dire
  // « réessayez ». Les confondre fait créer un doublon.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau") }))
  const verdicts = await admin.identity.action(api.dns.checkSite, { domaine: "exemple.fr" })
  expect(verdicts.every((v) => v.etat === "indisponible")).toBe(true)
  vi.unstubAllGlobals()
})

test("un editor ne peut pas lancer la vérification", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.action(api.dns.checkSite, { domaine: "exemple.fr" }),
  ).rejects.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

`… vitest.mjs run convex/dns.test.ts` — ÉCHEC, `api.dns` n'existe pas.

- [ ] **Step 3: Write minimal implementation**

Points structurants à respecter dans `dns.ts` :

- `requireRole(ctx, ["owner", "admin"])` en tête des deux actions. Un editor ne configure pas le domaine, et la vérification déclenche des appels sortants.
- `normaliserHote(args.domaine)` d'abord ; un domaine invalide lève `ConvexError({ code: "INVALID_DOMAIN" })` **avant** tout `fetch`.
- Les cinq requêtes d'une même vérification partent par `Promise.all` : elles sont indépendantes, et les enchaîner ferait attendre cinq fois le délai en cas de panne.
- Réutiliser la détection d'adresse privée de `lib/webhookUrl.ts` pour l'état `different` du A. **Ne pas appeler `refuseWebhookUrl` directement** : elle exige `https:` (`webhookUrl.ts:102`) et refuserait un hôte nu. Extraire la partie « cette IPv4 est-elle privée ? » dans une fonction exportée de `lib/webhookUrl.ts`, et l'importer — une seconde copie de la liste des plages privées est exactement ce que ce dépôt a déjà payé.
- Chaque `Verdict` porte `instruction`, la phrase exacte à suivre, avec le **type**, le **nom** et la **valeur** de l'enregistrement à créer.

- [ ] **Step 4: Run test to verify it passes**

`… vitest.mjs run convex/dns.test.ts` — PASS, 6 tests.

- [ ] **Step 5: Déclarer les deux actions au registre**

`_registry.test.ts` exige l'égalité **stricte dans les deux sens** et compte les actions publiques depuis son élargissement. Ajouter dans `_registry.ts` :

```ts
  "dns:checkSite": { allowedRoles: ["owner", "admin"] },
  "dns:checkEmail": { allowedRoles: ["owner", "admin"] },
```

- [ ] **Step 6: Run the whole backend suite**

`… vitest.mjs run` depuis `packages/backend`. Attendu : tout vert, `_registry.test.ts` et `lib/authz.test.ts` compris.

- [ ] **Step 7: Vérifier le déploiement réel**

```bash
cd packages/backend && npx convex dev --once
```

`dns.ts` est un nouveau point d'entrée de déploiement : c'est exactement le cas où `tsc` ne voit pas ce que le runtime refuse.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/dns.ts packages/backend/convex/dns.test.ts \
        packages/backend/convex/_registry.ts packages/backend/convex/lib/webhookUrl.ts
git commit -m "feat(dns): check the site and email records for a declared domain"
```

---

## Task 5: L'écran

**Files:**
- Rewrite: `apps/admin/src/routes/_authed/settings/domaine.tsx`
- Create: `apps/admin/src/components/domain-check.tsx`
- Test: `apps/admin/src/components/domain-check.test.tsx`

**Interfaces:**
- Consumes: `settings.getPrivate().declaredDomain`, `settings.update`, `api.dns.checkSite`, `api.dns.checkEmail`, `settings.environment` (pour le domaine figé au build)

**La forme de l'écran, de haut en bas :**

1. **Un champ**, « Votre nom de domaine », avec l'exemple `exemple.fr` en `placeholder` et la seule règle en aide : sans `https://`, sans `www`.
2. **La barre d'enregistrement collante**, motif `webhook.tsx` : `SettingsFormShell` avec `useAutoSave({ auto: {}, manual: { declaredDomain } })`. La sauvegarde automatique est **désarmée** — `snapshotChanged({}, {})` est toujours faux — parce qu'un domaine à moitié tapé (`exemple.f`) déclencherait une vérification DNS sur un nom qui n'est pas le sien. `saveAuto` **lève** plutôt que de ne rien faire, pour qu'une régression future s'affiche.
3. **Un bouton « Vérifier »**, actif seulement quand le domaine enregistré est non vide et qu'aucune vérification n'est en cours.
4. **Les résultats**, une ligne par verdict, groupés « Le site » / « Les emails », avec pour chaque ligne manquante le type, le nom et la valeur à créer, et un bouton de copie.
5. **L'avertissement de divergence**, quand `declaredDomain` diffère du domaine figé au build (lu par `settings.environment`) : « Cette image a été construite pour `<autre>`. Tant que les deux diffèrent, la limitation de débit du site compte tous les visiteurs comme un seul. » — c'est la conséquence réelle, mesurée, de `astro.config.ts:45`.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ResultatsDns } from "./domain-check"

const OK = { cle: "site", libelle: "Le site", attendu: "Une adresse IPv4", trouve: ["203.0.113.7"], etat: "ok" as const, instruction: "" }
const MANQUANT = { cle: "dmarc", libelle: "DMARC", attendu: "v=DMARC1", trouve: [], etat: "manquant" as const, instruction: "Créez un TXT sur _dmarc.exemple.fr valant v=DMARC1; p=none" }

describe("ResultatsDns", () => {
  test("une ligne manquante affiche l'enregistrement à créer", () => {
    const html = renderToStaticMarkup(<ResultatsDns verdicts={[MANQUANT]} />)
    expect(html).toContain("_dmarc.exemple.fr")
    expect(html).toContain("v=DMARC1")
  })

  test("une ligne satisfaite n'affiche aucune instruction", () => {
    // Une instruction affichée à côté d'une coche verte fait douter de la
    // coche, et fait recréer un enregistrement qui existe.
    const html = renderToStaticMarkup(<ResultatsDns verdicts={[OK]} />)
    expect(html).not.toContain("Créez")
  })

  test("« indisponible » ne dit pas de créer quoi que ce soit", () => {
    const html = renderToStaticMarkup(
      <ResultatsDns verdicts={[{ ...MANQUANT, etat: "indisponible" }]} />,
    )
    expect(html).not.toContain("Créez")
    expect(html).toMatch(/réessay/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Depuis `apps/admin` : `… vitest.mjs run src/components/domain-check.test.tsx` — ÉCHEC.

- [ ] **Step 3: Write minimal implementation**

`domain-check.tsx` rend le tableau ; `domaine.tsx` compose le champ, `SettingsFormShell` et le bouton.

- [ ] **Step 4: Run test to verify it passes**

PASS, 3 tests.

- [ ] **Step 5: Vérifier à l'écran**

Ouvrir `/settings/domaine`, saisir un domaine, enregistrer, vérifier. Contrôler que la barre d'enregistrement **colle en bas** pendant le défilement — c'est le comportement que `SettingsFormShell` apporte et que cet écran n'avait pas.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/routes/_authed/settings/domaine.tsx \
        apps/admin/src/components/domain-check.tsx \
        apps/admin/src/components/domain-check.test.tsx
git commit -m "feat(settings): make the domain screen a checker that tells you what to create"
```

---

## Task 6: Corriger les trois textes devenus faux

**Files:**
- Modify: `apps/admin/src/components/settings-environment.tsx`
- Modify: `apps/admin/src/components/settings-environment.test.tsx`

Trois affirmations de l'écran sont fausses, et **deux sont épinglées par des tests** qui échoueront quand on corrigera le texte — les mettre à jour fait partie de la tâche, pas après.

| Ligne | Ce qu'elle dit | Pourquoi c'est faux | Test épinglant |
|---|---|---|---|
| `settings-environment.tsx:218-225` | « seule la variable d'environnement est lue » pour Resend | `lib/resend.ts:34` appelle `lireSecret` : la base est lue | `settings-environment.test.tsx:292` |
| `settings-environment.tsx:379-386` | idem pour Umami | `analytics.ts:115-118` appelle `lireSecret` | — |
| `settings-environment.tsx:253-258` | l'adresse d'expédition est « écrite dans le code » de `leads.ts` / `invitations.ts` | elle vit dans `lib/expediteur.ts:11`, et c'est un **repli** que `settings.emailFrom` remplace | `settings-environment.test.tsx:295-301` |

Le paragraphe « trois endroits » (`:190-199`) devient **cinq** et déménage sur le nouvel écran, à côté du champ : c'est là que quelqu'un le cherchera.

- [ ] **Step 1: Corriger les textes, faire échouer les tests épinglants**

`… vitest.mjs run src/components/settings-environment.test.tsx` — ÉCHEC attendu sur les deux `expect(rendu).toMatch(...)`.

- [ ] **Step 2: Mettre les tests à jour sur la phrase vraie**

Épingler la formulation corrigée, pas la retirer : ces deux tests existent parce que le dépôt a déjà laissé un écran mentir.

- [ ] **Step 3: Run the admin suite**

`… vitest.mjs run` depuis `apps/admin` — tout vert.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/settings-environment.tsx \
        apps/admin/src/components/settings-environment.test.tsx
git commit -m "fix(settings): three help texts described behaviour the code no longer has"
```

---

## Self-Review

**Couverture :** la saisie du domaine (T3, T5), la validation (T1), la vérification site (T4), la vérification emails (T4), les instructions DNS (T4 `instruction` + T5), la barre collante (T5), le nettoyage du texte (T6).

**Ce que ce plan ne fait PAS, et qui doit être dit à l'adoptant :** vérifier le DNS ne déploie rien. Après un changement de domaine il reste cinq gestes, dont deux rebuilds. L'écran les affiche ; il ne les exécute pas. Les automatiser voudrait dire déclencher un workflow GitHub depuis Convex, ce qui demande un jeton d'API GitHub en base — hors périmètre, et hors invariant 7 tel qu'il est écrit aujourd'hui.

**Types :** `Verdict` est produit par T4 et consommé par T5 sous le même nom. `normaliserHote` est produit par T1 et consommé par T2 et T3.
