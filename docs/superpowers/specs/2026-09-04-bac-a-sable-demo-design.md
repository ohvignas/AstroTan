# Bac à sable démo — design

**Date** : 2026-09-04  
**Statut** : validé (approche B)  
**Branche de travail prévue** : `feat/bac-a-sable-demo` → PR vers `main` → merge dans `demo`

## 1. Objectif

Sur l’instance publique (astrotan.illith.com), un visiteur clique **Tester**
et se retrouve dans le **vrai** dashboard, avec un compte réel, pour
écrire un article, voir l’aperçu sur l’URL réelle, et essayer l’IA.

Ce n’est pas un faux écran. Ce n’est pas non plus l’admin owner. C’est
un editor bridé, sur une instance dédiée, qui se remet à zéro.

Un clone du template n’a **jamais** ce bouton, sauf si l’adoptant pose
explicitement `DEMO_SANDBOX=true` — ce qu’il ne doit pas faire.

## 2. Décisions

| Décision | Choix | Pourquoi |
|---|---|---|
| Isolation | Une instance (SRV2), pas un tenant par visiteur | AstroTan est mono-tenant. Le multi-tenant est un autre produit. |
| Entrée | Bouton → session, **sans mot de passe affiché** | Un `demo`/`demo` public est un backdoor en quelques semaines. |
| Rôle | `editor` existant + refus supplémentaires | Pas de 4ᵉ rôle (hooks Better Auth, matrice, schéma). |
| Publication | Interdite | Le site public des autres visiteurs ne doit pas changer. L’aperçu HMAC suffit. |
| IA | Autorisée, modèle **verrouillé**, pas cher | Clé OpenRouter (fournie hors Git) sur le Convex de démo. Le slug est `DEMO_OPENROUTER_MODEL` — **pas** le picker `OPENROUTER_MODELS`. `settings.update` refuse tout champ `openRouter*`. |
| Images / SEO payant / e-mails / webhooks | Interdits | Tout ce qui sort de la machine ou coûte hors le texte IA. |
| Reset | Cron horaire | Remet seed + purge ce que le compte démo a créé. |
| Code | Dans le dépôt, **inerte** sans le flag | Une seule codebase. `main` reste un template vierge à l’usage. |

## 3. Flag

`DEMO_SANDBOX` dans l’environnement Convex (`true` / absent).

- Absent ou autre que `true` : `demo.ouvert` rend `false`, `/demo-enter`
  répond 404, le bouton n’existe pas, le cron de restore est un no-op.
- `true` **uniquement** sur le Convex de SRV2.

Variables compagnons, Convex uniquement, **jamais** dans `settings`
(query publique) :

| Variable | Rôle |
|---|---|
| `DEMO_SANDBOX` | Allume le bac à sable. |
| `DEMO_ACCOUNT_EMAIL` | Compte editor dédié (ex. `demo@astrotan.invalid`). |
| `DEMO_ACCOUNT_PASSWORD` | Mot de passe du compte. Jamais affiché, jamais dans le navigateur. |
| `DEMO_ENTER_SECRET` | Secret partagé admin-conteneur ↔ Convex pour échanger les credentials côté serveur. |
| `DEMO_OPENROUTER_MODEL` | Slug OpenRouter **libre** (pas la liste du picker). Ex. un flash-lite. Obligatoire si le flag est `true`. |

`scripts/check-env-wiring.mjs` les documente dans
`packages/backend/.env.example`. Un déploiement avec le flag et sans
modèle ou sans secret **refuse au premier `demo.credentials`**, proprement
(`DEMO_NOT_CONFIGURED`), pas au boot de tout Convex (un adoptant n’a
pas le flag). La clé `OPENROUTER_API_KEY` se pose comme aujourd’hui
(env Convex). C’est l’opérateur de la démo qui la met sur SRV2.

## 4. Compte démo

Un utilisateur Better Auth, rôle `editor`, créé par
`demo.seedSandbox` (internalMutation, idempotent par e-mail).

