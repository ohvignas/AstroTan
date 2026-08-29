# Récupération de mot de passe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à toute personne ayant un compte sur un déploiement AstroTan un moyen de retrouver l'accès sans les identifiants du déploiement — aujourd'hui, il n'en existe aucun.

**Architecture:** Monter `sendResetPassword` de Better Auth sur le chemin d'envoi que le plan « Envoi des emails » construit, avec les deux routes publiques que l'admin n'a pas, et fermer les trois défauts que le réglage par défaut de Better Auth laisse ouverts : sessions non révoquées, comptes suspendus servis, table `verification` mal déclarée au registre.

**Tech Stack:** Better Auth 1.6.17 (`emailAndPassword.sendResetPassword`, `onPasswordReset`, `revokeSessionsOnPasswordReset`), Convex, TanStack Start.

**Spec:** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md)

**Dépend de :** [`2026-08-29-ecran-envoi-des-emails.md`](2026-08-29-ecran-envoi-des-emails.md), tâches 2 à 5. Ce plan ajoute une troisième entrée au catalogue d'emails ; l'exécuter avant laisserait un troisième texte écrit en dur, que le plan précédent aurait ensuite à déplacer.

---

## Le défaut, tel qu'il se constate

`packages/backend/convex/auth.ts:393-398` déclare :

```ts
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: …,
    maxPasswordLength: …,
  },
```

Il n'y a **pas** de `sendResetPassword`. Conséquences enchaînées, chacune vérifiable :

1. `POST /request-password-reset` n'envoie rien — Better Auth n'appelle la fonction que si elle est fournie.
2. Il n'existe aucune route `/forgot-password` ni `/reset-password` dans `apps/admin/src/routes/`.
3. `disableSignUp: true` interdit de recréer un compte.
4. L'invitation est le seul chemin de création, et son jeton en clair est effacé (`invitations.ts:218-227`) **avant** la tentative d'envoi (`:238-241`), sans action « renvoyer ».
5. `RESEND_TEST_MODE` vaut `true` par défaut (`lib/resend.ts:36`) : Resend accepte et ne délivre pas.

**Le résultat, sur un template :** chaque adoptant qui perd son mot de passe n'a d'issue que `npx convex run bootstrap:createInvitation`, donc les identifiants du déploiement en ligne de commande. Ce n'est pas une gêne, c'est la perte de l'application.

## Les trois défauts que le réglage par défaut laisse ouverts

Vérifiés dans la documentation Better Auth, pas supposés.

**1. Les sessions ne sont pas révoquées.** « By default, other active sessions are **not** revoked when a user resets their password. » Quelqu'un qui réinitialise son mot de passe parce qu'il soupçonne un vol laisse le voleur connecté. `revokeSessionsOnPasswordReset: true` est l'option, et elle doit être posée.

**2. Un compte suspendu peut réinitialiser.** Le greffon `admin` est monté (`auth.ts:409-417`) et porte `banned`. Rien dans `requestPasswordReset` ne consulte ce champ : un compte suspendu recevrait le lien et reprendrait la main. `sendResetPassword` doit refuser d'envoyer — **en silence**, sans le dire à l'appelant, sinon la réponse devient un oracle qui distingue « suspendu » de « inconnu ».

**3. La table `verification` est déclarée à tort.** `_dataRegistry.ts:86-91` l'exempte au motif que « **rien n'y écrit jamais** ». Ce motif devient **faux** dès la première réinitialisation : c'est là que Better Auth range le jeton, avec l'adresse email. `_dataRegistry.test.ts` ne l'attrapera pas — il vérifie qu'une table est *classée*, pas que sa raison est *vraie*. C'est un mensonge que seule cette ligne de plan empêche.

---

## Global Constraints

- **Invariant 3** — permissions revérifiées côté serveur. Les deux routes ajoutées sont **publiques** : elles n'ont pas de session, et c'est le jeton qui autorise.
- **Invariant 4** — le rôle vit sur l'utilisateur Better Auth. Une réinitialisation ne touche jamais au rôle.
- **Invariant 6** — aucun changement de schéma destructif. Ce plan n'ajoute aucune table : `verification` existe déjà (`betterAuth/schema.ts:65`).
- **Invariant 7** — aucun secret nouveau.
- **Règle Convex 2** — `npx convex dev --once` réel : ce plan modifie la configuration de Better Auth, qui est chargée au démarrage du module.
- **Ne jamais `await` l'envoi de l'email** dans `sendResetPassword` — la documentation le dit explicitement, et la raison est une attaque temporelle : attendre l'envoi fait durer la réponse plus longtemps quand le compte existe, ce qui révèle son existence.
- **Ne jamais dire si le compte existe.** Ni dans la réponse, ni dans le message d'erreur, ni dans le temps de réponse.
- Commentaires en français, commits en anglais. TDD.

