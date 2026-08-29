# Finitions et durcissement — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** finir ce qui a été demandé et laissé à moitié, débloquer la mise en production, et fermer les constats de la revue de sécurité qui restent ouverts.

**Architecture :** aucune brique nouvelle. Chaque tâche referme un écart entre ce que le produit *affirme* et ce qu'il *fait* — une durée annoncée que rien n'applique, un réglage qui ne règle rien, une garantie que seule la discipline tient. Les corrections vont là où l'écart se fabrique, pas là où il se voit.

**Pile :** Astro 7 (`apps/web`), TanStack Start + React 19 (`apps/admin`), Convex (`packages/backend`), Docker + Traefik (`docker/`).

**Spec :** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md) et [`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`](../specs/2026-08-29-secrets-et-chiffrement.md)

## Contraintes globales

Elles s'appliquent à **toutes** les tâches. Les relire avant chaque tâche.

- **Environnement :** `export PATH="/opt/homebrew/bin:$PATH"` puis `corepack pnpm@10`. Convex CLI via `/opt/homebrew/bin/npx convex`. Un `convex dev` tourne déjà — ne pas en lancer un second.
- **Après toute modification de `packages/backend/convex/` : push Convex réel obligatoire** (`npx convex codegen` depuis `packages/backend`). `tsc` et vitest ne voient pas ce que le runtime Convex refuse. Ce piège a été payé plusieurs fois.
- **Références actuelles, qui montent et ne baissent jamais :** 694 tests backend, 222 admin, 135 web.
- **Tout fichier à nom simple sous `convex/` est un point d'entrée de déploiement.** Les helpers de test vivent dans `packages/backend/testing/`, jamais sous `convex/`. Seuls les `*.test.ts` sont exclus du bundle.
- **Toute mutation OU action publique doit être déclarée dans `MUTATION_REGISTRY`** (`convex/_registry.ts`), sinon `_registry.test.ts` échoue.
- **Toute query publique** dont la forme d'arguments est inconnue fait échouer `convex/pages.publicQueryFamily.test.ts` — lui enseigner la forme, ne pas contourner.
- **`settings.get` est une query publique** appelée par le site sans session. Ne jamais y ajouter de secret ; sa projection explicite est ce qui a fermé une fuite.
- TDD : test qui échoue, implémentation minimale, test qui passe, commit.
- Commits en anglais, format Conventional Commits. Commentaires de code en français.
- **Astro avale l'espace en fin de ligne avant un élément :** `dans la\n<a>` rend « lapolitique ». Écrire `dans la{" "}`.

---

## Structure des fichiers

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `apps/admin/src/routes/_authed/settings/identite.tsx` | `ImageField` montre l'image réellement servie | 1 |
| `packages/backend/convex/lib/expediteur.ts` | **créé** — l'adresse d'expédition, à un seul endroit | 2 |
| `packages/backend/convex/settings.ts` | champ `emailFrom`, projeté explicitement | 2 |
| `apps/web/src/middleware.ts` | en-têtes de sécurité et CSP à nonce | 4 |
| `apps/web/src/lib/securityHeaders.ts` | **créé** — la politique, pure et testée | 4 |
| `packages/backend/convex/auditLog.ts` | **créé** — le journal des gestes sensibles | 5 |
| `packages/backend/convex/lib/auditEvent.ts` | **créé** — la forme d'un événement, pure | 5 |
| `apps/web/src/pages/api/consent.ts` | limite de débit | 7 |
| `docker/docker-compose.yml` | purge de rétention Umami | 8 |
| `.github/workflows/ci.yml` | `pnpm audit` en garde-fou | 9 |

---

## Tâche 1 : le champ image montre ce que le site sert

**Le défaut, en une phrase :** quand `settings.logoId` pointe sur un fichier disparu, l'écran affiche un mur rouge et un cadre vide — alors que le site, lui, sert le logo du dépôt. Il n'y a jamais « pas de logo ».