- Pas owner, pas admin.
- Ne peut pas changer son mot de passe (l’écran compte le masque ; la
  mutation / endpoint Better Auth le refuse si l’acteur est ce compte).
- Session 45 minutes (`session.expiresIn` déjà géré par Better Auth ;
  on pose `maxAge` sur la session créée, ou on révoque au cron).
- Plusieurs visiteurs **partagent** ce compte (mono-tenant). Le bandeau
  le dit. Le reset horaire limite les dégâts.

Ce n’est pas un second owner caché. L’owner Illith reste sur invitation,
hors de ce chemin.

## 5. Entrée — bouton Tester

```
site public                         admin
   │                                  │
   │  demo.ouvert === true            │
   │  lien GET {adminUrl}/demo-enter  │
   ├─────────────────────────────────►│
   │                                  │  action demo.credentials
   │                                  │  (secret serveur + rate limit)
   │                                  │  POST /api/auth/sign-in/email
   │                                  │  cookie same-origin
   │                                  │  302 /
```

Le site public **n’envoie aucun secret**. Il lit `demo.ouvert` (query
publique : `{ actif: boolean, adminUrl: string | null }`). `adminUrl`
vient de `deriverOrigines` **seulement** si `actif` ; sinon
`{ actif: false, adminUrl: null }`. `settings.environment` exige un
rôle — le site public ne l’appelle pas.

`/demo-enter` est une route **serveur** de l’admin (pas `_authed`) :

1. Si `demo.ouvert` est faux → 404 (une adoptante qui tape l’URL n’a
   rien).
2. Appelle `demo.credentials` avec `DEMO_ENTER_SECRET` lu dans
   `process.env` du conteneur admin (pas `VITE_*`).
3. Convex vérifie le secret (comparaison à temps constant), le flag, le
   rate limit, rend `{ email, password }` **une fois**, à ce serveur.
4. L’admin POST vers son propre `/api/auth/sign-in/email` (le proxy
   existant, cookies same-origin — `apps/admin/src/routes/api/auth/$.ts`).
5. Redirect `/`.

Rate limit (composant déjà là) : 10 entrées / heure / IP
(`x-forwarded-for` déjà honoré par le routage). Un 429 lisible.

## 6. Ce que le compte a le droit de faire

**Oui — vrai produit**

- Lire le dashboard (pages, articles, médias, leads en lecture).
- Créer / modifier **ses** brouillons d’articles (déjà : editor +
  `requireOwnDocument`).
- Médias qu’il uploade (plafond : 10 fichiers ou 20 Mo par reset —
  `demo.quota`).
- **Prévisualiser** sur l’URL réelle (`?t=`).
- `ai.generateSeoGeo` sur **ses** brouillons, modèle imposé, quota
  **15 appels / heure pour le compte démo** (clé = userId, pas l’IP :
  `useAction` n’a pas l’IP du navigateur ; le compte est partagé, c’est
  le vrai plafond de coût).
- Voir les écrans (SEO, identité) en lecture : l’UI les montre, les
  mutations owner/admin refusent déjà.

**Non — vérifié dans la mutation / action, pas seulement masqué**

| Famille | Exemples | Comment |
|---|---|---|
| Publier | `pages.publishPage`, `posts.publishPost` | `exigerPasDemo` en plus du rôle. |
| Identité du déploiement | `settings.update` (champs `openRouter*`), domaine, DNS | déjà owner/admin ; + refus `openRouter*` dès que le flag est on. |
| Sorties | `emails.*` envoi, webhook, `apiTokens`, connecteurs, MCP, DataForSEO | `exigerPasDemo`. |
| Compte | invitations, `users.*`, secrets | déjà owner/admin. Mot de passe : hook Better Auth `/change-password` refuse le compte démo. |
| IA chère | `aiImage`, OCR | `exigerPasDemo`. |

`exigerPasDemo(authUser, env)` : lève `DEMO_FORBIDDEN` si
`estCompteDemo` (e-mail normalisé = `DEMO_ACCOUNT_EMAIL` **et** flag on).
Un editor **humain** invité n’est pas bridé — seul le compte désigné
l’est. (L’owner n’invite personne sur la démo publique.)

