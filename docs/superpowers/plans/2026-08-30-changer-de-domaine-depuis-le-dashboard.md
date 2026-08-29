# Changer de domaine depuis le dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'un adoptant change le domaine de son site depuis `/settings/domaine` et que **tout suive** — routage, certificats, validation d'hôte, liens des emails, domaine d'expédition. Seuls les enregistrements DNS chez son hébergeur restent à sa charge, guidés par le tableau de l'écran.

**Architecture:** Traefik cesse de tirer ses règles des labels Docker (figés jusqu'à recréation des conteneurs) et lit un **provider fichier** qu'il surveille. Un service `routeur` suit le domaine déclaré dans Convex et réécrit ce fichier. La validation d'hôte d'Astro quitte le build pour le runtime, et les origines Convex quittent l'environnement pour la base.

**Tech Stack:** Traefik v3.6 (provider fichier + ACME HTTP-01), Convex (query gardée par secret partagé), Node (service `routeur`), Astro 7.

**Spec:** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md)

---

## Ce qu'on remplace, et pourquoi c'était figé

| Ce qui fige le domaine aujourd'hui | Où | Pourquoi ça ne suit pas |
|---|---|---|
| Règles de routage et certificats | labels `traefik.http.routers.*.rule` de `docker/docker-compose.yml:142,166,270`, interpolés depuis `${WEB_DOMAIN}` | Un label ne change qu'en **recréant** le conteneur |
| Validation d'hôte du site | `apps/web/astro.config.ts` → `security.allowedDomains` | Lue **au build** ; c'est ce qui autorise `x-forwarded-for`, donc les limiteurs de débit |
| Refus de démarrage sur divergence | `apps/web/verifier-domaine.mjs` | Conçu quand la divergence était toujours une erreur ; elle devient transitoire |
| Origine des liens d'emails | `process.env.SITE_URL`, `WEB_SITE_URL` | Variables d'environnement Convex, non modifiables depuis une fonction |
| Domaine d'expédition | réglé à la main chez Resend | Rien ne le relie au domaine déclaré |

**Ce qui reste manuel, et pour de bon :** les enregistrements DNS chez le registrar. Personne ne peut écrire dans une zone sans les identifiants de son fournisseur. Le tableau de `/settings/domaine` existe pour ça, et sa qualité est ce qui rend ce plan tenable.

## Les deux pièges à fermer, sinon la fonctionnalité verrouille l'adoptant dehors

**1. Le certificat n'existe pas encore quand le routage change.** Si l'on retire l'ancien hôte au moment où l'on ajoute le nouveau, et que Let's Encrypt échoue — DNS pas encore propagé, quota atteint —, **l'administration devient injoignable**, sur les deux domaines. Le remède est structurel : **l'ancien hôte reste routé** jusqu'à ce que le nouveau serve un certificat valide. On ajoute, on vérifie, puis seulement on retire.

**2. Le quota Let's Encrypt est de cinq certificats par domaine et par semaine, et un échec compte.** Un service qui réécrirait sa configuration à chaque battement brûlerait le quota en quelques minutes, et l'adoptant se retrouverait sans certificat pendant une semaine — `docker/.env.example:23-25` le documente déjà comme le piège numéro un du déploiement. Le service n'écrit donc que sur un **changement réel et stable**, jamais sur un état transitoire.

## Global Constraints

