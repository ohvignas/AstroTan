---
name: umami-admin-api
description: Use when managing an Umami instance through its API rather than its UI — logging in, creating or updating websites, share URLs, users, roles, teams, resetting or deleting a site's data. Also use when GET /api/users answers 405, when a working token suddenly returns 401, when POST /api/auth/sso answers "Redis is disabled", when x-umami-api-key is rejected, when a share link needs to be revoked, or when scripting Umami provisioning for a fresh deployment.
---

# Administrer Umami 3 par l'API

Vérifié contre une instance **3.3.1 auto-hébergée**, en créant puis
supprimant des ressources jetables. Ce qui suit ne reprend pas la doc en
ligne : seulement ce qui diverge, ce qui n'y figure pas, et ce qui casse.

## L'authentification, et le piège qui coupe la production

```bash
curl -X POST $UMAMI/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"umami"}'      # → {"token":…,"user":{…}}
curl $UMAMI/api/me -H "Authorization: Bearer $TOKEN"
```

**`POST /api/auth/logout` révoque le jeton côté serveur, globalement.**
Mesuré : après `logout`, le jeton d'origine rend `401` sur `/api/me`, et un
nouveau `login` rend un jeton **différent** — ce ne sont donc pas des JWT
apatrides mais des sessions.

Conséquence directe : dans une intégration qui partage un compte de service,
un `logout` appelé « proprement » en fin de traitement **déconnecte tous les
appelants concurrents**. Ne pas appeler `logout` depuis un client
automatisé ; laisser le jeton expirer.

Autres points mesurés :

- `POST /api/auth/verify` rend l'utilisateur courant (`200`) — la manière
  bon marché de tester un jeton.
- **`x-umami-api-key` rend `401` en auto-hébergé.** C'est un mécanisme
  Umami Cloud ; la doc ne sépare pas nettement les deux. En auto-hébergé,
  c'est `Authorization: Bearer` ou rien.
- Jeton absent, invalide ou révoqué rendent tous le même `401
  {"code":"unauthorized"}` : impossible de distinguer « expiré » de
  « malformé » depuis la réponse.
- `POST /api/auth/sso` rend un jeton d'échange à usage unique, **et exige
  Redis** : sans lui, `500 {"message":"Redis is disabled"}` — un message qui
  ne parle pas d'authentification et qu'on lit d'abord comme une panne.

## Les sites

**La mise à jour se fait en `POST` sur la ressource**, pas en `PUT` ni
`PATCH`, et elle est partielle :

```bash
curl -X POST $UMAMI/api/websites -d '{"name":"x","domain":"x.example"}'   # créer
curl -X POST $UMAMI/api/websites/$ID -d '{"name":"nouveau nom"}'          # modifier
curl -X POST $UMAMI/api/websites/$ID/reset                               # vider les données
curl -X DELETE $UMAMI/api/websites/$ID                                   # supprimer
```

`reset` et `DELETE` rendent `{"ok":true}` et **ne demandent aucune
confirmation**. `reset` a été vérifié : les statistiques retombent à zéro
immédiatement. Il n'y a pas de corbeille — la colonne `deletedAt` existe
dans les réponses mais aucun point d'entrée ne restaure.

`GET /api/websites` et `GET /api/admin/websites` diffèrent : le second est
réservé aux admins et joint l'équipe propriétaire.

**`?query=` est accepté et ignoré** sur les deux : une valeur qui ne peut
rien matcher rend la liste complète. Filtrer côté client.

## Les partages publics — un secret permanent, à traiter comme tel

Le partage se pose par une mise à jour ordinaire du site :

```bash
curl -X POST $UMAMI/api/websites/$ID -d '{"shareId":"mon-slug"}'
```

Ensuite `GET /api/share/mon-slug` répond **sans aucune authentification** et
rend un JWT donnant accès en lecture au site :

```json
{"shareId":"95c0981c-…","shareType":1,
 "parameters":{"events":true,"overview":true},
 "websiteId":"…","token":"eyJ…"}
```

Deux choses à retenir :

- Le `shareId` que l'on **pose** est un slug lisible ; le `shareId` que
  l'API **rend** est un UUID interne. Ce sont deux valeurs différentes sous
  le même nom, dans le même flux.