---

## Task 1: Le catalogue accueille le troisième email

**Files:**
- Modify: `packages/backend/convex/lib/catalogueEmails.ts`
- Test: `packages/backend/convex/lib/catalogueEmails.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("la réinitialisation est au catalogue, et n'est pas désactivable", () => {
  // Même raisonnement que l'invitation : couper cet email retire le
  // dernier chemin de récupération d'un déploiement où l'inscription est
  // fermée. Un interrupteur ici est un verrouillage à retardement.
  const reset = CATALOGUE.find((e) => e.cle === "passwordReset")!
  expect(reset).toBeDefined()
  expect(reset.desactivable).toBe(false)
  expect(reset.variablesObligatoires).toContain("lien")
})
```

Le test « décrit exactement les emails que ce dépôt envoie » attend aujourd'hui `["invitation", "leadNotification"]` — il doit passer à trois. **Le mettre à jour fait partie de cette étape** : il existe précisément pour qu'un email ajouté sans passer par le catalogue soit visible.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation**

Ajouter l'entrée `passwordReset` : `desactivable: false`, `raisonNonDesactivable` nommant l'inscription fermée, `variables: ["lien"]`, `variablesObligatoires: ["lien"]`, objet et corps par défaut en français.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/catalogueEmails.ts packages/backend/convex/lib/catalogueEmails.test.ts
git commit -m "feat(emails): add the password reset to the catalogue"
```

---

## Task 2: Monter l'envoi, et fermer les deux trous du défaut

**Files:**
- Modify: `packages/backend/convex/auth.ts` (bloc `emailAndPassword`, ~393-398)
- Create: `packages/backend/convex/passwordReset.ts` (l'action d'envoi, appelée par le planificateur)
- Test: `packages/backend/convex/passwordReset.test.ts`
- Modify: `packages/backend/convex/_registry.ts`

**Interfaces:**
- Produces: `internal.passwordReset.envoyer` — `internalAction({ args: { email: v.string(), lien: v.string() } })`

**Avant d'écrire :** vérifier par le serveur MCP `better-auth` le nom exact de l'option de durée de vie du jeton (`resetPasswordTokenExpiresIn` ou son équivalent dans 1.6.17) et sa valeur par défaut. **Ne pas l'écrire de mémoire** — `CLAUDE.md` l'interdit pour cette stack, qui bouge vite.

- [ ] **Step 1: Write the failing test**

```ts
test("une demande pour une adresse inconnue ne lève pas et n'envoie rien", async () => {
  // Le silence est la fonctionnalité : une erreur, ou une absence d'erreur,
  // dirait à qui la provoque si l'adresse a un compte.
  const t = makeTestConvex()
  configurerResend()
  const envois = capturerLesEnvois()
  await demanderReinitialisation(t, "personne@exemple.fr")
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(0)
})

test("une demande pour un compte suspendu n'envoie rien, et ne le dit pas", async () => {
  const t = makeTestConvex()
  const suspendu = await seedActor(t, "editor", { banned: true })
  configurerResend()
  const envois = capturerLesEnvois()
  const reponse = await demanderReinitialisation(t, suspendu.email)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(0)
  // La même réponse que pour une adresse inconnue : sinon l'écran devient
  // un oracle qui distingue « suspendu » de « inexistant ».
  expect(reponse).toEqual(await demanderReinitialisation(t, "personne@exemple.fr"))
})

test("une demande pour un compte actif envoie le lien", async () => {
  const t = makeTestConvex()
  const actif = await seedActor(t, "editor")
  configurerResend()
  const envois = capturerLesEnvois()
  await demanderReinitialisation(t, actif.email)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(envois).toHaveLength(1)
  expect(envois[0].text).toContain("/reset-password?token=")
})

test("réinitialiser révoque les autres sessions", async () => {
  // `revokeSessionsOnPasswordReset` vaut FAUX par défaut chez Better Auth.
  // Sans cette option, quelqu'un qui réinitialise parce qu'il soupçonne un
  // vol laisse le voleur connecté — exactement l'inverse de son intention.
  const t = makeTestConvex()
  const acteur = await seedActor(t, "editor")
  const ancienneSession = await ouvrirUneSession(t, acteur)
  await reinitialiser(t, acteur, "un-nouveau-mot-de-passe")
  await expect(utiliserLaSession(t, ancienneSession)).rejects.toThrow()
})

