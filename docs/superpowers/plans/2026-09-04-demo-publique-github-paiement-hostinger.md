# Plan — démo publique AstroTan : GitHub, paiement, VPS Hostinger

Date : 2026-09-04  
Cible : une instance **de démonstration** hébergée sur un VPS Hostinger,
dépôt GitHub **public**, visiteurs qui **testent** le site (chat, contact,
paiement) mais **ne modifient pas** le contenu.

Ce n’est pas « déployer AstroTan ». C’est **installer une instance** : son
Convex, son dépôt, ses domaines, son VPS. Le dépôt GitHub porte le **code**
et les exemples. L’instance porte les **secrets** et les **données**.

### Où vit quoi

| Objet | Où | Contient |
|---|---|---|
| **Template** | branche `main` | site + admin + Convex. `/tarifs` est une maquette. **Pas** de checkout Stripe. C’est ce qu’on clone. |
| **Couche démo** | branche `demo` | `main` + ce qu’il faut pour essayer en public. Le site en ligne suit cette branche. |
| **App de vente** | l’app commerciale (hors ce repo) | Stripe, pages paiement, livraison du dossier **sans** le code de paiement ni les `.env`. |
| **Instance démo** | VPS (SRV2) | une install de `demo` : secrets, DNS. Jamais du code source. |

La Phase B (checkout dans le template) a été **retirée** : encaisser l’offre Complet n’est pas un geste d’adoptant.

---

## Contrôle — ce qui est déjà vrai, ce qui manque

### Déjà en place (ne pas réécrire)

| Invariant | Conséquence pour la démo |
|---|---|
| `apps/web` n’a ni clé admin ni session | Un visiteur **ne peut pas** publier, éditer une page, un article ou un réglage. |
| Les queries publiques filtrent `status === "published"` | Les brouillons restent invisibles. |
| Admin = invitation seule (`disableSignUp: true`, pas d’OAuth) | Personne n’entre dans `/` admin sans lien. |
| Une page **est** son fichier `.astro` | Changer le contenu = PR + déploiement, pas un formulaire public. |
| `seed:demoContent` crée les lignes `pages` | Sans seed, **toutes les URLs répondent 404**. |
| Pipeline VPS : Traefik + Docker + `pnpm bootstrap` | Hostinger n’est qu’un VPS Linux. Aucun adaptateur Hostinger n’existe, et aucun n’est nécessaire. |
| Garde-fou `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` | Les mentions légales d’exemple ne se publient pas. |

### Manquant — bloquant pour « pousser et mettre en ligne »

1. **Aucun remote Git.** `git remote -v` est vide.
2. **`gh` n’est pas authentifié.** Le token keyring `ohvignas` est invalide.
   Sans `gh auth refresh -h github.com`, **aucun dépôt ne peut être créé**.
3. **Aucun paiement dans le code.** `/tarifs` affiche trois colonnes ; le CTA
   « Complet » (9,99 €) pointe `/contact`. Pas de Stripe, pas de webhook.
4. **Le pipeline n’a jamais tourné contre un vrai VPS** (`deploy-vps` skill,
   spec §10). Hostinger = première mise en service réelle.
5. **`.pnpm-store/` (~753 Mo) n’est pas gitignoré.** Un `git add .` publierait
   le store. `.cursor/` non plus.
6. **Convex local ≠ Convex prod.** Ne jamais pointer la démo publique sur le
   déploiement de développement. Nouveau projet Convex, nouveaux secrets.

### Traces à ne pas publier telles quelles

- `REPO_URL` et le CTA « Cloner » pointent `https://github.com/OhVignas/AstroTan`
  — c’est le nom **voulu** du dépôt template, à confirmer à la création.
- Tests backend : `illith.com`, `owner@illith.test` (fixtures, pas le site).
- Handle perso dans des plans internes (`GHCR_OWNER=ohvignas`) — docs, pas runtime.
- Secrets locaux (`.env.local`, `.env.deploy`, `.local/`) : **déjà gitignorés**.
  Ne jamais les committer. Ne jamais les copier vers la prod.

