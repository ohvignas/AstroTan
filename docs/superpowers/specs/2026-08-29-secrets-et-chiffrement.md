# Où vivent les secrets, et pourquoi

**Décision, 29 août 2026.** Ce document existe parce que la question s'est
posée deux fois dans la même journée, avec deux réponses opposées, et que
la seconde change le modèle de sécurité du produit. Ce qui suit est le
raisonnement, ses sources, et ce qu'on a refusé.

## Le problème

L'administration doit pouvoir afficher si un jeton est configuré — clé
OpenRouter, identifiants de l'API Umami, clé Resend — et, à la demande de
l'opérateur, permettre de le **saisir depuis l'écran**.

La première réponse a été : « la clé vit dans l'environnement Convex, jamais
en base ». C'est la bonne réponse tant qu'on accepte que la mise en service
passe par une ligne de commande. Elle a été retenue le matin, puis écartée
l'après-midi au profit d'une saisie dans l'interface.

## Ce que la documentation établit

Trois faits vérifiés, et non supposés :

1. **Les variables d'environnement Convex ne se posent qu'au déploiement** —
   par le tableau de bord ou la CLI. Aucune API ne permet de les écrire
   depuis une mutation ou une action. La documentation avertit même de ne
   pas conditionner ses exports dessus, parce que l'ensemble des fonctions
   appelables est figé au déploiement et n'est pas réévalué quand une
   variable change.
   <https://docs.convex.dev/production/environment-variables>

2. **La Web Crypto API est disponible dans le runtime Convex** : `crypto`,
   `CryptoKey` et `SubtleCrypto` figurent parmi les API supportées, dans les
   queries, les mutations et les actions.
   <https://docs.convex.dev/functions/runtimes>

3. **Convex documente le chiffrement pour les données sensibles**, mais son
   exemple public chiffre **dans le navigateur** et ne déchiffre jamais côté
   serveur. Inapplicable ici : nos actions doivent se *servir* du jeton pour
   appeler Umami, Resend et OpenRouter.
   <https://stack.convex.dev/end-to-end-encryption-with-convex>

Le premier fait ferme la porte la plus sûre. Le deuxième ouvre la seconde.

## Ce qu'on a refusé

**Stocker le jeton en clair dans la table `settings`.** C'est la solution
qui vient en premier, et c'est celle qui a déjà coûté : `settings.get` est
une query **publique**, appelée par le site sans session, et elle a renvoyé
`leadWebhookSecret` à qui le demandait. Le correctif a été une projection
explicite. Remettre un secret dans cette table, « juste en optionnel »,
rouvrirait la même porte à la première query qui oublierait la projection.

**Une server function TanStack Start.** Elle garderait bien un secret dans
l'environnement de l'admin, hors du navigateur. Mais ce sont les actions
**Convex** qui appellent les services tiers : le jeton doit être lisible
depuis Convex, pas depuis l'admin. La piste ne résout rien.

**Un service de secrets externe** (Vault, AWS Secrets Manager). Correct, et
disproportionné : ce template se déploie sur un VPS unique avec Docker
Compose. Ajouter une brique à administrer pour trois jetons déplacerait le
problème sans le réduire.

## Ce qu'on fait : un chiffrement d'enveloppe

Une **clé maîtresse** vit dans l'environnement Convex, posée une fois :

```bash
cd packages/backend && npx convex env set SECRETS_KEY "$(openssl rand -base64 32)"
```

Les jetons saisis dans l'interface sont chiffrés avec elle (AES-GCM) et
rangés chiffrés dans une table dédiée — jamais `settings`.

**Ce que ça achète, précisément.** Une copie de la base ne suffit plus. Une
sauvegarde exportée, un accès au tableau de bord Convex, une query mal
écrite qui renverrait la ligne entière : aucun des trois ne donne le jeton.
Il faut aussi la clé maîtresse, qui vit ailleurs.