**Fichiers :**
- Modifier : `apps/admin/src/routes/_authed/settings/identite.tsx` (fonction `ImageField`, branche `introuvable`)
- Test : `apps/admin/src/routes/_authed/settings/identite.test.tsx` (créer)

**Interfaces :**
- Consomme : `api.media.publicUrl` (existante), `defaultLogo` / `defaultIcon` importés depuis `@/assets/`
- Produit : rien que d'autres tâches consomment

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `apps/admin/src/routes/_authed/settings/identite.test.tsx` :

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { EtatImage } from "./identite"

describe("EtatImage", () => {
  test("sans réglage, annonce l'image du dépôt", () => {
    const html = renderToStaticMarkup(<EtatImage etat="defaut" noun="logo" />)
    expect(html).toContain("du dépôt")
    expect(html).not.toContain("n'existe plus")
  })

  test("référence morte : dit ce qui s'est passé ET ce que le site sert", () => {
    // Le défaut corrigé : le message remplaçait l'image. Or il y a toujours
    // un logo en ligne — celui du dépôt — et l'écran doit le montrer.
    const html = renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />)
    expect(html).toContain("n'existe plus")
    expect(html).toContain("du dépôt")
  })

  test("le ton n'est pas alarmant : ce n'est pas une panne du site", () => {
    // Rouge sur toute la largeur laissait croire que le site était cassé.
    const html = renderToStaticMarkup(<EtatImage etat="introuvable" noun="logo" />)
    expect(html).not.toContain("text-destructive")
  })
})
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd apps/admin && corepack pnpm@10 exec vitest run src/routes/_authed/settings/identite.test.tsx
```

Attendu : ÉCHEC — `EtatImage` n'est pas exporté.

- [ ] **Étape 3 : extraire et exporter `EtatImage`**

Dans `identite.tsx`, ajouter au-dessus de `ImageField` :

```tsx
/**
 * Ce que l'écran dit de l'image en cours, selon son état.
 *
 * Trois états et non deux : « aucun réglage » et « le fichier réglé a
 * disparu » demandent le même geste mais ne se sont pas produits pour la
 * même raison, et seule la seconde mérite d'être expliquée.
 *
 * Dans les DEUX cas, le site sert l'image du dépôt. C'est ce qui manquait :
 * un message rouge occupant la place de l'image laissait croire qu'aucun
 * logo n'était en ligne, alors qu'il y en a toujours un.
 */
export function EtatImage({
  etat,
  noun,
}: {
  etat: "defaut" | "introuvable"
  noun: string
}) {
  if (etat === "defaut") {
    return (
      <span className="text-sm text-muted-foreground">
        Aucun {noun} choisi : le site sert celui du dépôt.
      </span>
    )
  }
  return (
    <span className="text-sm text-muted-foreground">
      Le fichier choisi n'existe plus dans le stockage — supprimé ou remplacé
      depuis. Le site sert le {noun} du dépôt en attendant ; choisissez-en un
      autre, ou retirez le réglage.
    </span>
  )
}
```

- [ ] **Étape 4 : montrer l'image du dépôt aussi quand la référence est morte**

Dans `ImageField`, remplacer la branche `introuvable` pour qu'elle rende **la même image de repli** que la branche `value === null`, suivie de `<EtatImage etat="introuvable" noun={noun} />`. Le gabarit gris vide disparaît.

- [ ] **Étape 5 : lancer les tests, vérifier qu'ils passent**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd apps/admin && corepack pnpm@10 exec vitest run && corepack pnpm@10 exec tsc --noEmit && corepack pnpm@10 exec eslint src
```

Attendu : 225 tests, `tsc` et `eslint` sans erreur.

- [ ] **Étape 6 : commit**

