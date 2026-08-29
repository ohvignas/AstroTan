# Écran « Envoi des emails » — clé, expéditeur, liste des envois, gabarits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'adoptant un écran unique où il pose sa clé Resend et son adresse d'expédition, voit **tout** ce que le site enverra par email, choisit ce qui part, et modifie les textes — sans qu'aucun de ces gestes puisse le verrouiller dehors.

**Architecture:** La clé suit le motif `secrets` (chiffrement d'enveloppe, jamais dans `settings`). L'adresse d'expédition est un champ de `settings`, déjà présent mais réglable seulement par CLI. Les gabarits vivent dans une table dédiée et **retombent explicitement** sur le littéral en code quand ils sont absents ou invalides — le motif de `choisirExpediteur`. Le rendu réutilise `escapeHtml` et `singleLine`, qui existent déjà et protègent contre l'injection d'en-têtes.

**Tech Stack:** Convex (`action` pour la clé, `mutation` pour le reste), React 19 + TanStack Start, `SettingsFormShell` + `SecretField`.

**Spec:** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md) et [`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`](../specs/2026-08-29-secrets-et-chiffrement.md)

---

## Ce que ce projet envoie réellement : deux emails

Relevé fichier par fichier. Ce n'est pas une liste partielle — c'est **tout**.

| Email | Déclenché par | Destinataire | Texte | Rôle |
|---|---|---|---|---|
| **Invitation** | `invitations.ts:176-180` planifie `sendInvitationEmail`, exécuté `invitations.ts:235-269` | l'adresse invitée | objet `invitations.ts:264`, HTML `:265`, texte `:266`, lien `:258` = `${SITE_URL}/accept-invite?token=…` | `owner` ou `admin` |
| **Notification de lead** | `leads.ts:209` planifie `notifyStaff`, exécuté `leads.ts:715-783` | tous les `owner` + `admin` non suspendus, **un email par personne** (`leads.ts:766-769`) | objet `leads.ts:773`, texte `:741-750`, HTML `:752-758` | aucun — un visiteur du site |

**Better Auth n'envoie rien.** `auth.ts:393-398` déclare `emailAndPassword` sans `sendResetPassword` ; il n'y a ni clé `emailVerification`, ni `user.changeEmail`. Les seuls greffons montés sont `convex` et `admin` (`auth.ts:409-417`) — ni `magicLink`, ni `emailOTP`. La table `verification` existe et **rien n'y écrit jamais** (`_dataRegistry.ts:86-91`).

### Le fait qui contraint tout le reste

L'invitation est le **seul** chemin de création de compte (`disableSignUp: true`), **aucune récupération de mot de passe n'existe**, et `RESEND_TEST_MODE` vaut `true` par défaut (`lib/resend.ts:36`) — Resend accepte l'envoi et ne délivre pas. De plus, le jeton en clair est effacé (`claimPendingToken`, `invitations.ts:218-227`) **avant** la tentative d'envoi (`:238-241`) : si l'email ne part pas, le jeton est irrécupérable, et il n'existe aucune action « renvoyer l'invitation ».

D'où la règle que ce plan applique partout : **l'email d'invitation ne peut être ni coupé, ni cassé par un gabarit.**

---

## Global Constraints

- **Invariant 1** — `settings.get` est publique et non authentifiée. Rien de ce plan n'y entre.
- **Invariant 3** — chaque mutation revérifie le rôle. `lib/authz.test.ts` déroule chaque entrée du registre.
- **Invariant 5** — « la base ne porte aucun contenu de page ». Voir l'arbitrage ci-dessous.
- **Invariant 6** — expand/migrate/contract. Une table neuve est un déploiement unique et sûr ; le piège est le jour où un envoi lit la base *au lieu* du code.
- **Invariant 7** — un secret ne vit qu'à trois endroits. La clé Resend passe par `secrets.set`, **jamais** par `settings.update`.
- **Règle Convex 1** — fixtures de test dans `packages/backend/testing/`, jamais sous `convex/`.
- **Règle Convex 2** — `npx convex dev --once` réel avant de clore une tâche qui touche `convex/`.
- **Garde-fous** : `_registry.test.ts` (égalité stricte, actions publiques comprises), `_dataRegistry.test.ts` (toute table classée, exemption > 20 caractères), `legal.test.ts` (chaque `declaredAs` correspond à un `purpose` publié).
- Commentaires en français, commits en anglais (Conventional Commits). TDD.