### Ce que « tester sans modifier le contenu » veut dire

Les visiteurs **peuvent** :

- parcourir le site public, le blog, les tarifs ;
- ouvrir le chat, laisser un e-mail, envoyer le formulaire contact ;
- **payer** l’offre Complet (checkout réel sur la page) ;
- voir le rendu des pages (SEO, cookies, consentement).

Les visiteurs **ne peuvent pas** :

- se créer un compte admin ;
- changer slug / titre / statut / SEO d’une page ;
- publier ou retirer un article ;
- écrire dans Convex autrement que via les mutations **publiques déjà
  prévues** (lead, consentement, message de contact, événement de paiement).

L’admin reste fermé. Un compte `owner` existe pour toi seul (invitation
bootstrap). Pas de compte « démo éditeur ».

---

## Découpage — trois objets distincts

```
┌─────────────────────┐     ┌──────────────────────────┐
│  Dépôt GitHub       │     │  Instance démo (prod)    │
│  OhVignas/AstroTan  │────▶│  Convex prod             │
│  code + exemples    │     │  VPS Hostinger           │
│  public             │     │  domaines + secrets      │
└─────────────────────┘     └──────────────────────────┘
                                      │
                                      ▼
                            ┌──────────────────────────┐
                            │  Visiteur                │
                            │  HTTPS site public       │
                            │  paie / contacte / chat  │
                            │  jamais l’admin          │
                            └──────────────────────────┘
```

1. **GitHub** = source. Actions `Deploy` / `Rollback`. Packages GHCR.
2. **Convex prod** = backend de la démo. Seed + premier owner. Secrets
   Stripe / Resend / HMAC.
3. **VPS Hostinger** = Traefik + `web` + `admin` + `routeur` + Umami.
   `~/astrotan/.env` n’est **jamais** dans Git.

---

## Dossiers / fichiers à créer ou toucher

### Phase A — hygiène du dépôt (avant le premier push)

| Fichier | Rôle |
|---|---|
| `.gitignore` | Ajouter `.pnpm-store/`, `.cursor/` |
| `docs/superpowers/plans/2026-09-04-demo-publique-github-paiement-hostinger.md` | Ce plan |

Rien d’autre à inventer pour pousser : le template a déjà `apps/`,
`packages/`, `docker/`, `.github/workflows/`, `scripts/bootstrap.mjs`.

**Ne pas créer** : un second monorepo, un dossier `demo/`, un Convex
« read-only » parallèle. La lecture seule est déjà l’invariant #1.

### Phase B — ~~paiement dans le template~~ (retirée : ça vit sur l’app de vente)

Le secret Stripe ne vit **ni** dans `settings` (query publique) **ni** en
clair en base. Même famille que les jetons dashboard : saisi dans l’admin,
chiffré avec `SECRETS_KEY` (env Convex). Voir
`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`.