```bash
git add apps/admin/src/routes/_authed/settings/identite.tsx apps/admin/src/routes/_authed/settings/identite.test.tsx
git commit -m "fix(settings): show the image the site actually serves, dead reference or not

A stored logo id whose file no longer exists produced a red wall where the
image should be. But the site never serves nothing — it falls back to the
repository logo — so the screen was describing a state that does not exist.
Both the missing-setting and dead-reference cases now show that fallback,
and only the second one explains itself."
```

---

## Tâche 2 : l'adresse d'expédition cesse d'être en dur

**Le défaut :** `AstroTan <onboarding@resend.dev>` est écrit en dur dans deux fichiers. C'est le bac à sable de Resend : **en production, aucune invitation ni notification n'arrive**, et rien à l'écran ne le dit.

**Fichiers :**
- Créer : `packages/backend/convex/lib/expediteur.ts`
- Créer : `packages/backend/convex/lib/expediteur.test.ts`
- Modifier : `packages/backend/convex/schema.ts` (table `settings`, champ `emailFrom`)
- Modifier : `packages/backend/convex/settings.ts` (`update`, et la projection de `get`)
- Modifier : `packages/backend/convex/invitations.ts:242`, `packages/backend/convex/leads.ts:771`

**Interfaces :**
- Produit : `resoudreExpediteur(ctx: ActionCtx): Promise<string>` — l'adresse à mettre dans `from`
- Produit : `EXPEDITEUR_BAC_A_SABLE = "AstroTan <onboarding@resend.dev>"`

- [ ] **Étape 1 : écrire le test qui échoue**

`packages/backend/convex/lib/expediteur.test.ts` :

```ts
import { describe, expect, test } from "vitest"
import { EXPEDITEUR_BAC_A_SABLE, choisirExpediteur, estAdresseValide } from "./expediteur"

describe("choisirExpediteur", () => {
  test("sans réglage, retombe sur le bac à sable de Resend", () => {
    // Et surtout pas sur une adresse inventée : le bac à sable ne délivre
    // qu'aux adresses de test de Resend, ce qui est un échec VISIBLE. Une
    // adresse plausible sur un domaine non vérifié échoue en silence.
    expect(choisirExpediteur(undefined)).toBe(EXPEDITEUR_BAC_A_SABLE)
    expect(choisirExpediteur("")).toBe(EXPEDITEUR_BAC_A_SABLE)
    expect(choisirExpediteur("   ")).toBe(EXPEDITEUR_BAC_A_SABLE)
  })

  test("une adresse réglée est utilisée telle quelle", () => {
    expect(choisirExpediteur("AstroTan <bonjour@exemple.fr>")).toBe(
      "AstroTan <bonjour@exemple.fr>"
    )
  })

  test("une valeur qui n'est pas une adresse retombe sur le bac à sable", () => {
    // Un `from` malformé fait échouer l'envoi côté Resend, sans que
    // personne ne sache pourquoi. Mieux vaut le repli visible.
    expect(choisirExpediteur("pas une adresse")).toBe(EXPEDITEUR_BAC_A_SABLE)
  })
})

describe("estAdresseValide", () => {
  test("accepte les deux formes que Resend accepte", () => {
    expect(estAdresseValide("bonjour@exemple.fr")).toBe(true)
    expect(estAdresseValide("AstroTan <bonjour@exemple.fr>")).toBe(true)
  })

  test("refuse ce qui n'a ni arobase ni domaine", () => {
    expect(estAdresseValide("bonjour")).toBe(false)
    expect(estAdresseValide("bonjour@")).toBe(false)
    expect(estAdresseValide("@exemple.fr")).toBe(false)
  })
})
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd packages/backend && corepack pnpm@10 exec vitest run convex/lib/expediteur.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : écrire `lib/expediteur.ts`**

```ts
import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"

// L'adresse d'expédition, décidée à un seul endroit.
//
// Elle était écrite en dur dans `invitations.ts` et `leads.ts`, sur
// `onboarding@resend.dev` — le BAC À SABLE de Resend, qui ne délivre qu'aux
// adresses de test du service. En production, aucune invitation et aucune
// notification n'arrivait, et rien ne le disait.