test("une réinitialisation laisse une ligne au journal d'audit", async () => {
  const t = makeTestConvex()
  const acteur = await seedActor(t, "editor")
  await reinitialiser(t, acteur, "un-nouveau-mot-de-passe")
  const journal = await lireJournal(t)
  expect(journal[0].action).toBe("password.reset")
  // Jamais le jeton, jamais le mot de passe.
  expect(JSON.stringify(journal[0])).not.toContain("un-nouveau-mot-de-passe")
})
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation**

Dans `auth.ts`, le bloc `emailAndPassword` gagne trois clés :

```ts
    // Faux par défaut chez Better Auth, et c'est un défaut dangereux : la
    // raison la plus fréquente de réinitialiser est le soupçon d'un vol, et
    // ne pas révoquer laisse précisément le voleur connecté.
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, url }) => {
      // Pas d'`await` : la documentation Better Auth l'interdit, et la
      // raison est temporelle. Attendre l'envoi allonge la réponse quand le
      // compte existe, ce qui la transforme en oracle mesurable au
      // chronomètre, quelle que soit la prudence du corps de réponse.
      void ctx.scheduler.runAfter(0, internal.passwordReset.envoyer, {
        email: user.email,
        lien: url,
      })
    },

    onPasswordReset: async ({ user }) => {
      // Le journal dit QUE le mot de passe a changé, jamais lequel ni par
      // quel jeton. C'est le seul événement d'authentification que rien
      // d'autre ne reconstituerait a posteriori.
      await journaliser(ctx, { action: "password.reset", cible: user.email })
    },
```

`passwordReset.envoyer` refuse en silence sur un compte suspendu, rend le gabarit par le catalogue, et envoie par `makeResend` — le chemin exact de `sendInvitationEmail`.

Ajouter `"password.reset"` à `auditActionValidator` (ajout additif, invariant 6) et sa phrase dans `decrireAction`.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Corriger la déclaration de `verification` au registre**

`_dataRegistry.ts:86-91` exempte `verification` au motif que « rien n'y écrit jamais ». **Ce motif vient de devenir faux.** La table porte désormais un jeton et une adresse email, donc une donnée personnelle : elle passe en `{ declaredAs: … }` rattachée à une finalité publiée dans `apps/web/src/config/legal.ts`, avec sa durée de conservation réelle — celle du jeton.

`_dataRegistry.test.ts` ne l'aurait pas attrapé : il vérifie qu'une table est classée, jamais que sa raison est vraie. Ajouter un test qui échoue si `verification` redevient exempte tant que `sendResetPassword` est monté.

- [ ] **Step 6: Run the whole backend suite, then the real deployment**

```bash
cd packages/backend && npx convex dev --once
```

`auth.ts` est chargé au démarrage du module : une clé mal nommée n'échoue pas au typecheck, elle échoue au chargement.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/auth.ts packages/backend/convex/passwordReset.ts \
        packages/backend/convex/passwordReset.test.ts packages/backend/convex/_registry.ts \
        packages/backend/convex/_dataRegistry.ts packages/backend/convex/lib/auditEvent.ts \
        apps/web/src/config/legal.ts
git commit -m "feat(auth): mount password reset, revoke sessions, and refuse suspended accounts"
```

---

## Task 3: Les deux écrans publics

**Files:**
- Create: `apps/admin/src/routes/forgot-password.tsx`
- Create: `apps/admin/src/routes/reset-password.tsx`
- Modify: `apps/admin/src/routes/login.tsx` (le lien « Mot de passe oublié ? »)
- Test: `apps/admin/src/routes/forgot-password.test.tsx`, `reset-password.test.tsx`

Les deux routes vivent **hors de `_authed`** : quelqu'un qui a perdu son mot de passe n'a pas de session. C'est la même position que `accept-invite.tsx`, à copier.

- [ ] **Step 1: Write the failing test**

```tsx
test("après envoi, la page dit la même chose quelle que soit l'adresse", () => {
  // La phrase est délibérément au conditionnel : « si un compte existe ».
  // Une confirmation affirmative — « email envoyé » — dirait à qui la
  // provoque que l'adresse a un compte.
  const html = renderToStaticMarkup(<ConfirmationDemande />)
  expect(html).toMatch(/si un compte existe/i)
  expect(html).not.toMatch(/nous avons envoyé/i)
})

test("un jeton absent ou refusé explique quoi faire, sans blâmer", () => {
  const html = renderToStaticMarkup(<ReinitialisationInvalide />)
  expect(html).toMatch(/expiré|invalide/i)
  expect(html).toContain("/forgot-password")
})

test("la page de connexion mène à la récupération", () => {
  const html = renderToStaticMarkup(<PageConnexion />)
  expect(html).toContain("/forgot-password")
})
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation**

`/forgot-password` : un champ email, `authClient.requestPasswordReset({ email, redirectTo: "<origine>/reset-password" })`, puis **toujours** la même confirmation au conditionnel.

