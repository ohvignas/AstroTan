-- docker/umami-purge.sql — purge de rétention Umami (13 mois, promesse de
-- /confidentialite). Exécuté par le service `umami-purge` de
-- docker-compose.yml, jamais à la main sur une base sans sauvegarde récente
-- (README §13.8).
--
-- Umami n'a AUCUNE contrainte de clé étrangère sur cette base (vérifié :
-- `information_schema.table_constraints` ne rend aucune ligne de type
-- FOREIGN KEY) — supprimer une ligne de `website_event` ne supprime pas ses
-- lignes de `event_data`, ni une ligne de `session` ses `session_data`,
-- `session_link`, `heatmap_event`, `session_replay`, `revenue` ou
-- `session_replay_saved`. Une purge qui ne viserait que `website_event` et
-- `session` laisserait ces six tables orphelines : la promesse de
-- /confidentialite serait tenue à moitié.
--
-- Chaque table est donc purgée sur SA PROPRE `created_at`, pas en cascade
-- depuis `website_event`/`session` par identifiant : une ligne d'une table
-- qui pend est écrite au même moment que la ligne parente (ou, pour
-- `session_replay_saved`, au moment où un administrateur choisit de la
-- conserver), donc le même seuil purge parent et enfants ensemble sans
-- avoir à suivre les identifiants.
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
BEGIN;

-- Les tables qui pendent de `website_event` ou `session`, d'abord — sans
-- effet aujourd'hui puisqu'aucune contrainte ne bloquerait l'ordre inverse,
-- et gardé pour rester correct si Umami en ajoute une plus tard.
DELETE FROM event_data           WHERE created_at < now() - interval '13 months';
DELETE FROM session_data         WHERE created_at < now() - interval '13 months';
DELETE FROM session_link         WHERE created_at < now() - interval '13 months';
DELETE FROM heatmap_event        WHERE created_at < now() - interval '13 months';
DELETE FROM session_replay       WHERE created_at < now() - interval '13 months';
DELETE FROM session_replay_saved WHERE created_at < now() - interval '13 months';
DELETE FROM revenue              WHERE created_at < now() - interval '13 months';

-- Puis les deux tables racines.
DELETE FROM website_event WHERE created_at < now() - interval '13 months';
DELETE FROM session       WHERE created_at < now() - interval '13 months';

COMMIT;
