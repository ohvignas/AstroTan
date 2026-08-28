---
name: umami-setup
description: Use FIRST for anything Umami in this repo — configuring a fresh instance, wiring a new deployment, deciding which variable goes where, or finding which Umami skill answers a question. Also use when the dashboard shows zeros on a site that clearly has traffic, when a variable seems to have no effect, when someone asks to "add a page to Umami", or when choosing what to turn on before opening a site to real visitors.
---

# Configurer Umami dans AstroTan — le point d'entrée

Ce skill répond à trois questions, dans cet ordre : **quoi configurer**,
**dans quel ordre**, et **quel autre skill lire ensuite**. Tout ce qui suit
a été mesuré contre la 3.3.1 épinglée dans `docker/docker-compose.yml`.

## La chose à comprendre avant tout le reste

**Il y a deux moitiés, elles ne vivent pas au même endroit, et l'une sans
l'autre ne produit rien — sans erreur.**

| | Ce que c'est | Où ça vit | Lu quand |
|---|---|---|---|
| `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID` | le script qui **écrit** les visites | secrets GitHub → build-args ; `apps/web/.env.local` en local | **au build** |
| `PUBLIC_UMAMI_RECORDER` *(facultative)* | charge `recorder.js` en plus — Replays, Heatmaps | idem | **au build** |
| `UMAMI_API_URL`, `UMAMI_API_WEBSITE_ID`, `UMAMI_API_USERNAME`, `UMAMI_API_PASSWORD` | les identifiants qui **lisent** les chiffres | déploiement Convex (`npx convex env set`) | à l'exécution |
| `UMAMI_API_SHARE_ID` *(facultative)* | le partage en lecture seule | déploiement Convex | à l'exécution |
| `UMAMI_DOMAIN`, `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET`, `UMAMI_TWO_FACTOR_ENCRYPTION_KEY` | le service lui-même | `.env` du VPS | au démarrage des conteneurs |

**« Au build » est le piège le plus coûteux.** Astro fige les `PUBLIC_*`
dans le bundle : les poser dans le `.env` du VPS ne fait *rien*, et le site
mesuré ne mesure rien. Ç'a été oublié une fois entièrement — le Dockerfile
ne déclarait aucun `ARG PUBLIC_UMAMI_*` et le workflow n'en passait aucun.
Toute image de production serait sortie sans le script, tableau de bord à
zéro pour toujours, sans que rien le signale.

**Le préfixe `UMAMI_API_` n'est pas décoratif** : le `.env` du VPS porte
déjà `UMAMI_APP_SECRET` et `UMAMI_DB_PASSWORD`, qui sont d'autres secrets.
Sans l'infixe, on colle l'un dans le champ de l'autre et aucun message ne
le dit.

## L'ordre, pour un déploiement neuf

1. **Démarrer la pile.** Redis est dedans et il n'est pas optionnel : sans
   lui, l'arrivée en un clic depuis l'administration répond
   `500 "Redis is disabled"`.
2. **Changer le mot de passe d'`admin`.** Umami crée `admin` / `umami`, le
   même sur toutes les installations du monde, et le sous-domaine est
   public. C'est la première chose, pas la dernière.
3. **Créer un compte de lecture dédié** (`view-only`) plutôt que de mettre
   `admin` dans `UMAMI_API_USERNAME`. Voir « Le choix qui engage » plus bas.
4. **Ajouter le site** (*Add website*) → noter le **Website ID**.
5. **Poser les quatre `UMAMI_API_*`** sur le déploiement Convex.
6. **Poser les deux `PUBLIC_UMAMI_*`** en secrets GitHub, puis
   **redéployer** — elles n'entrent que par le build.
7. **Vérifier**, sans quoi rien n'est vérifié :
   ```bash
   curl -s https://<le site>/ | grep -o 'data-website-id="[^"]*"'
   ```
   Une ligne : branché. Rien : les variables manquaient au build.