export const EXPEDITEUR_BAC_A_SABLE = "AstroTan <onboarding@resend.dev>"

/** `bonjour@exemple.fr` ou `Nom <bonjour@exemple.fr>`, les deux formes que Resend accepte. */
export function estAdresseValide(valeur: string): boolean {
  const brut = valeur.trim()
  const adresse = brut.includes("<") ? (brut.split("<")[1]?.split(">")[0] ?? "") : brut
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(adresse)
}

/**
 * L'adresse à utiliser, avec repli VISIBLE.
 *
 * Le repli est le bac à sable et non une adresse plausible : le bac à sable
 * échoue de façon voyante (rien n'arrive sauf aux adresses de test), là où
 * un domaine non vérifié échoue en silence côté Resend.
 */
export function choisirExpediteur(regle: string | undefined): string {
  const brut = regle?.trim() ?? ""
  if (brut.length === 0 || !estAdresseValide(brut)) return EXPEDITEUR_BAC_A_SABLE
  return brut
}

/** La même décision, avec la lecture du réglage. */
export async function resoudreExpediteur(ctx: ActionCtx): Promise<string> {
  const regle = await ctx.runQuery(internal.settings.expediteur, {})
  return choisirExpediteur(regle ?? undefined)
}
```

- [ ] **Étape 4 : ajouter le champ au schéma et à `settings`**

Dans `schema.ts`, table `settings`, ajouter — **additif, jamais destructif** (discipline expand/migrate/contract) :

```ts
    // L'adresse d'expédition des emails. PAS un secret : elle apparaît dans
    // l'en-tête de chaque message envoyé. Elle peut donc rester dans
    // `settings`, contrairement aux jetons.
    emailFrom: v.optional(v.string()),
```

Dans `settings.ts` : ajouter `emailFrom` à la projection explicite de `get`, l'accepter dans `update`, et créer :

```ts
/** Lecture interne pour les actions d'envoi. Jamais publique : inutile au navigateur. */
export const expediteur = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("settings").first())?.emailFrom ?? null,
})
```

- [ ] **Étape 5 : brancher les deux appelants**

`invitations.ts:242` et `leads.ts:771` : remplacer le littéral par

```ts
      from: await resoudreExpediteur(ctx),
```

- [ ] **Étape 6 : lancer les tests et pousser sur Convex**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd packages/backend && \
  corepack pnpm@10 exec vitest run && \
  corepack pnpm@10 exec tsc --noEmit && \
  /opt/homebrew/bin/npx convex codegen
```

Attendu : 700 tests, `tsc` propre, push accepté.

- [ ] **Étape 7 : commit**

```bash
git add packages/backend/convex/lib/expediteur.ts packages/backend/convex/lib/expediteur.test.ts packages/backend/convex/schema.ts packages/backend/convex/settings.ts packages/backend/convex/invitations.ts packages/backend/convex/leads.ts
git commit -m "feat(email): make the sender address a setting instead of a literal

Both send paths hard-coded Resend's sandbox address, which only delivers to
Resend's own test addresses. In production no invitation and no lead
notification arrived, and nothing said so. The fallback stays the sandbox
rather than a plausible address: the sandbox fails visibly, an unverified
domain fails silently."
```

---

## Tâche 3 : les en-têtes de sécurité et la CSP

**Le défaut :** le site n'envoie aucun en-tête de sécurité. Conséquence concrète : une image distante collée dans un article charge un tiers **hors du système de consentement** — la seule brèche que l'audit a laissée ouverte, faute de pouvoir la fermer côté code éditorial.

**Fichiers :**
- Créer : `apps/web/src/lib/securityHeaders.ts`
- Créer : `apps/web/src/lib/securityHeaders.test.ts`
- Modifier : `apps/web/src/middleware.ts`

