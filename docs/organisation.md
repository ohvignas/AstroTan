# Organisation du dépôt

AstroTan n’est pas une application qu’on déploie une fois. C’est un
**template**. Ce fichier dit où vit quoi, pour ne plus mélanger le produit,
la démo publique et l’app qui le vend.

## Les quatre objets

```
main          template vierge     →  ce que les gens clonent
  │
  │  merge quand c’est bon pour le site public
  ▼
demo          main + couche démo  →  ce que les visiteurs essaient
  │
  ▼
SRV2          une install         →  secrets, DNS, contenu. Pas du code.
```

| Objet | Où | Qu’est-ce que c’est |
|---|---|---|
| **Template** | branche [`main`](https://github.com/ohvignas/AstroTan) | Le produit. Vierge : cloner, `pnpm bootstrap`, déployer. |
| **Couche démo** | branche [`demo`](https://github.com/ohvignas/AstroTan/tree/demo) | `main` + ce qu’il faut pour essayer en public (contenu d’exemple, éventuellement un bandeau). |
| **Instance démo** | VPS SRV2 (`astrotan.illith.com`) | Une *install* de `demo`. Domaines, `.env`, données Convex. |
| **App de vente** | hors de ce dépôt | Stripe, pages paiement, envoi du dossier **sans** le code de paiement ni les `.env`. |

Ce ne sont **pas deux applications** dans Git. C’est le même code, deux
branches, plus une machine et une app à part.

## Qu’est-ce qui va où

La question à se poser avant chaque changement :

> Si le prochain client clone `main` demain, a-t-il besoin de ça pour que
> **son** site marche ?

| Oui → `main` | Seulement pour essayer le site public → `demo` | Ni l’un ni l’autre |
|---|---|---|
| Une feature du CMS, de l’admin, du site | Un bandeau « ceci est une démo » | Les secrets (`~/astrotan/.env`) |
| Le seed de structure (`seed:demoContent`) — sans lui, `/` répond 404 | Un compte d’essai public | Les DNS Illith, les labels Traefik de **cette** machine |
| Un écran de réglages, un invariant | Du contenu tapé pour la vitrine de démo | Le checkout Stripe de l’offre Complet |

**Jamais dans Git :** mots de passe, clés Stripe, `.env`, invitation owner.
**Jamais dans `main` :** domaines Illith en dur, paiement de vente, bricolage
propre au VPS.
**Jamais développé sur le serveur** pour être recopié ensuite. Le VPS n’est
pas une source de vérité.

## Flux Git

```
feat/…  →  pull request  →  main  →  merge dans demo  →  site public
```

1. Une branche par sujet (`feat/…`, `fix/…`).
2. Un pull request vers **`main`**.
3. Quand le changement doit se voir sur astrotan.illith.com :

```bash
git checkout demo
git merge main
git push
```

On ne pousse pas une feature directement sur `main` ni sur `demo`.

## Déploiement

| Qui | Branche qui déploie | Comment |
|---|---|---|
| Un adoptant qui a cloné le template | `main` | Workflow GitHub *Deploy* (automatique). |
| Ce dépôt (`ohvignas/AstroTan`) | `demo` | **À la main** pour l’instant. |

Pourquoi ce dépôt ne lance pas *Deploy* tout seul : le VPS de démo partage
déjà les ports 80/443 avec un autre Traefik (ReplayConnect). Lancer la pile
officielle les prendrait et casserait l’existant. Le jour où la démo a un
VPS à elle, un push sur `demo` suffira.

L’instance garde ses secrets dans `~/astrotan/.env` (jamais écrasé par un
`rsync`). Le contenu d’exemple vient de `seed:demoContent`, déjà dans
`main` — c’est la couche démo *minimum*, celle sans laquelle un site neuf
répond 404.

## Démo en ligne

| URL | Rôle |
|---|---|
| https://astrotan.illith.com | Site public d’essai |
| https://admin.astrotan.illith.com | Dashboard (invitation seule) |

SSH (clé locale `~/.ssh/astrotan_deploy`) :

```bash
ssh srv2-illith-deploy    # user deploy
ssh srv2-illith           # user root
```

## Voir aussi

| Fichier | Pour qui |
|---|---|
| [`README.md`](../README.md) | Mise en service d’un clone (adoptant) |
| [`AGENTS.md`](../AGENTS.md) | Agents de code — rappel court + commandes |
| [`CLAUDE.md`](../CLAUDE.md) | Conventions et invariants |
| [`docker/README.md`](../docker/README.md) | VPS, DNS, certificats, rollback |