- Ce lien est un **porteur non expirable**. Il ne se révoque qu'en
  réécrivant `shareId` (à `null` pour couper). Quiconque a vu l'URL garde
  l'accès jusque-là — un modèle nettement plus faible que le jeton d'aperçu
  HMAC expirable de l'invariant 2 de `CLAUDE.md`. **Ne pas le prendre pour
  exemple** en écrivant du partage dans ce dépôt.

## Utilisateurs et rôles

**`GET /api/users` rend `405`**, alors que la doc le présente comme le
listage des utilisateurs. Le vrai chemin est `GET /api/admin/users`.
`GET /api/users/{id}` fonctionne (`200`), et `POST /api/users` crée.

Le vocabulaire des rôles, énuméré par l'API elle-même dans son refus :

- comptes : `admin` | `user` | `view-only`
- équipes : `team-owner` (et les rôles d'équipe associés)

Mot de passe : **8 caractères minimum**, refus explicite en dessous. Ces
contraintes ne sont lisibles nulle part ailleurs que dans l'erreur.

## Les équipes

`POST /api/teams` rend **un tableau de deux objets** — l'équipe, puis
l'adhésion du créateur — là où tout le reste de l'API rend un objet :

```json
[{"id":"…","name":"probe-team","accessCode":"team_XvgOQVUUJLrzdZSo",…},
 {"id":"…","teamId":"…","userId":"…","role":"team-owner",…}]
```

Un client qui fait `res.id` obtient `undefined` sans erreur. L'`accessCode`
est le mécanisme d'adhésion en auto-hébergé (les invitations par email sont
signalées « Cloud » dans la doc) : c'est **un secret permanent**, comme un
lien de partage.

`GET /api/teams` et `DELETE /api/teams/{id}` se comportent normalement.

## Formes de réponse et erreurs

- Les listes rendent `{data, count, page, pageSize, orderBy}` ; `page`,
  `pageSize` et `orderBy` fonctionnent, `pageSize=9999` est accepté sans
  plafond.
- Les refus de validation sont des erreurs **zod détaillées** qui énumèrent
  les valeurs admises. C'est la meilleure documentation disponible de cette
  API : envoyer un corps vide et lire le refus donne le schéma exact, plus
  vite et plus sûrement que la page en ligne.
- **Un chemin inexistant rend `404` en `text/html`** (la page Next.js), pas
  du JSON. Un client qui parse systématiquement échoue sur une erreur de
  syntaxe qui ne dit pas qu'on s'est trompé d'URL.

## Amorcer une instance neuve par script

L'ordre qui marche, sans passer par l'interface :

1. `POST /api/auth/login` avec `admin` / `umami` — identifiants par défaut,
   **identiques sur toute installation**, donc à changer avant d'exposer
   quoi que ce soit.
2. `POST /api/users/{id}/password` ou l'interface, pour ce mot de passe.
3. `POST /api/websites` → noter l'`id` rendu : c'est le `data-website-id`
   public du traqueur ([`../umami-tracking/SKILL.md`](../umami-tracking/SKILL.md)).
4. `POST /api/websites/{id}` avec `shareId` si un lien public est voulu — en
   sachant ce que §partages dit de sa durée de vie.

## Ce qui n'a pas pu être vérifié

- **La 2FA** : `TWO_FACTOR_ENCRYPTION_KEY` est posée sur le conteneur, mais
  aucun compte ne l'avait activée et l'enrôler aurait laissé l'instance dans
  un état non réversible sans le secret.
- Les **rôles autres qu'`admin`** : un seul compte existait, et les créer
  puis les faire jouer aurait demandé plusieurs sessions concurrentes. Le
  vocabulaire est vérifié, **pas** ce que chaque rôle peut réellement faire.
- Les **appartenances d'équipe** au-delà de la création : aucun second
  compte à faire adhérer.
- Tout ce qui est **Umami Cloud** — clés d'API, base d'URL `/v1`,
  limitation à 50 appels / 15 s : hors d'atteinte depuis une instance
  auto-hébergée, et donc rapporté ici comme non vérifié plutôt que repris de
  la doc.
