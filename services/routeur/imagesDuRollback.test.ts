import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// La pré-vérification du rollback couvre-t-elle TOUTES les images de ce
// dépôt ?
//
// POURQUOI CES TESTS VIVENT ICI. Ils ne parlent pas du routeur, ils parlent
// du déploiement — mais c'est l'image `astrotan-routeur`, née avec ce
// paquet, que la pré-vérification a oubliée, et ce paquet est le seul du
// dépôt dont la suite porte déjà sur la forme du déploiement
// (`passe.test.ts` relit `index.ts` pour vérifier qu'il n'expose ni port ni
// socket Docker). Le défaut : `.github/workflows/rollback.yml` nommait
// `astrotan-web` et `astrotan-admin` à la main, si bien qu'un rollback vers
// un sha dont l'image du routeur avait été purgée du registre échouait à
// mi-chemin d'un `compose pull` SUR LE VPS, après avoir déjà redéployé les
// functions Convex — au lieu d'échouer avant d'avoir rien touché. Une
// procédure de secours qui échoue à moitié est pire qu'une qui refuse de
// partir (CLAUDE.md, invariant 8).
//
// Tout est en boîte noire — le script est LANCÉ, jamais importé — et
// l'ensemble attendu est recalculé ici par un motif DIFFÉRENT de celui du
// script. Deux fois la même expression régulière ne prouverait qu'elle-même.

const ROOT = fileURLToPath(new URL("../../", import.meta.url))

const compose = readFileSync(new URL("../../docker/docker-compose.yml", import.meta.url), "utf8")
const rollback = readFileSync(
  new URL("../../.github/workflows/rollback.yml", import.meta.url),
  "utf8",
)

/** Ce que le script rend, tel que le workflow le lit. */
function imagesPreVerifiees(): string[] {
  return execFileSync(process.execPath, ["scripts/rollback-images.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
}

/**
 * Les images que le compose fera tirer au VPS, recomptées autrement :
 * toute ligne `image:` qui pointe l'espace de noms GHCR de l'adoptant. Le
 * script, lui, exige en plus la substitution `${IMAGE_TAG}`. Volontairement
 * plus large : si les deux comptes divergent un jour, c'est que le script
 * est en train de rater quelque chose.
 */
function imagesDuCompose(): string[] {
  const motif = /^\s*image:\s*ghcr\.io\/\$\{GHCR_OWNER[^}]*\}\/([A-Za-z0-9_.-]+):/gm
  const noms = [...compose.matchAll(motif)].map((m) => m[1] ?? "")
  return [...new Set(noms)].sort()
}

describe("le rollback pré-vérifie toutes les images du sha visé", () => {
  test("aucune image du compose n'échappe à la pré-vérification", () => {
    expect(imagesPreVerifiees()).toEqual(imagesDuCompose())
  })

  test("le routeur en fait partie — c'est celle qui manquait", () => {
    // Nommée en clair, et pas seulement couverte par le test au-dessus :
    // c'est le défaut réellement survenu, et un test qui ne le dit pas
    // laisse la prochaine relecture le redécouvrir.
    expect(imagesPreVerifiees()).toContain("astrotan-routeur")
  })

  test("il y a bien plus d'une image, sinon les deux comptes s'accordent sur rien", () => {
    // Un motif cassé des deux côtés rendrait deux listes vides, donc
    // égales, donc vertes. Ce garde-fou est ce qui empêche le premier test
    // de passer pour une raison différente de celle qu'il annonce.
    expect(imagesPreVerifiees().length).toBeGreaterThan(1)
  })
})

describe("le workflow dérive cette liste, il ne la recopie pas", () => {
  test("rollback.yml LANCE le script", () => {
    // Les lignes de commentaire sont retirées avant de chercher : le
    // commentaire d'en-tête de l'étape cite le chemin du script, et une
    // recherche sur le fichier entier serait donc verte même si l'étape
    // avait cessé de l'appeler. C'est très exactement le genre de test qui
    // passe pour une raison différente de celle qu'il annonce.
    const commandes = rollback
      .split("\n")
      .filter((ligne) => !/^\s*#/.test(ligne))
      .join("\n")
    expect(commandes).toContain("node scripts/rollback-images.mjs")
  })

  test("rollback.yml ne nomme aucune image à la main", () => {
    // La forme exacte du défaut d'origine :
    // `docker manifest inspect "$IMG_PREFIX/astrotan-web:$INPUT_SHA"`.
    // Une liste écrite à la main est vraie le jour où on l'écrit, et
    // fausse à la prochaine image — silencieusement, jusqu'au jour où on
    // a le plus besoin d'elle.
    const enDur = [...rollback.matchAll(/manifest inspect[^\n]*?(astrotan-[a-z0-9-]+)/g)].map(
      (m) => m[1],
    )
    expect(enDur).toEqual([])
  })
})