Helper unique : `packages/backend/convex/lib/demoSandbox.ts`.
Chaque mutation listée ci-dessus l’appelle. La matrice
`MUTATION_REGISTRY` ne gagne **pas** un 4ᵉ rôle : le compte démo est un
editor + un refus extra.

## 7. Modèle IA verrouillé

Quand `DEMO_SANDBOX === true` :

- `modeleEffectif` ignore `settings.openRouter*` et lit
  `DEMO_OPENROUTER_MODEL` **tel quel** (slug OpenRouter libre, pas
  `assertOpenRouterModel` — le modèle pas cher n’est pas forcément dans
  le picker produit).
- `settings.update` refuse tout champ `openRouter*` (même pour owner).
- L’écran admin masque le sélecteur (lit `environment.demoSandbox`).
- Le chat visiteur public utilise le même slug : une seule facture.

Pas de clé dans Git. L’opérateur pose `OPENROUTER_API_KEY` +
`DEMO_OPENROUTER_MODEL` sur le Convex SRV2.

## 8. Reset

Cron `demo-restore`, toutes les heures, `internal.demo.restaurer` :

1. No-op si le flag est faux.
2. Supprime posts, médias et fichiers `_storage` dont `createdBy` est
   le compte démo.
3. Relance la partie contenu de `seed:demoContent` (idempotent).
4. Révoque les sessions du compte démo (les visiteurs encore ouverts
   retombent sur `/login` — le bandeau l’avait annoncé).
5. Recrée le compte s’il a disparu.

Ne touche pas : owner, pages du template, `declaredDomain`, secrets.

## 9. UI

**Site public** (`apps/web`) : bouton « Tester le dashboard » dans le
Hero de `/` (CTA secondaire ou tertiaire), uniquement si
`demo.ouvert`. Texte : ils atterrissent dans un bac à sable partagé,
reset toutes les heures.

**Admin** : bandeau persistant dès que l’acteur est le compte démo.
« Bac à sable partagé — vos brouillons sont effacés toutes les heures.
Rien n’est publié sur le site. »

Les entrées menu déjà inaccessibles à un editor restent cachées
(`useSettingsAccess`). Rien à inventer de plus.

## 10. Ce que ça ne fait pas

- Pas de tenant par visiteur.
- Pas de mot de passe affiché sur le site.
- Pas de publication, même temporaire.
- Pas d’envoi d’e-mail réel, pas de webhook, pas de DataForSEO.
- Pas de code spécifique Illith en dur : le flag et les env suffisent.
- Pas d’allumage sur `main` d’un adoptant.

## 11. Tests qui tiennent l’invariant

- `demo.ouvert` est faux sans flag.
- `demo.credentials` refuse un mauvais secret et un flag absent.
- L’acteur démo se fait jeter de `publishPage`, `settings.update`
  (modèle), `secrets.set`, `invitations.create`, `dataforseo.*`.
- `generateSeoGeo` en sandbox utilise `DEMO_OPENROUTER_MODEL`, jamais
  `settings.openRouterModel` ; le 16ᵉ appel du compte démo dans l’heure
  lève `DEMO_RATE_LIMITED`.
- `settings.update({ openRouterModel })` refuse dès que le flag est on,
  **y compris pour un owner**.
- `restaurer` no-op sans flag ; avec flag, les posts du compte démo
  disparaissent, les autres restent.
- Un editor qui n’est **pas** le compte démo n’est pas bridé par
  `estCompteDemo`.

## 12. Sources

- Compte partagé publié = backdoor : [Binnacle, 2026-05](https://binnacleai.com/blog/binnacle-demo-lockdown-2026-05-16)
- Playground + reset + flag dédié : [Backlex demo mode](https://backlex.com/docs/demo-mode/)
- Isolation par environnement, pas par raccourci prod : [AWS sandbox accounts](https://aws.amazon.com/blogs/mt/best-practices-creating-managing-sandbox-accounts-aws/)
- Invariants AstroTan : `CLAUDE.md` 1–4, skill `better-auth`