En local, remplacer 6 et 7 par `apps/web/.env.local` et
`pnpm --filter @astrotan/web run build`. La procédure détaillée, avec les
pièges rencontrés pour de vrai (mot de passe Postgres figé à
l'initialisation, Compose qui interpole le fichier entier), est dans
[`docker/README.md`](../../../docker/README.md) §13.5.

## Le choix qui engage : quel compte dans `UMAMI_API_USERNAME`

Ce compte sert à deux choses très différentes :

- **lire les chiffres** — un compte `view-only` suffit ;
- **ouvrir la session** de qui clique sur « Statistiques » — le lien SSO
  prête ce compte, il ne délègue pas l'identité de la personne.

Donc : mettre `admin` là-dedans donne l'administration d'Umami à tout
`owner`/`admin` du dashboard, et l'historique d'Umami ne distinguera
personne. Mettre un `view-only` protège les réglages au prix d'un mot de
passe à saisir le jour où l'on veut vraiment changer quelque chose dans
Umami. **Aucune des deux options n'est mauvaise ; l'ignorer, si.**

## Ce qu'il ne faut PAS construire

**Umami n'a pas de notion de page.** Il découvre les chemins en les
recevant. Créer une page ou un article dans l'administration ne demande
**aucune** action côté Umami : pas de déclaration, pas de synchronisation,
rien à supprimer ensuite. Prouvé — un chemin inventé à la seconde et envoyé
une fois est immédiatement interrogeable.

Écrire une synchronisation page ↔ Umami créerait un second modèle de
données pour une API qui n'en veut pas. Si quelqu'un le demande, c'est
cette section qu'il faut lui montrer.

## Avant d'ouvrir à de vrais visiteurs

Trois décisions, dans l'ordre où elles engagent :

1. **Replays et Heatmaps.** Éteints par défaut, et ce n'est pas la même
   promesse que le comptage : un replay rejoue ce qu'une personne a fait
   sur la page. La charge utile documentée cesse de décrire ce qui part, et
   l'argument « aucune donnée personnelle, donc pas de bandeau de
   consentement » ne tient plus tel quel. Lire `umami-replays` avant
   d'allumer, pas après.
2. **Le lien de partage** (`UMAMI_API_SHARE_ID`). Il rend le tableau de
   bord lisible **sans compte** : c'est un secret porteur. Pratique, et à
   décider consciemment.
3. **`/api/send` n'exige aucune authentification et ne vérifie pas
   l'origine**, tout en honorant le `timestamp` reçu. Qui connaît votre
   Website ID — il est public par construction — peut écrire dans votre
   historique, y compris antidaté. Ce n'est pas un défaut de ce dépôt,
   c'est le modèle d'Umami ; mais ne traitez pas ces chiffres comme une
   preuve.

## Quel skill lire ensuite

| La question | Le skill |
|---|---|
| L'intégration dans **ce** dépôt : Convex, SSO, tableau de bord, bouton | [`analytics-umami`](../analytics-umami/SKILL.md) |
| Lire des chiffres par HTTP : stats, séries, metrics, filtres | [`umami-read-api`](../umami-read-api/SKILL.md) |
| Construire un rapport : `POST /api/reports/*` | [`umami-reports-api`](../umami-reports-api/SKILL.md) |
| Faire entrer des données : script, events, `/api/send` | [`umami-tracking`](../umami-tracking/SKILL.md) |
| Gérer l'instance : comptes, sites, équipes, partages | [`umami-admin-api`](../umami-admin-api/SKILL.md) |
| Faire tourner le conteneur : variables, Redis, montées de version | [`umami-selfhost`](../umami-selfhost/SKILL.md) |

Puis un skill par fonctionnalité — `umami-overview`, `umami-events`,
`umami-sessions`, `umami-realtime`, `umami-performance`, `umami-compare`,
`umami-breakdown`, `umami-goals`, `umami-funnels`, `umami-journeys`,
`umami-retention`, `umami-replays`, `umami-heatmaps`, `umami-segments`,
`umami-cohorts`, `umami-utm`, `umami-revenue`.

## La règle qui a coûté le plus cher ici

**Un stub écrit par la même personne que le code encode les mêmes
hypothèses : il sera toujours d'accord.** Ce module a été livré vert —
tests, `tsc`, push Convex — avec quatre erreurs d'API, dont trois
silencieuses, découvertes le jour où un vrai Umami a tourné. Et une
cinquième a survécu à une vérification de plus, parce que la mesure
comparait deux appels qui différaient par **deux** choses à la fois.

Avant d'affirmer quoi que ce soit sur cette API : lancer l'instance, faire
l'appel, et ne changer qu'une variable à la fois.