- **Invariant 1** — `settings.get` est publique et non authentifiée. `declaredDomain` **n'y entre pas**. Le service `routeur` n'a pas de session : il passe par une query gardée par un **secret partagé**, motif déjà en place dans `packages/backend/convex/lib/sharedSecret.ts` (voir `assertSharedSecret`).
- **Invariant 3** — chaque mutation revérifie le rôle.
- **Invariant 6** — expand/migrate/contract ; aucun changement de schéma destructif dans un déploiement.
- **Invariant 7** — un secret ne vit qu'à trois endroits. `ROUTING_SECRET` est un `process.env` du conteneur des deux côtés, jamais en base.
- **Traefik : ne jamais ajouter de `command:` ni monter un `traefik.yml`.** `docker/docker-compose.yml:20-34` explique pourquoi, et l'a payé : les trois loaders de configuration statique (File → Flag → Env) ne fusionnent pas, et le premier qui aboutit **fait ignorer en silence** toutes les variables `TRAEFIK_*`. Le provider fichier s'ajoute par `TRAEFIK_PROVIDERS_FILE_*`, jamais autrement.
- **Le socket Docker reste en lecture seule.** Un socket en écriture équivaut à donner le root de l'hôte.
- Commentaires en français, commits en anglais (Conventional Commits). TDD.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/routing.ts` *(créer)* | La query gardée par secret qui rend les hôtes courants. Point d'entrée de déploiement. |
| `services/routeur/` *(créer)* | Le service qui suit Convex et écrit la configuration dynamique de Traefik. |
| `services/routeur/ecrireRoutes.ts` *(créer)* | Composer le YAML dynamique à partir des hôtes. **Pur**, donc testable seul. |
| `docker/routeur.Dockerfile` *(créer)* | Son image. |
| `docker/docker-compose.yml` *(modifier)* | Provider fichier, volume partagé, service `routeur`, labels des trois routeurs retirés. |
| `apps/web/src/lib/allowedDomains.ts` *(modifier)* | La validation d'hôte devient runtime. |
| `apps/web/astro.config.ts`, `verifier-domaine.mjs` *(modifier)* | Le figeage au build et le refus de démarrage disparaissent. |
| `packages/backend/convex/settings.ts` *(modifier)* | `adminOrigin` / `webOrigin` dérivés de `declaredDomain`, avec repli sur l'environnement. |
| `packages/backend/convex/auth.ts` *(modifier)* | `baseURL` depuis la base. |
| `packages/backend/convex/resendDomain.ts` *(créer)* | Déclarer et vérifier le domaine d'expédition chez Resend. |

---

## Task 1: La query que le routeur interroge

**Files:** Create `packages/backend/convex/routing.ts`, `routing.test.ts`

**Interfaces:**
- Produces: `export const hotes = query({ args: { secret: v.string() }, ... }): Promise<{ web: string; admin: string; umami: string | null }>`

Les trois hôtes dérivent de `settings.declaredDomain` quand il est posé — `admin.<domaine>` et `stats.<domaine>` suivant la convention documentée —, sinon des variables d'environnement actuelles. **Le repli est le cas normal d'un déploiement neuf, pas une erreur.**

- [ ] **Step 1: Write the failing test**

```ts
test("sans secret valide, la query refuse — et ne dit pas pourquoi", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.routing.hotes, { secret: "faux" })).rejects.toThrow()
  // Un message qui distinguerait « secret absent du déploiement » de
  // « secret faux » dirait à un attaquant s'il vaut la peine d'insister.
})

test("sans domaine déclaré, les hôtes viennent de l'environnement", async () => {
  process.env.ROUTING_SECRET = "s".repeat(32)
  process.env.WEB_DOMAIN = "exemple.fr"
  const t = makeTestConvex()
  expect(await t.query(api.routing.hotes, { secret: process.env.ROUTING_SECRET })).toEqual({
    web: "exemple.fr", admin: "admin.exemple.fr", umami: null,
  })
})

test("un domaine déclaré l'emporte, et entraîne ses sous-domaines", async () => {
  // C'est tout l'objet du plan : une seule valeur change, trois hôtes suivent.
})

test("un domaine invalide en base ne produit JAMAIS d'hôte", async () => {
  // Cette valeur devient une règle de routage. Une chaîne arbitraire qui
  // arriverait jusqu'au YAML de Traefik y injecterait ce qu'elle veut.
  await poserDirectement(t, "settings", { declaredDomain: "exemple.fr`) || Host(`pirate.fr" })
  expect(await t.query(api.routing.hotes, { secret })).toMatchObject({ web: "exemple.fr" })
  // repli, jamais la valeur douteuse
})
```

- [ ] **Step 2: Run test to verify it fails** — `api.routing` n'existe pas.
- [ ] **Step 3: Write minimal implementation.** `assertSharedSecret` de `lib/sharedSecret.ts` en tête ; `normaliserHote` de `lib/hoteNu.ts` sur toute valeur venue de la base.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Déclarer la query au registre** (convention réelle : chaque module pousse ses entrées à l'import ; `_registry.test.ts` exige l'égalité stricte).
- [ ] **Step 6: `npx convex dev --once` réel** — nouveau point d'entrée de déploiement.
- [ ] **Step 7: Commit** — `feat(routing): expose the current hosts to the router service`

---

## Task 2: Composer la configuration dynamique

**Files:** Create `services/routeur/ecrireRoutes.ts`, `ecrireRoutes.test.ts`

**Interfaces:**
- Produces: `export function composerRoutes(hotes, ancien: string[]): string` — le YAML dynamique de Traefik.

Fonction **pure** : elle prend les hôtes et rend du texte. C'est ce qui rend testable la partie où une erreur coûte le plus cher.

- [ ] **Step 1: Write the failing test**

```ts
test("chaque hôte produit un routeur, un service et un certificat", () => {
  const yaml = composerRoutes({ web: "exemple.fr", admin: "admin.exemple.fr", umami: null }, [])
  expect(yaml).toContain("Host(`exemple.fr`)")
  expect(yaml).toContain("certresolver: letsencrypt")
})