**Interfaces :**
- Produit : `enTetesSecurite(nonce: string, env): Record<string, string>`
- Produit : `nouveauNonce(): string`

- [ ] **Étape 1 : écrire le test qui échoue**

`apps/web/src/lib/securityHeaders.test.ts` :

```ts
import { describe, expect, test } from "vitest"
import { enTetesSecurite, nouveauNonce } from "./securityHeaders"

const ENV = { PUBLIC_CONVEX_URL: "https://exemple.convex.cloud" }

describe("enTetesSecurite", () => {
  test("la CSP porte le nonce et refuse tout le reste en script", () => {
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("script-src 'self' 'nonce-abc123'")
    expect(csp).toContain("default-src 'self'")
  })

  test("les images distantes sont refusées", () => {
    // C'est le point de toute la tâche : un `<img src>` collé dans un
    // article chargeait un tiers hors du bandeau de consentement.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).not.toContain("img-src *")
  })

  test("le domaine Convex est autorisé en connexion, et lui seul", () => {
    // Le site lit ses pages depuis Convex : sans cette ligne, la CSP casse
    // le site au lieu de le protéger.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud")
  })

  test("les autres en-têtes sont posés", () => {
    const h = enTetesSecurite("abc123", ENV)
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["X-Frame-Options"]).toBe("DENY")
    expect(h["Permissions-Policy"]).toContain("geolocation=()")
  })

  test("HSTS n'est posé qu'en HTTPS", () => {
    // Posé en développement sur http://localhost, il épingle le navigateur
    // sur une origine qui n'a pas de certificat, et le site devient
    // inaccessible jusqu'à purge manuelle du cache HSTS.
    expect(enTetesSecurite("a", ENV, false)["Strict-Transport-Security"]).toBeUndefined()
    expect(enTetesSecurite("a", ENV, true)["Strict-Transport-Security"]).toContain("max-age=")
  })
})

describe("nouveauNonce", () => {
  test("deux appels ne rendent jamais la même valeur", () => {
    // Un nonce réutilisé n'est pas un nonce : il redevient une liste
    // d'autorisation que n'importe quel script injecté peut recopier.
    expect(nouveauNonce()).not.toBe(nouveauNonce())
  })
})
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd apps/web && corepack pnpm@10 exec vitest run src/lib/securityHeaders.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : écrire `securityHeaders.ts`**

```ts
// Les en-têtes de sécurité du site public.
//
// La CSP est la seule chose qui rend l'invariant « aucune requête tierce
// sans accord » vrai PAR LE SERVEUR et non par discipline. Sans elle, un
// `<img src="https://ailleurs/pixel.gif">` collé dans le corps d'un article
// charge un tiers à chaque lecture, hors du bandeau — la seule brèche que
// l'audit de sécurité a laissée ouverte.

export function nouveauNonce(): string {
  const octets = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...octets)).replace(/[+/=]/g, "")
}

