-- docker/umami-purge.sql — purge de rétention Umami (13 mois, promesse de
-- /confidentialite). Exécuté par le service `umami-purge` de
-- docker-compose.yml, jamais à la main sur une base sans sauvegarde récente
-- (README §13.8).
--
-- Umami n'a AUCUNE contrainte de clé étrangère sur cette base (vérifié :
-- `information_schema.table_constraints` ET `pg_constraint` ne rendent
-- aucune ligne FOREIGN KEY) — supprimer une ligne de `website_event` ne
-- supprime pas ses lignes de `event_data`, ni une ligne de `session` ses
-- `session_data`, `session_link`, `heatmap_event`, `session_replay`,
-- `revenue` ou `session_replay_saved`. Une purge qui ne viserait que
-- `website_event` et `session` laisserait ces sept tables orphelines : la
-- promesse de /confidentialite serait tenue à moitié.
--
-- SIX des sept tables filles sont purgées sur LEUR PROPRE `created_at` :
-- une ligne d'`event_data`, `session_data`, `session_link`,
-- `heatmap_event`, `session_replay` ou `revenue` est écrite au même moment
-- que la ligne parente, donc le même seuil de 13 mois purge parent et
-- enfant ensemble sans suivre les identifiants.
--
-- DEUX exceptions, où la propre date de la ligne ment sur son âge réel :
--
-- 1. `session`. Sa `created_at` est la date de la PREMIÈRE apparition de la
--    session, pas celle de son dernier événement. Umami fait tourner le
--    sel qui dérive `session_id` selon `SALT_ROTATION` (par défaut
--    `month`, NON POSÉE dans ce dépôt) — une session peut donc continuer à
--    recevoir des `website_event` jusqu'à environ un mois après sa
--    création. La purger sur sa seule `created_at` supprimerait des
--    sessions dont des événements plus récents existent encore : les
--    ventilations par pays, navigateur, système, appareil, écran, langue
--    et ville — qui ne vivent QUE dans `session`, jamais dans
--    `website_event` — disparaîtraient en silence pour des événements pas
--    encore purgés, sur une bande glissante d'environ un mois. Si
--    `SALT_ROTATION` passe un jour à `year`, cette bande passe d'un mois à
--    un an ; la clause `NOT EXISTS` ci-dessous reste correcte dans les deux
--    cas, seule sa marge change.
--
--    `session` n'est donc purgée que si elle est A LA FOIS assez vieille
--    (`created_at`) ET privée de tout `website_event` la référençant —
--    purgé ou non. C'est une fenêtre courte (la dérive décrite ci-dessus),
--    pas un report indéfini : `website_event` lui-même est purgé sur sa
--    propre date quelques lignes plus bas, dans la même transaction, donc
--    la condition finit toujours par être vraie autour du même seuil de 13
--    mois.
--
-- 2. `session_replay_saved`. Sa `created_at` est la date à laquelle un
--    ADMINISTRATEUR A ÉPINGLÉ un replay — un geste qui peut survenir des
--    mois après l'enregistrement, pas la date de l'enregistrement
--    lui-même. La purger sur sa propre date (comme les six tables
--    « normales » ci-dessus) créerait exactement l'orphelin que ce fichier
--    existe pour éviter : un replay épinglé 2 mois après avoir été
--    enregistré, alors que l'enregistrement avait déjà 14 mois, verrait
--    ses chunks `session_replay` purgés à 13 mois — mais la ligne
--    d'épinglage, elle, ne serait purgeable que lorsque SA PROPRE date
--    atteindrait 13 mois : elle survivrait donc jusqu'à 13 mois de plus,
--    à pointer un replay qui n'existe déjà plus.
--
--    Elle n'a pas de `session_id`, seulement un `visit_id` : elle est donc
--    purgée SANS CONDITION SUR SA PROPRE DATE, dès que plus aucun chunk
--    `session_replay` ne porte ce `visit_id` — que l'épinglage ait deux
--    mois ou treize. C'est délibéré, PAS UN OUBLI DE LA DURÉE PROMISE :
--    épingler un replay est un geste de tri, pas une base légale pour
--    prolonger sa conservation au-delà de ce que /confidentialite annonce.
--    ÉPINGLER UN REPLAY NE PROLONGE DONC JAMAIS SA CONSERVATION — les
--    chunks eux-mêmes disparaissent à 13 mois, épinglés ou non, et la
--    ligne d'épinglage les suit dès le passage mensuel suivant. Un
--    administrateur qui épingle une session doit le savoir.
--
-- LIMITE CONNUE, NON VÉRIFIÉE SUR CETTE MACHINE. Les deux clauses
-- `NOT EXISTS` ci-dessous n'ont pu être exercées que sur une base d'un
-- jour, où elles ne suppriment jamais rien — comme le reste de ce fichier
-- sur cette instance. Leur EFFET réel (ne pas supprimer une session encore
-- active malgré une `created_at` ancienne ; supprimer une ligne épinglée
-- devenue orpheline malgré une `created_at` récente) demande une base
-- peuplée sur au moins 14 mois pour être observé et n'a pas pu l'être ici.
-- Seules leur SYNTAXE et leur référence aux bonnes colonnes (`session_id`,
-- `visit_id`) ont été vérifiées, par une exécution réelle du service
-- (`ON_ERROR_STOP=1`) qui n'a rencontré aucune erreur.
--
-- Tables volontairement ABSENTES de cette purge : `website`, `user`,
-- `team`, `team_user`, `app_setting`, `board`, `link`, `pixel`, `report`,
-- `segment`, `share`, `two_factor_*`, `_prisma_migrations`. Ce sont des
-- comptes, des réglages ou des définitions (tableaux de bord, segments,
-- rapports enregistrés) — pas de la donnée d'audience horodatée par
-- visite, et rien de tout cela n'est couvert par la ligne « Mesurer
-- l'audience du site » de /confidentialite.
--
-- Une seule transaction : soit tout est purgé, soit rien ne l'est. Un échec
-- à mi-chemin (verrou, contrainte future) ne doit jamais laisser une moitié
-- des tables purgée et l'autre non.
--
-- HUIT occurrences de `interval '13 months'` ci-dessous, pas neuf : chaque
-- table en porte une, SAUF `session_replay_saved` (point 2 ci-dessus, qui
-- n'en a aucune — sa purge suit celle de `session_replay`, pas une durée
-- qui lui serait propre). `apps/web/src/config/legal.test.ts` relit ce
-- fichier, vérifie que toutes ces occurrences portent le MÊME nombre, et
-- que ce nombre est celui annoncé par la ligne « Mesurer l'audience du
-- site » de /confidentialite — changer la durée ici sans changer la ligne
-- publiée, ou l'inverse, fait échouer ce test.
BEGIN;

