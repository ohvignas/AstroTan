---
name: umami-selfhost
description: Use when running, upgrading or debugging a self-hosted Umami container — environment variables, DATABASE_URL, APP_SECRET, REDIS_URL, TWO_FACTOR_ENCRYPTION_KEY, image tags, healthchecks, backups, or an upgrade to v3. Also use when the dashboard is slow after an upgrade, when everyone is logged out at once, when Umami cannot reach its database, when "Redis is disabled" appears, when choosing an image tag, or when deciding what to back up.
---

# Exploiter Umami 3 auto-hébergé

Vérifié contre le déploiement de ce dépôt : image
`ghcr.io/umami-software/umami:3.3.1`, PostgreSQL 17, Redis 8.2. Les points
d'exploitation ci-dessous ont été mesurés sur les conteneurs qui tournent,
pas repris de la doc.

## Ce que Redis fait réellement, et ce que sa perte coûte

La doc présente Redis comme facultatif. Sur cette instance, mesuré :

```bash
$ redis-cli --scan | head
auth:72b71352dc60778c811f444bbace8ccb
auth:01727725e27cde46b509125934192018
…
$ curl $UMAMI/api/me -H "Authorization: Bearer $TOKEN"
{… "authKey":"auth:0f4f056a93509f5692a2ef3ecc41a196" …}
$ redis-cli TTL auth:0f4f056a93509f5692a2ef3ecc41a196
3130
```

L'`authKey` rendu par `/api/me` **est** la clé Redis de la session. Trois
conséquences qui ne se déduisent pas de « cache facultatif » :

1. **Les jetons ne sont pas des JWT apatrides mais des sessions**, avec un
   TTL de l'ordre de l'heure. Une intégration qui garde un jeton en mémoire
   pour la journée verra des `401` en milieu de journée : il faut se
   reconnecter, ou traiter `401` comme « rejouer le login » plutôt que comme
   une erreur de configuration.
2. **`POST /api/auth/logout` révoque globalement** — c'est cette clé qui
   disparaît. Vérifié dans
   [`../umami-admin-api/SKILL.md`](../umami-admin-api/SKILL.md).
3. **Le Redis du compose ne persiste rien** (`save` vide, `appendonly no`) :
   un redémarrage de Redis déconnecte tout le monde d'un coup. C'est
   acceptable — ce sont des sessions courtes — mais il faut le savoir avant
   de diagnostiquer « tous les utilisateurs éjectés simultanément » comme
   une compromission. **Ne pas ajouter de persistance** pour autant : ces
   clés n'ont pas de valeur à survivre, et les jetons d'échange SSO expirent
   en minutes.

Sans `REDIS_URL`, `POST /api/auth/sso` répond `500 {"message":"Redis is
disabled"}` — un message qui ne parle pas d'authentification et qu'on lit
d'abord comme une panne réseau.

## Sonder une instance sans identifiants

Deux points d'entrée répondent **sans authentification**, vérifiés :

```bash
curl $UMAMI/api/heartbeat   # {"ok":true}
curl $UMAMI/api/config      # {"cloudMode":false,"privateMode":false,
                            #  "sessionDeletionEnabled":true,
                            #  "telemetryDisabled":true,"updatesDisabled":false}
```

`/api/heartbeat` est exactement ce que le healthcheck de l'image
interroge — utile pour un readiness probe, et pour séparer « le conteneur
est mort » de « mes identifiants sont mauvais » :

```
CMD-SHELL curl -fsS http://127.0.0.1:3000/api/heartbeat || exit 1
interval 30s · timeout 5s · start_period 90s · retries 3
```

Le `start_period` de 90 s n'est pas décoratif : Umami migre son schéma au
démarrage et met un temps notable à répondre sur une base neuve. Un
orchestrateur plus impatient le tue en boucle.

`/api/config` divulgue le mode d'une instance à qui la sonde. Rien de
secret, mais c'est une information gratuite pour un attaquant qui cherche à
savoir s'il regarde du Cloud ou de l'auto-hébergé.

## Les variables, et celles qui se confondent

Le conteneur qui tourne ne porte que ceci — c'est le socle minimal réel :