`/reset-password` : lit `?token=` ; sur `?error=INVALID_TOKEN`, affiche l'explication et le chemin de retour. Sinon, deux champs de mot de passe et `authClient.resetPassword({ newPassword, token })`. Les bornes affichées sont `minPasswordLength` / `maxPasswordLength` d'`auth.ts` — **lues, pas recopiées**, sinon elles divergeront.

**Je ne saisis aucun mot de passe moi-même** : la vérification à l'écran de ces deux pages se fait par l'humain.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Vérifier de bout en bout, par l'humain**

Demander une réinitialisation, ouvrir le lien reçu, choisir un mot de passe, se connecter avec, et **vérifier qu'une session ouverte ailleurs a bien été fermée**.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/routes/forgot-password.tsx apps/admin/src/routes/reset-password.tsx \
        apps/admin/src/routes/login.tsx apps/admin/src/routes/forgot-password.test.tsx \
        apps/admin/src/routes/reset-password.test.tsx
git commit -m "feat(admin): add the forgot-password and reset-password screens"
```

---

## Task 4: Limiter le débit, et le prouver

**Files:**
- Modify: `packages/backend/convex/auth.ts` (bloc `rateLimit`, ~408)
- Test: `packages/backend/convex/passwordReset.test.ts`

`/request-password-reset` est une route **publique et non authentifiée qui envoie un email**. Sans limite, elle est deux choses à la fois : un moyen d'inonder la boîte de quelqu'un, et un moyen d'épuiser le quota Resend du déploiement — après quoi plus aucune invitation ne part.

Vérifier ce que `rateLimit` d'`auth.ts:408` couvre **réellement** aujourd'hui : Better Auth applique une limite globale, et cette route mérite la sienne, plus stricte.

- [ ] **Step 1: Write the failing test**

```ts
test("la demande de réinitialisation est limitée par adresse", async () => {
  const t = makeTestConvex()
  const acteur = await seedActor(t, "editor")
  configurerResend()
  const envois = capturerLesEnvois()
  for (let i = 0; i < 10; i++) await demanderReinitialisation(t, acteur.email)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  // Une poignée, pas dix : la boîte de la personne n'est pas une cible, et
  // le quota Resend du déploiement est partagé avec les invitations.
  expect(envois.length).toBeLessThanOrEqual(3)
})
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write minimal implementation.**

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/auth.ts packages/backend/convex/passwordReset.test.ts
git commit -m "feat(auth): rate-limit password reset requests per address"
```

---

## Task 5: Le dire là où l'adoptant le lira

**Files:**
- Modify: `docker/README.md` (§8, « Premier déploiement »)
- Modify: `AGENTS.md`, `CLAUDE.md` (section « Amorcer un accès administrateur »)

`CLAUDE.md` présente aujourd'hui `bootstrap:createInvitation` comme la réponse à « la perte de tous les accès owner/admin ». Après ce plan, ce n'est plus vrai pour la perte d'**un** mot de passe — seulement pour la perte de **tous** les comptes, ou pour un déploiement neuf. Corriger les deux fichiers, qui divergent sinon (la règle est en tête de `CLAUDE.md`).

Écrire aussi le fait qui reste vrai et qui surprendra : **tant que `RESEND_TEST_MODE` n'est pas passé à `false`, aucune réinitialisation n'arrive.** La récupération existe, et elle ne fonctionne qu'une fois l'envoi d'emails réellement configuré.

- [ ] **Step 1: Corriger les trois fichiers.**
- [ ] **Step 2: Commit**

```bash
git add docker/README.md AGENTS.md CLAUDE.md
git commit -m "docs: say that losing a password no longer means losing the deployment"
```

---

## Self-Review

**Couverture :** l'envoi (T1, T2), la révocation des sessions (T2), le refus des comptes suspendus (T2), la déclaration au registre (T2), les écrans (T3), la limite de débit (T4), la documentation (T5).

**Ce que ce plan ne fait PAS :** il ne monte ni la vérification d'adresse, ni le changement d'email, ni `magicLink`, ni `emailOTP` — aucun n'est nécessaire à la récupération, et chacun ajouterait un chemin d'authentification à défendre.

**Ce qui reste ouvert et doit remonter à l'humain :** il n'existe toujours pas d'action « renvoyer l'invitation ». Une invitation dont l'email n'est pas parti reste irrécupérable — le jeton en clair est effacé avant l'envoi. Ce plan réduit la portée du problème (un compte existant peut désormais se récupérer) mais ne le referme pas pour un compte qui n'a jamais été créé.

**Types :** `CleEmail` gagne `"passwordReset"` en T1 ; T2 le consomme.