| Fichier (à créer) | Responsabilité |
|---|---|
| `packages/backend/convex/payments.ts` | `httpAction` : session Checkout + webhook Stripe. Revérifie le montant côté serveur. |
| `packages/backend/convex/lib/stripe.ts` | Client Stripe, vérification de signature, mapping price → offre. |
| `packages/backend/convex/schema.ts` | Table `purchases` (expand only) : `email`, `stripeSessionId`, `status`, `createdAt`. Index `by_session`. |
| `apps/web/src/pages/api/checkout.ts` | Relais Astro → Convex `SITE_URL` (le navigateur n’appelle pas Convex avec un secret). |
| `apps/web/src/pages/paiement-ok.astro` | Page succès (slug + ligne `pages`). |
| `apps/web/src/pages/paiement-annule.astro` | Page annulation. |
| `apps/web/src/pages/tarifs.astro` | CTA Complet → `POST /api/checkout` au lieu de `/contact`. |
| `apps/admin/src/routes/settings/paiement.tsx` | Saisie `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (famille `secrets`). |
| `packages/backend/convex/payments.test.ts` | Montant figé, signature invalide refusée, session rejouée idempotente. |

Montant **figé dans Convex**, pas lu depuis le DOM. Un visiteur qui
trafique le POST ne change pas 9,99 €.

Mode : **live** si la démo encaisse vraiment ; **test** tant que les clés
live n’existent pas. Les deux chemins sont le même code (`sk_test_` /
`sk_live_`).

Pas d’abonnement. Pas de portail client. Un paiement unique = une ligne
`purchases` + e-mail Resend de confirmation.

### Phase C — instance Hostinger (aucun fichier Hostinger-spécifique)

Les dossiers existent déjà :

```
docker/                 Dockerfiles, compose Traefik, .env.example
.github/workflows/      deploy.yml, rollback.yml
scripts/bootstrap.mjs   distribution des secrets
docker/README.md        runbook — autorité
```

À remplir **hors Git**, une fois, sur la machine de l’installateur :

| Fichier local (gitignoré) | Contenu |
|---|---|
| `.env.deploy` | Domaines, `GITHUB_REPOSITORY=OhVignas/AstroTan`, Convex prod, `VPS_HOST`, `VPS_IP4`, `VPS_USER`, chemin clé SSH, Resend |
| `~/astrotan/.env` sur le VPS | Copie de `.env.vps` produit par bootstrap. `chmod 600`. Jamais écrasé par rsync. |

DNS Hostinger (zone du domaine) :

| Nom | Type | Valeur |
|---|---|---|
| `@` ou le domaine nu | A | IPv4 du VPS |
| `admin` | A | même IP |
| `stats` | A | même IP (Umami) |
| `www` | A ou CNAME | selon le runbook |

**Nuage orange Cloudflare interdit** (challenge HTTP-01). DNS Hostinger
en mode DNS only, ou Cloudflare gris.

---

## Phases d’exécution

### 0. Prérequis humains (rien ne part sans ça)

- [x] `gh auth refresh -h github.com` sur cette machine (token `ohvignas` mort).
- [x] Confirmer le nom du dépôt : `OhVignas/AstroTan` (déjà câblé dans
      `nav.ts` / `tarifs.astro`). Dépôt public : https://github.com/ohvignas/AstroTan
- [ ] IP du VPS Hostinger, utilisateur SSH non-root (`deploy`), clé
      `~/.ssh/astrotan_deploy`.
- [ ] Domaine(s) pointés en A vers cette IP.
- [ ] Nouveau projet Convex **production** + deploy key.
- [ ] Compte Stripe (clés test d’abord) + endpoint webhook vers
      `https://<CONVEX_SITE_URL>/stripe/webhook` (URL exacte à figer dans
      l’implémentation).
- [ ] Domaine d’envoi Resend vérifié avant `RESEND_TEST_MODE=false`.

### 1. Hygiène + premier push (dès que `gh` répond)

1. ~~Étendre `.gitignore` (`.pnpm-store/`, `.cursor/`).~~ Fait.
2. ~~Vérifier `git status` : **aucun** `.env`, **aucun** `.local/`,
   **aucun** store pnpm.~~ Fait.
3. ~~`gh repo create OhVignas/AstroTan --public --source=. --remote=origin`~~
   Fait — https://github.com/ohvignas/AstroTan
4. ~~Ne **jamais** `git add .` à la racine tant que le store n’est pas ignoré.~~
5. Secrets Actions : `pnpm bootstrap` après remplissage de `.env.deploy`
   (`gh secret set --repo OhVignas/AstroTan`). **Bloqué** : pas de `.env.deploy`.

Branche : publier `main`. La branche de travail actuelle
(`fix/chat-leads-notifications`) se merge dans `main` **avant** le push
public, pour que la démo ait le chat, les leads et la mesure.