### Arbitrage sur l'invariant 5

Un gabarit d'email en base **n'est pas** le modèle de contenu que l'invariant refuse, et voici la ligne exacte :

L'invariant refuse « une seconde façon, plus faible, de faire ce que le code fait déjà » pour le **contenu d'une page**, dont il existe un fichier `.astro` versionné. Un email n'a pas de fichier équivalent, et le dépôt admet déjà deux exceptions nommées de la même famille : `posts.body`, « le seul endroit où ce template garde encore du contenu en base, et l'exception est délibérée » (`schema.ts:109-112`), et `settings.emailFrom`, qui est **déjà** un fragment d'email stocké en base.

Ce qui rend l'exception tenable, et sans quoi elle ne le serait pas :

1. **Le code reste la source.** Le littéral n'est jamais retiré. La base ne fait que le remplacer, et son absence est le cas normal, pas une panne.
2. **Un gabarit invalide n'est pas envoyé** : il est refusé à l'enregistrement, et à l'exécution le rendu retombe sur le littéral.
3. **Le gabarit d'invitation ne peut pas perdre son lien.** Un gabarit sans `{{lien}}` est refusé — sinon on livre un email qui n'ouvre aucune porte, ce qui est un verrouillage à retardement.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/gabarit.ts` *(créer)* | Rendre un gabarit : substituer les variables, échapper, refuser l'inconnu. Pur. |
| `packages/backend/convex/emails.ts` *(créer)* | Le catalogue des deux emails, les queries et mutations de l'écran. Point d'entrée. |
| `packages/backend/convex/schema.ts` *(modifier)* | Table `emailTemplates`. |
| `packages/backend/convex/leads.ts` *(modifier)* | Corriger la garde `process.env`, lire l'interrupteur, rendre par gabarit. |
| `packages/backend/convex/invitations.ts` *(modifier)* | Rendre par gabarit. Aucun interrupteur. |
| `packages/backend/convex/settings.ts` *(modifier)* | Rien de neuf : `emailFrom` est déjà dans `getPrivate` et validé par `update`. |
| `packages/backend/convex/_registry.ts`, `_dataRegistry.ts` *(modifier)* | Déclarer les nouvelles mutations et la nouvelle table. |
| `apps/web/src/config/legal.ts` *(modifier)* | Si la table porte `majPar`, la rattacher à une finalité publiée. |
| `apps/admin/src/routes/_authed/settings/emails.tsx` *(créer)* | L'écran. |
| `apps/admin/src/components/settings-nav.tsx` *(modifier)* | L'entrée de menu. `settings-nav.test.tsx` exige un fichier de route par chemin. |

---

## Task 1: Corriger la garde qui rend la clé saisie inopérante

**Files:**
- Modify: `packages/backend/convex/leads.ts` (ligne 724)
- Test: `packages/backend/convex/leads.test.ts`

`leads.ts:724` fait `if (!process.env.RESEND_API_KEY) return null`, **avant** `makeResend(ctx)` (l.760). Or `makeResend` lit `lireSecret` (`lib/resend.ts:34`). Conséquence exacte : **une clé saisie depuis l'écran fait partir les invitations mais pas les notifications de leads.** Le même jeton, deux comportements.

`secrets.ts:331-337` dit que `lireSecret` est « LE point de lecture. Un seul, et c'est la raison d'être de cette fonction ». `leads.ts:724` est la seconde copie de la règle de précédence, et elle ne connaît que la moitié environnement.

- [ ] **Step 1: Write the failing test**

```ts
test("une clé Resend posée en base fait partir la notification de lead", async () => {
  // Le défaut : la garde de `notifyStaff` ne regardait que l'environnement,
  // alors que `makeResend` lit d'abord l'environnement PUIS la base. Une
  // clé saisie à l'écran envoyait les invitations et pas les leads.
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  delete process.env.RESEND_API_KEY
  process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64")
  process.env.SITE_URL = "https://admin.exemple.fr"
  await owner.identity.action(api.secrets.set, { nom: "RESEND_API_KEY", valeur: "re_test" })

  const envois = capturerLesEnvois()
  await soumettreUnLead(t)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

`… vitest.mjs run convex/leads.test.ts` — ÉCHEC : aucun envoi capturé.

- [ ] **Step 3: Write minimal implementation**

```ts
  // `lireSecret` et non `process.env` : c'est LE point de lecture des
  // jetons (`secrets.ts`), et il connaît la précédence environnement → base.
  // La garde précédente ne voyait que l'environnement, si bien qu'une clé
  // saisie depuis l'administration envoyait les invitations et pas ceci.
  const cleResend = await lireSecret(ctx, "RESEND_API_KEY")
  if (!cleResend) return null
```

- [ ] **Step 4: Run test to verify it passes**

PASS. Vérifier que `leads.test.ts:403` (« sans `RESEND_API_KEY`, rien ne part et rien ne lève ») reste vert : la base y est vide, donc `lireSecret` rend `null`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/leads.ts packages/backend/convex/leads.test.ts
git commit -m "fix(leads): read the Resend key the way every other caller does"
```

---

## Task 2: Le catalogue des envois

**Files:**
- Create: `packages/backend/convex/lib/catalogueEmails.ts`
- Test: `packages/backend/convex/lib/catalogueEmails.test.ts`

**Interfaces:**
- Produces:
```ts
export type CleEmail = "invitation" | "leadNotification"
export interface DescriptionEmail {
  cle: CleEmail
  titre: string
  quand: string
  destinataire: string
  /** Faux quand couper cet email fermerait la porte à quelqu'un. */
  desactivable: boolean
  /** La raison, affichée à l'écran, quand `desactivable` est faux. */
  raisonNonDesactivable?: string
  variables: readonly string[]
  variablesObligatoires: readonly string[]
  objetParDefaut: string
  corpsParDefaut: string
}
export const CATALOGUE: readonly DescriptionEmail[]
```

Un seul fichier décrit les deux emails : l'écran, la validation et le rendu le lisent, si bien qu'ajouter un troisième email un jour est **un** endroit à modifier.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { CATALOGUE } from "./catalogueEmails"

describe("CATALOGUE", () => {
  test("décrit exactement les emails que ce dépôt envoie", () => {
    // Deux, et deux seulement. Better Auth n'envoie rien : ni
    // réinitialisation, ni vérification d'adresse, ni changement d'email —
    // aucun n'est monté dans `auth.ts`. Si l'un l'est un jour, ce test
    // échoue, et c'est le rappel qu'il faut l'ajouter ici aussi.
    expect(CATALOGUE.map((e) => e.cle)).toEqual(["invitation", "leadNotification"])
  })

  test("l'invitation n'est pas désactivable, et dit pourquoi", () => {
    const invitation = CATALOGUE.find((e) => e.cle === "invitation")!
    expect(invitation.desactivable).toBe(false)
    expect(invitation.raisonNonDesactivable).toBeTruthy()
  })

  test("le lien est une variable obligatoire de l'invitation", () => {
    // Un gabarit d'invitation sans lien est un email qui n'ouvre aucune
    // porte, sur le seul chemin de création de compte du dépôt.
    const invitation = CATALOGUE.find((e) => e.cle === "invitation")!
    expect(invitation.variablesObligatoires).toContain("lien")
  })

  test("chaque variable obligatoire est déclarée dans les variables", () => {
    for (const email of CATALOGUE) {
      for (const obligatoire of email.variablesObligatoires) {
        expect(email.variables, email.cle).toContain(obligatoire)
      }
    }
  })

  test("chaque texte par défaut n'emploie que des variables déclarées", () => {
    // Le défaut livré doit passer sa propre validation, sinon le premier
    // enregistrement d'un adoptant serait refusé sur un texte qu'il n'a
    // pas écrit.
    for (const email of CATALOGUE) {
      const employees = [...`${email.objetParDefaut} ${email.corpsParDefaut}`
        .matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
      for (const nom of employees) expect(email.variables, email.cle).toContain(nom)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — module introuvable.

- [ ] **Step 3: Write minimal implementation**

Les valeurs par défaut sont **exactement** les textes actuels : objet et corps d'`invitations.ts:264-266`, objet et corps de `leads.ts:741-750, :773`, avec les interpolations converties en `{{variable}}`. Variables : `invitation` → `lien` (obligatoire) ; `leadNotification` → `nom`, `email`, `sujet`, `message`, `lien` (aucune obligatoire, la notification reste lisible amputée).

- [ ] **Step 4: Run test to verify it passes** — PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/catalogueEmails.ts packages/backend/convex/lib/catalogueEmails.test.ts
git commit -m "feat(emails): describe, in one place, every email this template sends"
```

---

## Task 3: Rendre un gabarit sans ouvrir de faille

**Files:**
- Create: `packages/backend/convex/lib/gabarit.ts`
- Test: `packages/backend/convex/lib/gabarit.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` et `singleLine`, à **extraire** de `leads.ts:672-690` vers `lib/gabarit.ts` et à réimporter depuis `leads.ts` — pas à recopier.
- Produces:
  - `export function variablesEmployees(texte: string): string[]`
  - `export function validerGabarit(desc, objet, corps): string | null` — un message d'erreur, ou `null`
  - `export function rendreTexte(gabarit: string, valeurs: Record<string, string>): string`
  - `export function rendreHtml(gabarit: string, valeurs: Record<string, string>): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { rendreHtml, rendreTexte, validerGabarit, variablesEmployees } from "./gabarit"
import { CATALOGUE } from "./catalogueEmails"

const INVITATION = CATALOGUE.find((e) => e.cle === "invitation")!

describe("validerGabarit", () => {
  test("accepte le gabarit par défaut", () => {
    expect(
      validerGabarit(INVITATION, INVITATION.objetParDefaut, INVITATION.corpsParDefaut),
    ).toBeNull()
  })

  test("refuse une variable inconnue, en la nommant", () => {
    const message = validerGabarit(INVITATION, "Bonjour", "Voici {{motDePasse}} et {{lien}}")
    expect(message).toContain("motDePasse")
  })

  test("refuse un gabarit d'invitation sans son lien", () => {
    expect(validerGabarit(INVITATION, "Bonjour", "Bienvenue !")).toContain("lien")
  })

  test("refuse un objet sur plusieurs lignes", () => {
    // Un objet contenant un saut de ligne est une injection d'en-têtes :
    // tout ce qui suit devient un en-tête SMTP, `Bcc:` compris.
    expect(validerGabarit(INVITATION, "Bonjour\nBcc: x@y.z", "{{lien}}")).toBeTruthy()
  })
})

describe("rendreTexte", () => {
  test("substitue les variables", () => {
    expect(rendreTexte("Ouvrez {{lien}}", { lien: "https://x/y" })).toBe("Ouvrez https://x/y")
  })

  test("une variable sans valeur devient vide, pas « undefined »", () => {
    expect(rendreTexte("Bonjour {{nom}}", {})).toBe("Bonjour ")
  })

  test("une valeur ne peut pas introduire une variable", () => {
    // Sinon une valeur venue d'Internet — le nom saisi dans le formulaire
    // de contact — pourrait faire substituer une seconde passe.
    expect(rendreTexte("{{nom}}", { nom: "{{lien}}" })).toBe("{{lien}}")
  })
})

describe("rendreHtml", () => {
  test("échappe les valeurs, jamais le gabarit", () => {
    expect(rendreHtml("<p>{{nom}}</p>", { nom: "<script>x</script>" })).toBe(
      "<p>&lt;script&gt;x&lt;/script&gt;</p>",
    )
  })

  test("une valeur ne peut pas fermer un attribut", () => {
    expect(rendreHtml('<a href="{{lien}}">x</a>', { lien: '"><script>' })).not.toContain(
      "<script>",
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — module introuvable.

- [ ] **Step 3: Write minimal implementation**

Points structurants :

- La substitution se fait **en une seule passe** (`String.prototype.replace` avec une fonction de remplacement), jamais par boucle de `replace` successifs — c'est ce qui empêche une valeur d'introduire une variable.
- `rendreHtml` échappe **la valeur** au moment de la substitution ; le gabarit, lui, n'est pas échappé puisqu'il n'est pas du HTML saisi (l'objet et le corps sont du texte brut, et c'est le code qui compose le HTML autour).
- `validerGabarit` refuse : une variable non déclarée, une variable obligatoire absente, un objet contenant `\r` ou `\n`, un corps ou un objet dépassant les bornes (`objet` 200, `corps` 5 000).

- [ ] **Step 4: Run test to verify it passes** — PASS, 9 tests.

- [ ] **Step 5: Faire pointer `leads.ts` sur les fonctions déplacées**

`escapeHtml` et `singleLine` ne doivent exister qu'une fois. Après le déplacement, `… vitest.mjs run convex/leads.test.ts` doit rester vert **sans modification de ses tests**.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/lib/gabarit.ts packages/backend/convex/lib/gabarit.test.ts \
        packages/backend/convex/leads.ts
git commit -m "feat(emails): render a template without opening an injection path"
```

---

## Task 4: La table, et le repli vers le code

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Create: `packages/backend/convex/emails.ts`
- Test: `packages/backend/convex/emails.test.ts`
- Modify: `packages/backend/convex/_registry.ts`, `_dataRegistry.ts`, `apps/web/src/config/legal.ts`

**Table :**

```ts
  emailTemplates: defineTable({
    /** Une clé du catalogue. Pas d'index unique en base : c'est la mutation
     *  qui garantit l'unicité, et un index le dirait mieux — à revoir si un
     *  jour le catalogue dépasse la dizaine. */
    cle: v.string(),
    objet: v.string(),
    corps: v.string(),
    /** Faux = cet email ne part plus. Refusé sur les emails non désactivables. */
    actif: v.boolean(),
    majPar: v.id("profiles"),
    majAt: v.number(),
  }).index("by_cle", ["cle"]),
```

`majPar` porte une donnée personnelle : la table est donc **déclarée**, pas exemptée — `{ declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" }`, finalité déjà publiée (`legal.ts:316`). `_dataRegistry.test.ts` échouerait sinon.

**Interfaces produites par `emails.ts` :**
- `export const list = query(...)` → le catalogue enrichi de l'état en base, pour l'écran. `requireRole(["owner","admin"])`.
- `export const setTemplate = mutation({ args: { cle, objet, corps } })` → valide puis écrit, journalise.
- `export const setActif = mutation({ args: { cle, actif } })` → refuse sur un email non désactivable.
- `export const resetTemplate = mutation({ args: { cle } })` → supprime la ligne, donc retour au littéral.
- `export async function gabaritPour(ctx, cle)` → la ligne, ou le défaut du catalogue.

- [ ] **Step 1: Write the failing test**

```ts
test("sans ligne en base, le gabarit est celui du code", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const liste = await owner.identity.query(api.emails.list, {})
  const invitation = liste.find((e) => e.cle === "invitation")!
  expect(invitation.objet).toBe(CATALOGUE[0].objetParDefaut)
  expect(invitation.personnalise).toBe(false)
})

test("un gabarit refusé n'est jamais écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.emails.setTemplate, {
      cle: "invitation", objet: "Bonjour", corps: "sans lien",
    }),
  ).rejects.toThrow()
  const liste = await owner.identity.query(api.emails.list, {})
  expect(liste.find((e) => e.cle === "invitation")!.personnalise).toBe(false)
})

test("l'invitation ne peut pas être coupée", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.emails.setActif, { cle: "invitation", actif: false }),
  ).rejects.toThrow()
})

test("la notification de lead peut être coupée, et alors rien ne part", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  configurerResend()
  await owner.identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: false })
  const envois = capturerLesEnvois()
  await soumettreUnLead(t)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(0)
  // Et le lead est écrit quand même : couper la notification ne perd rien.
  expect(await owner.identity.query(api.leads.list, {})).toHaveLength(1)
})

test("modifier un gabarit laisse une ligne au journal d'audit, sans le texte", async () => {
  // Le journal dit QUI a changé QUOI, jamais le contenu : un gabarit peut
  // contenir la signature de l'entreprise, et le journal n'est pas balayé
  // par `retention.ts`.
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.emails.setTemplate, {
    cle: "leadNotification", objet: "Nouveau message", corps: "{{message}}",
  })
  const journal = await owner.identity.query(api.auditLog.list, {})
  expect(journal[0].action).toBe("emailTemplate.set")
  expect(JSON.stringify(journal[0])).not.toContain("{{message}}")
})

test("un editor ne voit ni ne modifie les gabarits", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(editor.identity.query(api.emails.list, {})).rejects.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails** — `api.emails` n'existe pas.

- [ ] **Step 3: Write minimal implementation**

Ajouter `"emailTemplate.set"` et `"emailTemplate.toggle"` à `auditActionValidator` (**ajout** additif, invariant 6) et leurs phrases dans `decrireAction`.

- [ ] **Step 4: Run test to verify it passes** — PASS, 6 tests.

- [ ] **Step 5: Satisfaire les trois garde-fous**

Déclarer les trois mutations dans `_registry.ts`, la table dans `_dataRegistry.ts`, et vérifier que `legal.test.ts` passe. Lancer la suite backend **entière**.

- [ ] **Step 6: Vérifier le déploiement réel**

```bash
cd packages/backend && npx convex dev --once
```

Nouvelle table **et** union d'audit élargie : c'est exactement le cas où le runtime peut refuser ce que `tsc` accepte.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/emails.ts \
        packages/backend/convex/emails.test.ts packages/backend/convex/_registry.ts \
        packages/backend/convex/_dataRegistry.ts packages/backend/convex/lib/auditEvent.ts \
        apps/web/src/config/legal.ts
git commit -m "feat(emails): store templates, and fall back to the code when there is none"
```

---

## Task 5: Brancher les deux envois sur le catalogue

**Files:**
- Modify: `packages/backend/convex/invitations.ts` (`sendInvitationEmail`, ~235-269)
- Modify: `packages/backend/convex/leads.ts` (`notifyStaff`, ~715-783)
- Test: `packages/backend/convex/invitations.test.ts`, `leads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("un gabarit personnalisé remplace le texte de l'invitation, lien compris", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  configurerResend()
  await owner.identity.mutation(api.emails.setTemplate, {
    cle: "invitation", objet: "Rejoignez Acme", corps: "Bonjour, ouvrez {{lien}}",
  })
  const envois = capturerLesEnvois()
  await owner.identity.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr", role: "editor",
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois[0].subject).toBe("Rejoignez Acme")
  expect(envois[0].text).toContain("/accept-invite?token=")
})

test("une ligne de gabarit devenue invalide n'empêche pas l'invitation de partir", async () => {
  // Le scénario réel : le catalogue gagne une variable obligatoire dans une
  // version ultérieure, et les gabarits enregistrés avant ne l'ont pas.
  // L'email doit partir avec le texte du code, pas échouer.
  const t = makeTestConvex()
  await ecrireGabaritInvalideDirectement(t, "invitation")
  const envois = capturerLesEnvois()
  await inviterQuelquun(t)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(1)
  expect(envois[0].subject).toBe(CATALOGUE[0].objetParDefaut)
})
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation**

Dans les deux actions : lire le gabarit par `gabaritPour`, **revalider** avant rendu, et retomber sur le défaut si la validation échoue — le motif exact de `choisirExpediteur` (`lib/expediteur.ts:27-31`). `notifyStaff` lit en plus `actif` et sort en silence quand il est faux, comme il le fait déjà sans clé Resend.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/invitations.ts packages/backend/convex/leads.ts \
        packages/backend/convex/invitations.test.ts packages/backend/convex/leads.test.ts
git commit -m "feat(emails): send through the template, and never fail because of one"
```

---

## Task 6: L'écran

**Files:**
- Create: `apps/admin/src/routes/_authed/settings/emails.tsx`
- Create: `apps/admin/src/components/email-templates.tsx`
- Test: `apps/admin/src/components/email-templates.test.tsx`
- Modify: `apps/admin/src/components/settings-nav.tsx`

**La forme, de haut en bas :**

1. **La clé Resend** — `SecretField`, motif `settings-secrets.tsx` : `type="password"`, jamais pré-remplie, vide veut dire « ne change rien », rien ne s'enregistre tout seul.
2. **L'adresse d'expédition** — champ texte lié à `settings.emailFrom`, enregistré par la barre. Aide : « `Nom <adresse@votredomaine.fr>`. Le domaine doit être vérifié chez Resend », avec un lien vers `/settings/domaine`, qui sait maintenant le vérifier.
3. **Un bandeau permanent tant que `RESEND_TEST_MODE` n'est pas `false`** : « Resend accepte les envois et ne les délivre pas. C'est la valeur par défaut. » Le texte existe déjà (`settings-environment.tsx:239`) ; il devient un bandeau parce qu'enterré dans une aide, personne ne le lit — et c'est la panne la plus silencieuse du déploiement.
4. **La liste des envois**, une carte par email : titre, quand il part, à qui, un interrupteur, et un bouton « Modifier le texte ». L'interrupteur de l'invitation est **désactivé**, avec sa raison affichée et non masquée.
5. **L'éditeur**, dans un panneau : objet, corps, la liste des variables disponibles cliquables pour insertion, un bouton « Revenir au texte par défaut ». La validation s'affiche **avant** l'enregistrement.

- [ ] **Step 1: Write the failing test**

```tsx
test("l'interrupteur de l'invitation est désactivé et dit pourquoi", () => {
  const html = renderToStaticMarkup(<ListeEmails emails={LISTE} onToggle={() => {}} />)
  expect(html).toMatch(/disabled/)
  expect(html).toMatch(/seul chemin/i)
})

test("le mode d'essai s'affiche en bandeau, pas en note de bas de page", () => {
  const html = renderToStaticMarkup(<BandeauModeEssai actif />)
  expect(html).toMatch(/ne les délivre pas/)
})

test("une variable inconnue est signalée avant l'enregistrement", () => {
  const html = renderToStaticMarkup(
    <EditeurGabarit email={INVITATION} objet="x" corps="{{motDePasse}}" erreur="…motDePasse…" />,
  )
  expect(html).toContain("motDePasse")
})
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation.**

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Vérifier à l'écran**

Ouvrir `/settings/emails`. Contrôler la barre d'enregistrement collante, l'interrupteur de l'invitation inerte, le bandeau de mode d'essai, et le refus d'un gabarit sans `{{lien}}`.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/routes/_authed/settings/emails.tsx \
        apps/admin/src/components/email-templates.tsx \
        apps/admin/src/components/email-templates.test.tsx \
        apps/admin/src/components/settings-nav.tsx
git commit -m "feat(settings): one screen for the key, the sender, and every email that goes out"
```

---

## Self-Review

**Couverture de la demande :** la clé et l'adresse d'expédition (T6), la liste de tout ce qui part (T2, T6), l'interrupteur par email (T4, T6), les textes modifiables (T3, T4, T5, T6).

**Ce que ce plan corrige au passage :** la garde `process.env` de `leads.ts` (T1), la duplication de `escapeHtml` (T3), et le fait que `emailFrom` n'était réglable que par CLI (T6) — un manque relevé comme bloquant pour un template.

**Ce que ce plan NE fait PAS, et qui doit remonter à l'humain :**

**Il n'existe aucune récupération de mot de passe.** Ce n'est pas un email qui pourrait échouer, c'est une fonctionnalité absente : `auth.ts:393-398` déclare `emailAndPassword` sans `sendResetPassword`. Un adoptant qui perd son mot de passe n'a pour issue que `npx convex run bootstrap:createInvitation`, donc les identifiants du déploiement. Sur un template, c'est un défaut plus grave que tout ce que ce plan répare, et il mérite son propre plan — monter `sendResetPassword` sur le même chemin d'envoi que celui-ci le rendrait naturel.

**Il n'existe aucune action « renvoyer l'invitation ».** Le jeton en clair est effacé avant la tentative d'envoi (`invitations.ts:218-227` puis `:238-241`) : si l'email ne part pas, il faut révoquer et réinviter. À traiter avec le point précédent.

**Types :** `CleEmail` et `DescriptionEmail` sont produits par T2 et consommés par T3, T4, T5, T6. `gabaritPour` est produit par T4 et consommé par T5.