export function enTetesSecurite(
  nonce: string,
  env: { PUBLIC_CONVEX_URL?: string },
  https = false,
): Record<string, string> {
  const convex = env.PUBLIC_CONVEX_URL ?? ""
  const entetes: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      // Les scripts du consentement sont en ligne : ils portent le nonce.
      // `'strict-dynamic'` autorise ce qu'ils injectent APRÈS accord — un
      // pixel accepté doit pouvoir se charger, un pixel injecté par une
      // faille ne le peut pas, faute de nonce sur son parent.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      // Le point de la tâche : pas d'image distante.
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self' ${convex}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  }
  // Jamais en HTTP : posé sur `http://localhost`, HSTS épingle le
  // navigateur sur une origine sans certificat, et le site devient
  // inaccessible jusqu'à purge manuelle.
  if (https) {
    entetes["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  }
  return entetes
}
```

- [ ] **Étape 4 : brancher le middleware**

Dans `apps/web/src/middleware.ts`, après la réponse produite, poser les en-têtes et exposer le nonce à `Astro.locals` pour que `ConsentBanner.astro` et `GoogleConsentMode.astro` le portent sur leurs `<script is:inline>`.

- [ ] **Étape 5 : vérifier sur le site réel, pas seulement en test**

```bash
curl -s -D - -o /dev/null http://localhost:4321/ | grep -iE "content-security|x-content-type|referrer-policy"
```

Attendu : les trois en-têtes présents.

Puis **vérifier qu'on n'a rien cassé** — c'est le risque réel d'une CSP :

```bash
for p in / /fonctionnalites /tarifs /contact /blog /cookies; do
  printf "%-18s %s\n" "$p" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' http://localhost:4321$p)"
done
```

Attendu : 200 partout. Puis ouvrir le site dans un navigateur et **lire la console** : toute violation CSP y apparaît. Zéro violation, sinon la CSP est trop stricte et casse le site.

- [ ] **Étape 6 : commit**

```bash
git add apps/web/src/lib/securityHeaders.ts apps/web/src/lib/securityHeaders.test.ts apps/web/src/middleware.ts apps/web/src/components/consent/
git commit -m "feat(security): send a nonce-based CSP and the usual hardening headers

The site sent none. The consequence was concrete: an image pasted into an
article body loaded a third party on every read, outside the consent banner
entirely — the one hole the security audit left open, because no amount of
editorial discipline closes it. A CSP closes it by construction.

HSTS is sent only over HTTPS: on http://localhost it pins the browser to an
origin with no certificate and makes the site unreachable until the HSTS
cache is cleared by hand."
```

---

## Tâche 4 : le journal d'audit des gestes sensibles

**Le défaut :** on sait qui a créé une page. On ne sait pas qui a changé un rôle, écrit un secret, supprimé un lead ou dépublié. C'est le seul manque de la liste qu'on ne peut pas reconstituer après coup — la donnée n'existe pas.

**Fichiers :**
- Créer : `packages/backend/convex/lib/auditEvent.ts` + son test
- Créer : `packages/backend/convex/auditLog.ts` + son test
- Modifier : `schema.ts` (table `auditLog`)
- Modifier : les points d'écriture sensibles (`users.setRole`, `users.remove`, `secrets.set`, `secrets.clear`, `leads.remove`, `pages.publishPage`, `pages.unpublish`, `settings.update`)

**Interfaces :**
- Produit : `journaliser(ctx, { action, cible, detail })` — appelée **dans la même mutation** que le geste

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, test } from "vitest"
import { AUDIT_ACTIONS, decrireAction } from "./lib/auditEvent"

describe("decrireAction", () => {
  test("chaque action a une phrase lisible", () => {
    // Un journal qui affiche `SET_ROLE` oblige à connaître le code pour le
    // lire, et personne ne le consulte au moment où il faudrait.
    for (const action of AUDIT_ACTIONS) {
      expect(decrireAction(action, "Antoine", "editor").length).toBeGreaterThan(10)
    }
  })

  test("nomme l'auteur et la cible", () => {
    expect(decrireAction("role.change", "Antoine", "editor")).toContain("Antoine")
    expect(decrireAction("role.change", "Antoine", "editor")).toContain("editor")
  })
})
```

- [ ] **Étape 2 : vérifier l'échec, puis écrire `lib/auditEvent.ts`**

Une union fermée d'actions, et une fonction pure qui les met en français.

- [ ] **Étape 3 : la table et l'écriture**

```ts
  // Ce que quelqu'un a fait, et qu'on ne pourrait pas reconstituer autrement.
  //
  // Écrit DANS la même mutation que le geste, jamais par une action
  // planifiée : un journal auquel il peut manquer une ligne est pire
  // qu'absent — on le croit complet.
  //
  // Jamais de valeur de secret ici, même tronquée : un journal se relit
  // longtemps après, souvent par plus de monde que l'écran d'origine.
  auditLog: defineTable({
    action: auditActionValidator,
    acteurId: v.string(),
    acteurNom: v.string(),
    cible: v.optional(v.string()),
    detail: v.optional(v.string()),
  }).index("by_creation", []),
```

- [ ] **Étape 4 : appeler `journaliser` aux huit points d'écriture**

- [ ] **Étape 5 : test d'intégration — la trace existe et ne contient pas de secret**

```ts
test("écrire un secret laisse une trace, et la trace ne contient pas le secret", async () => {
  const t = makeTestConvex()
  // … poser SECRETS_KEY, s'identifier owner, appeler secrets.set …
  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  expect(lignes).toHaveLength(1)
  expect(JSON.stringify(lignes)).not.toContain("sk-or-la-valeur-secrete")
})
```

- [ ] **Étape 6 : pousser sur Convex, lancer toute la suite, commit**

---

## Tâche 5 : la limite de débit sur `/api/consent`

**Le défaut :** second chemin d'écriture public, sans limite. `consentId` vient du client : poster N identifiants distincts insère N lignes.

**Fichiers :**
- Modifier : `apps/web/src/pages/api/consent.ts`
- Modifier : `packages/backend/convex/consent.ts`
- Créer : `packages/backend/convex/consent.rateLimit.test.ts`

Reprendre **exactement** le motif de la tâche déjà livrée pour les leads : `lib/leadRateLimit.ts` en modèle, une empreinte d'origine calculée dans la route Astro (`sha-256(ip + secret)`), jamais l'adresse.

Budget proposé : **20 par heure et par origine**. Plus large que le formulaire, parce qu'une personne peut légitimement changer d'avis plusieurs fois dans une session, et que chaque changement écrit une ligne.

- [ ] Test qui échoue → implémentation → test qui passe → push Convex → commit.

---

## Tâche 6 : la rétention Umami

**Le défaut :** `/confidentialite` annonce 13 mois. Rien ne les applique. Umami a son propre PostgreSQL, hors de portée d'un cron Convex.

**Fichiers :**
- Modifier : `docker/docker-compose.yml`
- Modifier : `docker/README.md`
- Modifier : `apps/web/src/config/legal.ts` (la ligne de rétention, une fois la purge réelle)

- [ ] **Étape 1 : écrire la requête et la vérifier en lecture d'abord**

```bash
docker compose exec umami-db psql -U umami -d umami -c \
  "SELECT count(*) FROM website_event WHERE created_at < now() - interval '13 months';"
```

**Compter avant de supprimer.** Une purge lancée sans ce compte est une suppression à l'aveugle sur des données qu'aucune sauvegarde ne couvre nécessairement.

- [ ] **Étape 2 : ajouter un service de purge mensuel au compose**, avec la commande `DELETE` et un `profiles:` pour qu'il ne démarre pas par accident en développement.

- [ ] **Étape 3 : mettre `legal.ts` en accord** — remplacer « Aucune purge n'est configurée » par la durée réellement appliquée.

- [ ] **Étape 4 : commit**

⚠️ **Cette tâche supprime des données.** Ne pas la dérouler sans avoir lancé le compte de l'étape 1 et vérifié qu'une sauvegarde de la base Umami existe.

---

## Tâche 7 : garde-fous de dépendances dans la CI

**Fichiers :**
- Modifier : `.github/workflows/ci.yml`
- Modifier : `packages/backend/package.json`, `apps/admin/package.json` (`better-auth` → `1.6.22`)

- [ ] **Étape 1 : monter `better-auth`**

```bash
export PATH="/opt/homebrew/bin:$PATH" && corepack pnpm@10 up better-auth@1.6.22 -r
```

Puis **lancer toute la suite** : le couple `better-auth` / `@convex-dev/better-auth` est le point sensible de cette pile, la spec le dit.

- [ ] **Étape 2 : ajouter le garde-fou**

```yaml
      - name: Audit des dépendances de production
        run: corepack pnpm@10 audit --prod --audit-level high
```

- [ ] **Étape 3 : commit**

---

## Tâche 8 : la garde SSRF à la résolution

**Le défaut :** `lib/webhookUrl.ts` vérifie l'URL à l'**écriture**. Un domaine public qui pointe sur `169.254.169.254` passe, et un enregistrement DNS peut changer après coup. Manquent aussi les formes numériques : `https://2130706433/`, `https://0177.0.0.1/`, `[::]`, `[::ffff:127.0.0.1]`.

**Portée assumée :** seul `owner`/`admin` peut poser cette URL, et ce rôle a déjà d'autres chemins. La tâche ferme les formes numériques (peu coûteux, sûr) et **documente** la limite DNS plutôt que de prétendre la fermer.

- [ ] Tests pour chaque forme numérique → implémentation → commit.

---

## Tâches sans code — à faire par l'opérateur

Elles bloquent la production et **ne peuvent pas** être faites par un agent : elles touchent des secrets, une identité juridique, ou un déploiement réel.

- [ ] **Poser `LEAD_SUBMIT_SECRET` et `CONSENT_LOG_SECRET` dans le `.env` du VPS**, et les mêmes valeurs sur Convex. `rsync` exclut `.env` : le prochain déploiement s'arrêtera en les nommant, ce qui est le comportement voulu.
- [ ] **Poser `SECRETS_KEY` sur le déploiement de production** :
  ```bash
  cd packages/backend && npx convex env set SECRETS_KEY "$(openssl rand -base64 32)"
  ```
  ⚠️ La régénérer plus tard rend **illisibles** tous les jetons déjà saisis.
- [ ] **Remplir `apps/web/src/config/legal.ts`** — raison sociale, adresse, SIRET, directeur de publication. Les valeurs livrées décrivent le dépôt : publiées telles quelles, ce sont des mentions légales fausses.
- [ ] **Faire tourner `leadWebhookSecret`** — il a été lisible publiquement avant le correctif de `settings.get`. Vider le champ dans les réglages et enregistrer en mint un nouveau.
- [ ] **Réparer la ligne du logo** — un clic sur « Changer de logo » et choisir `logo_astrotan.png`.

---

## Tâche finale : la vérification que personne n'a faite

**Aucun de ces écrans n'a jamais été ouvert dans un navigateur.** Ils demandent une session, et les mots de passe n'appartiennent pas aux agents. Tout est vérifié par tests et rendu statique.

À exercer à la main, dans cet ordre :

- [ ] `/leads` — glisser une carte d'une colonne à l'autre (glisser-déposer natif depuis `8b10d8b`)
- [ ] `/leads` — vue Liste, recherche, changement de statut par le menu déroulant
- [ ] `/leads` — ouvrir une fiche, lire la frise ; une fiche ancienne doit dire qu'elle est antérieure au suivi
- [ ] `/settings/identite` — le champ logo montre une image, jamais un cadre vide
- [ ] `/settings/domaine` — saisir une clé Resend, recharger, vérifier que l'écran dit « configurée » sans jamais réafficher la valeur
- [ ] `/` — la courbe d'audience, et les trois granularités
- [ ] Le site en navigation privée — le bandeau de consentement, « Tout refuser », puis vérifier dans l'onglet réseau qu'aucune requête tierce ne part

---

## Ordre recommandé

1. **Tâches 1 et 2** — demandées, rapides, et la 2 débloque les emails en production.
2. **Tâches sans code** — sans elles le déploiement s'arrête.
3. **Tâche 3 (CSP)** — le meilleur rapport sécurité/effort.
4. **Tâche 4 (audit)** — la donnée manquante qu'on ne peut pas rattraper.
5. **Tâches 5 à 8** — par ordre décroissant de ce qu'elles évitent.
6. **Tâche finale** — après chaque lot, pas seulement à la fin.