```
DATABASE_URL  APP_SECRET  REDIS_URL  TWO_FACTOR_ENCRYPTION_KEY
PORT  NODE_ENV  DISABLE_TELEMETRY
```

- **`DATABASE_URL` est la seule strictement obligatoire.**
- Le mot de passe entre dans une **URL**. Un `@`, un `/` ou un `#` non
  encodés coupent l'URL en silence et Umami échoue sur un hôte qui n'existe
  pas — message trompeur pour une faute de mot de passe. Générer en
  hexadécimal (`openssl rand -hex 32`) supprime le problème.
- **`TWO_FACTOR_ENCRYPTION_KEY` doit être posée _avant_ que quiconque active
  la 2FA.** La perdre force le réenrôlement de tous les comptes concernés,
  et il n'y a pas de porte de sortie par l'interface.
- **`APP_SECRET` ne se change pas à la légère** : il signe les jetons. Le
  faire tourner invalide toutes les sessions.

Attention au voisinage de noms dans un même `.env`. Ce dépôt distingue
délibérément `UMAMI_DB_PASSWORD` / `UMAMI_APP_SECRET` (le service) de
`UMAMI_API_*` (les identifiants de lecture) : sans l'infixe, un secret collé
dans le champ d'un autre ne produit aucun message qui le dise.

## Le tag d'image

`latest` et `postgresql-latest` pointent aujourd'hui sur 3.3.1 et bougeront
au prochain amont. **Épingler la version exacte**, et vérifier le digest :
une montée de majeure change le schéma de base au démarrage, et le rollback
d'image seul ne le défait pas.

Depuis la v3, l'image ne porte plus le préfixe `postgresql-` : **v3 ne
supporte plus que PostgreSQL**. `postgresql-latest` n'est qu'un alias
conservé. Une installation MySQL ne peut pas monter en v3 sans migrer de
moteur au préalable.

## Après une montée en v3 : le `ANALYZE` que personne ne lance

La doc le mentionne et il se paie cher si on l'oublie : après la migration
vers v3, lancer

```sql
ANALYZE;
```

sur la base PostgreSQL. Sans cela le planificateur travaille sur des
statistiques périmées et le tableau de bord reste lent — durablement, sans
rien signaler. C'est un symptôme (« Umami 3 est lent ») dont la cause n'a
aucun rapport apparent avec sa description.

## Sauvegardes

**Il n'existe pas de procédure de sauvegarde dans la doc d'Umami** — elle ne
parle que de « sauvegarder avant la migration v1→v2 ». À poser soi-même :

- **PostgreSQL est la seule chose à sauvegarder.** Tout est dedans :
  comptes, sites, événements, rapports.
- **Redis n'a rien à sauvegarder** (§1) et ne doit pas être restauré.
- Il n'y a **pas d'export applicatif** ni de corbeille : `POST
  /api/websites/{id}/reset` et `DELETE` sont immédiats et sans
  confirmation. La sauvegarde de base est le seul filet.

## Rétention

Umami ne purge rien de lui-même sur cette version : les événements
s'accumulent indéfiniment. `sessionDeletionEnabled: true` dans `/api/config`
indique que la suppression de sessions est permise côté application, mais
c'est un geste manuel, pas une politique. Une rétention réelle se pose au
niveau de PostgreSQL, et se décide avant que la table ne devienne grosse.

## Ce qui n'a pas pu être vérifié

- **Le comportement sans Redis** : l'instance de test en a un, et le retirer
  aurait cassé le déploiement local en cours d'usage. Ce que dit ce skill du
  cas « Redis absent » vient de la doc et du message d'erreur observé, pas
  d'une mesure.
- **La migration v1→v2 et le passage MySQL→PostgreSQL** : aucune base
  ancienne sous la main.
- **Le `ANALYZE` après montée** : l'instance est née en 3.3.1, il n'y a pas
  eu de migration à observer. Point repris de la doc, signalé comme tel.
- **La 2FA** : la clé est posée, aucun compte ne l'a activée — l'enrôler
  aurait laissé l'instance dans un état non réversible.
- **Les hébergeurs** (Vercel, Railway, Fly.io, Supabase, Neon…) : la doc en
  couvre une vingtaine, aucun n'a été essayé. Rien n'en est repris ici,
  puisque la recopier n'apporterait rien.
