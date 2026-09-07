# Démo : réglages visibles, stats réelles, DataForSEO

**Date** : 2026-09-07
**Statut** : tranché par le produit (voir les réglages, stats live partout,
DataForSEO recâblé, Umami in-app sans dashboard). Ambiguïtés restantes
réglées au défaut le plus sûr.

**Invariants** : [`2026-08-27-astrotan-design.md`](2026-08-27-astrotan-design.md),
[`2026-08-29-secrets-et-chiffrement.md`](2026-08-29-secrets-et-chiffrement.md).

## 1. Pourquoi les réglages avaient disparu

Le compte `/demo-enter` est un **editor** (`DEMO_ACCOUNT_EMAIL`). La barre
latérale ne montrait « Réglages » qu'à owner/admin
(`apps/admin/src/components/app-sidebar.tsx`, `canWriteSettings = canSso`).
Les routes `/settings/*` existaient ; le menu les cachait. En plus,
`useSecretsAccess` sautait `secrets.status` pour un editor, et les
écrans IA / Resend / DataForSEO affichaient « Réservé au propriétaire »
au lieu de l'état configuré / non.

Ce n'était pas un bug de route : c'était la courtoisie « un editor n'écrit
pas les réglages, donc on lui cache le lien ». Pour la démo publique, ça
rend le produit invisible.

## 2. Matrice (écran × démo × owner)

| Écran | Démo (editor sandbox) | Owner / admin (hors compte démo) |
|---|---|---|
| Menu Réglages | voir | voir + écrire |
| Identité, domaine, emails (textes), agent (apparence) | voir, champs inertes | écrire (`settings.update*`) |
| Jetons (OpenRouter, Resend, Umami, DataForSEO, Calendar) | **configuré / non**, jamais la valeur, jamais le login DataForSEO | saisir / remplacer / effacer |
| `SECRETS_KEY`, env Convex, `DEMO_*` | invisibles (pas dans l'UI) | CLI seulement |
| Invitation, rôles, mot de passe | verrouillé (`exigerPasDemo`) | owner/admin |
| Publication pages de base | gelée | owner/admin |
| Audience Umami (accueil + `/statistiques`) | **les mêmes chiffres live** | idem |
| Lien dashboard admin Umami | **aucun** | **aucun** |
| DataForSEO (pastilles, listes, rangs déjà en base) | voir | voir + Relever (payant, `exigerPasDemo`) |
| `secrets.set` / `dataforseo.enregistrer` | `DEMO_FORBIDDEN` | owner/admin |

Défaut sûr : tout secret / écriture d'infra est **lecture seule** côté démo.
Les appels Umami / lecture DataForSEO partent du serveur (clés jamais
exposées). Un « essai » qui **écrit** ou **facture** reste `exigerPasDemo`.

Un editor hors bac à sable voit aussi les réglages en lecture : l'UI le
savait déjà (`canWrite === false`). On ne recache plus le menu.

## 3. Stats Umami

`/statistiques` n'est plus un relais SSO vers Umami. C'est la même carte
d'audience que l'accueil (`SiteDashboardPanel`), sans tuiles de contenu.
La barre pointe une route interne, jamais `umami.dashboard` ni
`analytics.ssoLink`. L'action SSO reste côté serveur (opérateur / debug)
mais n'a plus de lien.

## 4. DataForSEO

Les identifiants vivaient dans la table `secrets` du Convex **local
anonyme**. On les rejoue sur le déploiement SRV2 (même enveloppe que
OpenRouter : `SECRETS_KEY` + `secrets.set`). Jamais imprimés.

`dataforseo.identifiants` : editor / démo → `{ login: null, passwordPose }`.
Owner/admin gardent le login en clair (ce n'est pas un secret, déjà
documenté).

## 5. Tests

- `secrets.status` lisible par editor ; `set` / `clear` toujours refusés.
- `identifiants` : editor sans login.
- Barre : Réglages toujours, Statistiques interne, aucun `external` Umami.
- Dashboard : aucun « Ouvrir Umami » / « Tout le détail ».
- Formulaires jetons : `canWrite === false` → « Configuré » / « Non
  configuré », pas de champ.