### 2. Paiement (TDD, lots petits)

1. ~~Test : une session Checkout refuse un montant ≠ 999 centimes.~~
2. ~~Table `purchases` (expand). Pas de contract dans le même déploiement.~~
3. ~~`httpAction` webhook : signature Stripe, idempotence `stripeSessionId`.~~
4. ~~Route Astro `/api/checkout` + pages succès / annulation + lignes
   `pages` dans `seed:demoContent`.~~
5. ~~CTA `/tarifs` → checkout.~~
6. ~~Écran admin secrets Stripe.~~
7. ~~E-mail de confirmation (chrome `emailLayout.ts` existant).~~
8. `npx convex dev --once` réel après tout fichier sous `convex/` —
   **à lancer par l’humain** (`api.payments` absent de `_generated` tant
   que ça n’a pas tourné).

### 3. Mise en service Hostinger (ordre du skill `deploy-vps`)

L’ordre n’est pas cosmétique. Le construire à l’envers produit un site
qui build contre un schéma Convex absent, ou un Traefik sans certificat.

1. VPS : Docker, user non-root, ports 80/443 (`docker/README.md` §1).
2. GHCR : décider public vs `docker login` **avant** le premier Deploy (§2).
3. DNS vérifié au `dig` (§3). Pas de proxy.
4. `pnpm bootstrap --dry-run` → éditer `.env.deploy` → `pnpm bootstrap`.
5. Copier `.env.vps` → `~/astrotan/.env`, `chmod 600` (§4).
6. Premier certificat en **staging** Let’s Encrypt (§5). Puis prod.
7. Push `main` → workflow `Deploy` : `convex deploy` → build images →
   `compose up` avec `IMAGE_TAG=<sha>` (§8).
8. Relancer `pnpm bootstrap` : `seed:demoContent` + invitation `owner`
   (jamais `admin`).
9. Ouvrir le lien imprimé, choisir le mot de passe. Ne jamais le passer
   en CLI.
10. Recette : `/` 200, `/tarifs` checkout, chat, contact, admin 403/login
    pour un anonyme, mentions légales = avis template tant que
    `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`.

Rollback : rejouer le pipeline sur un sha (`docker/README.md` §9). Jamais
les images seules.

### 4. Recette « démo publique »

| Test | Attendu |
|---|---|
| Visiteur ouvre `/` | Page d’accueil seed, 200 |
| Visiteur ouvre `/admin` (domaine admin) | Login, pas de signup |
| Visiteur POST une mutation `pages.update` | Impossible depuis le navigateur public (pas de client admin, pas de cookie session) |
| Chat + e-mail | Lead créé, pas de modification de page |
| Contact | Message + conversion pixels si consentement marketing |
| Checkout 9,99 € | Redirection Stripe, retour `/paiement-ok`, ligne `purchases` |
| Mentions légales | Avis « template pas encore personnalisé » **ou** identité réelle si le marqueur est passé à `false` |

---

## Ce que ce plan refuse

- Copier le Convex de dev vers la prod.
- Un utilisateur admin public « pour la démo ».
- Stripe.js + montant lu dans le HTML.
- Un secret Stripe dans `PUBLIC_*` ou dans `settings.get`.
- Un Dockerfile / compose « Hostinger ».
- Committer `.pnpm-store`, `.cursor`, `.env.deploy`, `.local/`.
- Documenter le paiement dans le README **à la place** du câblage
  (bootstrap / écran admin / échec au démarrage).

---

## Ordre de merge recommandé

1. Hygiène gitignore (ce commit).
2. Merge `fix/chat-leads-notifications` → `main` (chat, leads, mesure).
3. Création du remote + push `main`.
4. Lot paiement (branche `feat/stripe-checkout`).
5. Bootstrap + premier Deploy Hostinger (staging ACME).
6. ACME prod + recette paiement live.