test("les anciens hôtes RESTENT routés", () => {
  // Le piège numéro un : retirer l'ancien hôte pendant que le certificat du
  // nouveau s'émet rend l'administration injoignable sur les DEUX domaines.
  const yaml = composerRoutes({ web: "neuf.fr", admin: "admin.neuf.fr", umami: null },
                              ["vieux.fr", "admin.vieux.fr"])
  expect(yaml).toContain("Host(`neuf.fr`)")
  expect(yaml).toContain("Host(`vieux.fr`)")
})

test("un hôte qui n'est pas un hôte nu ne sort jamais", () => {
  // Défense en profondeur : la query valide déjà, mais ce YAML est du
  // routage — une seconde barrière à l'endroit où le texte est composé.
  expect(() => composerRoutes({ web: "a`) || Host(`b", admin: "x.fr", umami: null }, []))
    .toThrow()
})
```

- [ ] **Step 2-4: rouge, implémentation, vert.**
- [ ] **Step 5: Commit** — `feat(routing): compose Traefik's dynamic config from the declared hosts`

---

## Task 3: Le service, et sa prudence

**Files:** Create `services/routeur/index.ts`, `docker/routeur.Dockerfile`

Le service interroge `routing.hotes`, compare, et n'écrit **que sur un changement réel**. Points structurants :

- **Anti-battement.** Deux lectures successives concordantes avant d'écrire. Le quota Let's Encrypt est de cinq certificats par domaine et par semaine, échecs compris.
- **Les anciens hôtes sont conservés** jusqu'à ce que le nouveau serve un certificat valide, puis retirés à la passe suivante. L'état « hôtes précédents » se relit depuis le fichier écrit, pas d'une mémoire de processus qui disparaît au redémarrage.
- **Il ne fait rien d'autre.** Pas d'API, pas de port exposé, pas de socket Docker. Il lit une query et écrit un fichier.
- **Un échec de lecture ne réécrit rien.** Convex injoignable doit laisser le routage en place, jamais le vider — sinon une coupure réseau met le site hors ligne.

- [ ] **Step 1: Test — Convex injoignable ne touche pas au fichier**
- [ ] **Step 2: Test — deux lectures divergentes n'écrivent pas**
- [ ] **Step 3: Implémentation**
- [ ] **Step 4: Commit** — `feat(routing): follow the declared domain, carefully`

---

## Task 4: Brancher Traefik

**Files:** Modify `docker/docker-compose.yml`

- Ajouter `TRAEFIK_PROVIDERS_FILE_DIRECTORY: /dynamique` et `TRAEFIK_PROVIDERS_FILE_WATCH: "true"` **en variables d'environnement**, jamais en `command:` — voir la contrainte globale.
- Un volume nommé partagé : écrit par `routeur`, monté **en lecture seule** dans Traefik.
- Retirer les labels `traefik.http.routers.{web,admin,umami}.rule` : c'est le provider fichier qui les porte désormais. **Garder `traefik.enable` et les services**, sinon Traefik ne connaît plus les conteneurs cibles.
- `ROUTING_SECRET` dans `docker/.env.example`, généré par `scripts/bootstrap.mjs` comme les neuf autres secrets, et vérifié par `scripts/check-env-wiring.mjs`.

- [ ] **Step 1: `docker compose config` sort en 0**, sans profil et avec `--profile purge`
- [ ] **Step 2: `check-env-wiring` voit rouge** quand `ROUTING_SECRET` manque
- [ ] **Step 3: Vérifier en exécution** que Traefik charge bien le provider fichier et qu'une réécriture est prise **sans redémarrage**
- [ ] **Step 4: Commit** — `feat(docker): let Traefik watch a file the router service writes`

---

## Task 5: La validation d'hôte quitte le build

**Files:** Modify `apps/web/src/lib/allowedDomains.ts`, `astro.config.ts`, `verifier-domaine.mjs`, `src/middleware.ts`

C'est la tâche la plus délicate, parce qu'elle touche ce qui rend `clientAddress` fiable — donc les deux limiteurs de débit du site.

**Le rappel qui décide de tout :** Astro n'honore `x-forwarded-for` que si l'hôte a été validé (`security.allowedDomains`), et cette liste est figée au build. Sans elle, `clientAddress` vaut l'adresse du proxy, **la même pour tout Internet** : le formulaire de contact tombe à cinq envois par heure pour tous, et la preuve de consentement cesse d'être écrite en silence. Ce défaut a été mesuré sur ce dépôt, pas supposé.

Le remplacement doit donc **valider** l'hôte, jamais faire confiance à l'en-tête. La liste vient du runtime (le même `routing.hotes`, en cache), et l'échec est **fermé** : hôte inconnu ⇒ on n'honore pas l'en-tête, exactement comme aujourd'hui.

Le refus de démarrage de `verifier-domaine.mjs` disparaît : la divergence build/runtime devient normale, puisque plus rien n'est figé au build.