-- Les cinq tables purgées sur leur propre date, sans condition
-- supplémentaire. Ordre sans effet aujourd'hui (aucune contrainte ne
-- bloquerait l'inverse), gardé pour rester lisible si Umami ajoute une
-- contrainte plus tard.
DELETE FROM event_data    WHERE created_at < now() - interval '13 months';
DELETE FROM heatmap_event WHERE created_at < now() - interval '13 months';
DELETE FROM revenue       WHERE created_at < now() - interval '13 months';
DELETE FROM session_data  WHERE created_at < now() - interval '13 months';
DELETE FROM session_link  WHERE created_at < now() - interval '13 months';

-- `session_replay`, sur sa propre date — DOIT s'exécuter avant
-- `session_replay_saved` ci-dessous, pour que le `NOT EXISTS` qui suit
-- voie les chunks déjà purgés dans cette même transaction.
DELETE FROM session_replay WHERE created_at < now() - interval '13 months';

-- `session_replay_saved` : voir le point 2 en tête de fichier. Aucune
-- condition sur sa propre `created_at` — seule compte l'existence d'au
-- moins un chunk `session_replay` pour le même `visit_id`.
DELETE FROM session_replay_saved s
WHERE NOT EXISTS (
  SELECT 1 FROM session_replay r WHERE r.visit_id = s.visit_id
);

-- `website_event`, sur sa propre date — DOIT s'exécuter avant `session`
-- ci-dessous, pour la même raison que `session_replay` ci-dessus.
DELETE FROM website_event WHERE created_at < now() - interval '13 months';

-- `session` : voir le point 1 en tête de fichier. Purgée seulement si elle
-- est à la fois assez vieille ET privée de tout `website_event` restant.
DELETE FROM session s
WHERE s.created_at < now() - interval '13 months'
  AND NOT EXISTS (
    SELECT 1 FROM website_event e WHERE e.session_id = s.session_id
  );

COMMIT;
