"use node"

import { asCtor } from "./yoastCtor"
import type { YoastEngine } from "./yoastRun"

function takeInterpreters(mod: unknown): YoastEngine["interpreters"] | undefined {
  if (mod === null || typeof mod !== "object") return undefined
  const direct = (mod as { interpreters?: YoastEngine["interpreters"] }).interpreters
  if (typeof direct?.scoreToRating === "function") return direct
  const nested = (mod as { default?: { interpreters?: YoastEngine["interpreters"] } })
    .default?.interpreters
  return typeof nested?.scoreToRating === "function" ? nested : undefined
}

/**
 * Import à chaîne littérale : le bundler Convex inclut yoastseo dans
 * l'isolat Node. `createRequire` + `externalPackages` ne marche que sur
 * Convex Cloud — le self-host n'installe pas le package dans le tmp de
 * l'action (« Cannot find module 'yoastseo' »).
 */
export async function loadYoastEngine(): Promise<YoastEngine> {
  const yoastMod: unknown = await import("yoastseo")
  const frMod: unknown = await import(
    "yoastseo/build/languageProcessing/languages/fr/Researcher.js"
  )
  const yoast =
    yoastMod !== null && typeof yoastMod === "object" && "default" in yoastMod
      ? (yoastMod as { default: unknown }).default
      : yoastMod
  const interpreters = takeInterpreters(yoast) ?? takeInterpreters(yoastMod)
  if (interpreters === undefined) {
    throw new TypeError("yoastseo interpreters.scoreToRating missing")
  }
  const named = yoast as { Paper?: unknown; SeoAssessor?: unknown; ContentAssessor?: unknown }
  return {
    Paper: asCtor(named.Paper),
    SeoAssessor: asCtor(named.SeoAssessor),
    ContentAssessor: asCtor(named.ContentAssessor),
    interpreters,
    FrenchResearcher: asCtor(
      frMod !== null && typeof frMod === "object" && "default" in frMod
        ? (frMod as { default: unknown }).default
        : frMod,
    ),
  }
}