**Ce que ça n'achète pas, et il faut le dire.** Quelqu'un qui obtient les
identifiants du déploiement Convex obtient les deux moitiés. Ce dispositif
protège contre la fuite de la *base*, pas contre la compromission du
*déploiement*. Il reste donc un cran en dessous de l'environnement seul —
c'est le prix explicite de la saisie depuis l'interface.

### Les règles d'exécution, et pourquoi chacune

| Règle | Ce qu'elle empêche |
|---|---|
| Chiffrer dans une `action`, pas une mutation | Queries et mutations sont contraintes au déterminisme et leur aléa est ensemencé. AES-GCM exige un IV **unique** par chiffrement ; un IV rejoué avec la même clé casse la garantie du mode. |
| Un IV aléatoire neuf à chaque écriture | Même raison. Jamais un IV constant, jamais dérivé du nom du secret. |
| Refuser d'écrire si `SECRETS_KEY` est absente | Un repli silencieux vers le clair est pire que l'échec : personne ne s'en aperçoit. Une clé par défaut est un chiffrement décoratif. |
| Aucune query ne renvoie le chiffré ni l'IV | Ce qui remonte : « configuré », les quatre derniers caractères, la date. Rien d'autre n'a d'usage à l'écran. |
| Écriture réservée à `owner`/`admin` | Classer des leads et détenir la clé de facturation d'un fournisseur d'IA ne sont pas le même pouvoir. |
| Un seul helper pour la lecture en clair | La précédence se décide à un endroit. Recopiée dans chaque appelant, elle divergera. |
| L'environnement l'emporte sur la base | Un opérateur qui a posé une variable ne doit pas être écrasé par un formulaire. **Écrit à l'écran** : sinon quelqu'un saisit une clé et cherche pourquoi elle n'a pas d'effet. |

## Les trois endroits où vit une valeur, à ne pas confondre

C'est la confusion qui a produit le plus de pannes silencieuses de ce dépôt.

| Où | Quand c'est lu | Qui peut le voir | Exemple |
|---|---|---|---|
| `PUBLIC_*` / `VITE_*` | **au build** de l'image | tout le monde : c'est dans le source de chaque page | `PUBLIC_CONVEX_URL`, `PUBLIC_META_PIXEL_ID` |
| `process.env.X` du conteneur | au runtime du serveur | l'opérateur du VPS | `LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET` |
| environnement Convex | au runtime des fonctions | qui détient les identifiants du déploiement | `BETTER_AUTH_SECRET`, `SECRETS_KEY` |

Deux conséquences déjà payées :

- Une `PUBLIC_*` **ne peut pas** devenir un réglage en base sans changer la
  façon dont le site la lit. Un champ de formulaire qui prétendrait la
  régler ne ferait rien, en silence.
- `import.meta.env` est **inliné à la compilation**, y compris pour les clés
  sans préfixe. C'est la raison pour laquelle les secrets sont lus par
  `process.env` et jamais par `import.meta.env` : un secret lu par le second
  serait gravé dans l'artefact compilé.

## Vérifier que le dispositif est réel

Un chiffrement qu'on n'a pas éprouvé est une décoration. Ce que les tests
doivent prouver, et non affirmer :

- un aller-retour chiffrer → déchiffrer rend l'original ;
- **deux chiffrements de la même valeur donnent deux résultats différents** —
  c'est ce qui prouve que l'IV varie ;
- **un chiffré modifié d'un seul octet fait échouer le déchiffrement** —
  AES-GCM est authentifié, encore faut-il le constater ;
- l'écriture **refuse** quand `SECRETS_KEY` est absente ;
- une valeur sentinelle placée dans un secret **n'apparaît dans le JSON
  d'aucune query**.

Et, comme pour tout ce qui touche à `convex/` : un push Convex réel avant de
considérer la chose finie. `tsc` et vitest ne voient pas ce que le runtime
Convex refuse.