- [ ] **Step 1: Test — un hôte connu fait honorer `x-forwarded-for`**
- [ ] **Step 2: Test — un hôte inconnu ne le fait PAS**, et l'empreinte retombe sur la socket
- [ ] **Step 3: Test — Convex injoignable ne fait pas confiance à l'en-tête** (échec fermé)
- [ ] **Step 4: Implémentation**
- [ ] **Step 5: Prouver en exécution**, comme l'a fait la correction d'origine : lancer le serveur construit devant un faux Convex et observer l'empreinte réellement transmise par `/api/consent` selon l'en-tête `Host`
- [ ] **Step 6: Commit** — `feat(web): validate the host at runtime, so the domain can change`

---

## Task 6: Les origines quittent l'environnement

**Files:** Modify `packages/backend/convex/settings.ts`, `auth.ts`, `invitations.ts`, `leads.ts`, `revalidate.ts`

`SITE_URL` et `WEB_SITE_URL` se dérivent de `declaredDomain`, avec repli sur l'environnement.

**Le point à vérifier avant d'écrire, et qui décide de la forme :** `createAuthOptions` est une **fonction prenant `ctx`** (`auth.ts:640`), donc appelée par requête et non au chargement du module — contrairement à ce qu'affirmait une note antérieure. Mais elle rend son objet de façon **synchrone**, là où lire la base demande un `await`. Établis comment `createAuth` est réellement appelé avant de choisir : `baseURL` faux, c'est `trustedOrigins` faux, et donc des requêtes légitimes refusées.

- [ ] **Step 1: Test — un domaine déclaré change l'origine des liens d'invitation**
- [ ] **Step 2: Test — sans domaine déclaré, l'environnement continue de valoir**
- [ ] **Step 3: Implémentation**
- [ ] **Step 4: `npx convex dev --once` réel** — `auth.ts` mal chargé fait tomber tout le dashboard
- [ ] **Step 5: Commit** — `feat(settings): derive the email link origins from the declared domain`

---

## Task 7: Le domaine d'expédition chez Resend

**Files:** Create `packages/backend/convex/resendDomain.ts`

Une action qui déclare le domaine chez Resend et rend les enregistrements DNS à créer, **fusionnés dans le tableau de `/settings/domaine`** plutôt que dans un second écran. Vérifie l'API Resend plutôt que de l'écrire de mémoire.

La clé est lue par `lireSecret` — jamais `process.env` directement, c'est le défaut corrigé sur `leads.ts` cette semaine.

- [ ] **Step 1-4: TDD, `requireRole(["owner","admin"])`, registre, commit** — `feat(emails): declare the sending domain at Resend from the dashboard`

---

## Task 8: L'écran dit ce qui suit tout seul, et ce qui ne suit pas

**Files:** Modify `apps/admin/src/routes/_authed/settings/domaine.tsx`

Le paragraphe des cinq étapes a été supprimé. Il ne revient pas.

Ce qui le remplace n'est pas une explication mais un **ordre d'opérations rendu évident** : le tableau DNS d'abord, l'enregistrement du domaine ensuite. Enregistrer un domaine dont les enregistrements A ne pointent pas encore vers le serveur fait échouer l'émission du certificat — et **chaque échec compte dans le quota hebdomadaire**.

Le bouton d'enregistrement se désarme donc tant que la ligne A du domaine n'est pas verte, avec l'état — pas la leçon — à côté.

- [ ] **Step 1: Test — le bouton reste inerte tant que la ligne A n'est pas verte**
- [ ] **Step 2: Implémentation**
- [ ] **Step 3: Vérifier au navigateur**, en 1280 et 390 px
- [ ] **Step 4: Commit** — `feat(settings): let the domain be saved only once DNS points here`

---

## Self-Review

**Couverture :** routage (T1-T4), validation d'hôte (T5), origines des emails (T6), domaine d'expédition (T7), ordre d'opérations (T8).

**Ce qui reste manuel, définitivement :** les enregistrements DNS chez le registrar. C'est le seul geste que ce plan ne supprime pas, et il est assumé — l'automatiser demanderait les identifiants du fournisseur DNS de l'adoptant, donc un secret de plus, un connecteur par fournisseur, et une surface d'attaque qui écrit dans sa zone.

**Le risque principal, à surveiller pendant l'exécution :** on remplace un mécanisme qui échoue **bruyamment** — un conteneur qui refuse de démarrer — par un mécanisme qui peut échouer **silencieusement** : un fichier mal écrit, une lecture qui échoue, un ancien hôte jamais retiré. Chaque tâche doit donc dire ce qui se passe quand elle échoue, et l'échec doit rester fermé : pas de routage plutôt qu'un mauvais routage, pas de confiance en l'en-tête plutôt qu'une confiance mal placée.

**Types :** `hotes` est produit par T1 et consommé par T2, T3, T5, T6.
