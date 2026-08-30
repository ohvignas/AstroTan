#!/usr/bin/env node
// scripts/rollback-images.mjs — les images de ce dépôt que le compose va
// tirer, une par ligne.
//
// POURQUOI CE FICHIER EXISTE
//
// `.github/workflows/rollback.yml` pré-vérifie que les images du sha visé
// existent encore dans le registre AVANT de toucher au VPS. Cette
// pré-vérification nommait les images à la main — `astrotan-web` et
// `astrotan-admin` — et elle a cessé d'être vraie le jour où
// `astrotan-routeur` est née : un rollback vers un sha dont cette image
// avait été purgée échouait alors à mi-chemin d'un `compose pull`, sur le
// VPS, après avoir déjà redéployé les functions Convex. C'est exactement
// l'inverse de ce que la pré-vérification existe pour faire — une
// procédure de secours qui échoue à moitié est pire qu'une qui refuse de
// partir (CLAUDE.md, invariant 8).
//
// La liste est donc DÉRIVÉE du compose, jamais tenue à la main : une
// quatrième image se pré-vérifiera d'elle-même, et personne n'aura à se
// souvenir de ce fichier-ci. C'est le même parti que
// `scripts/generate-served-paths.mjs`, pour la même raison — une liste
// écrite à la main diverge à la deuxième entrée, en silence.
//
// Le compose lu est celui de l'arbre courant. Dans le workflow c'est donc
// celui du SHA VISÉ, et c'est le bon : ce sont ses images à lui qui vont
// être tirées, pas celles de `main`.
//
// CE QU'IL NE FAIT PAS : les images tierces (`traefik:v3.6`,
// `postgres:17.11-alpine`, Umami…) n'en sont pas. Elles ne portent pas le
// sha du dépôt, ne sont pas construites par `deploy.yml`, et un rollback
// n'en change pas la version — les pré-vérifier ne dirait rien sur le sha
// qu'on rejoue.
//
//   node scripts/rollback-images.mjs
//
// Aucune dépendance npm et aucun parseur YAML, comme
// `scripts/check-env-wiring.mjs` : ce script doit pouvoir tourner sur un
// dépôt qui n'a pas encore installé.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = join(ROOT, "docker", "docker-compose.yml");

/**
 * Les images `ghcr.io/${GHCR_OWNER}/<nom>:${IMAGE_TAG}` du compose.
 *
 * Le motif exige les DEUX substitutions. C'est ce qui distingue une image
 * construite par ce dépôt et taguée au sha — donc pré-vérifiable — d'une
 * image tierce épinglée à une version, qu'un rollback ne bouge pas.
 */
export function imagesDuDepot(compose) {
  const motif =
    /ghcr\.io\/\$\{GHCR_OWNER[^}]*\}\/([A-Za-z0-9_.-]+):\$\{IMAGE_TAG[^}]*\}/g;
  return [...new Set([...compose.matchAll(motif)].map((m) => m[1]))].sort();
}

// Exécuté directement, pas importé par un test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const images = imagesDuDepot(readFileSync(COMPOSE, "utf8"));

  // Le garde-fou du garde-fou, comme dans `check-env-wiring.mjs` : si le
  // motif ne reconnaît plus la mise en forme du compose, ce script rendrait
  // une liste vide et la pré-vérification passerait au vert sans avoir rien
  // vérifié. Mieux vaut un échec bruyant, et au moment où on le lit.
  if (images.length === 0) {
    process.stderr.write(
      "aucune image de ce dépôt trouvée dans docker/docker-compose.yml — " +
        "la mise en forme des `image:` a changé, corriger `imagesDuDepot()` " +
        "dans scripts/rollback-images.mjs\n",
    );
    process.exit(1);
  }

  process.stdout.write(images.join("\n") + "\n");
}
