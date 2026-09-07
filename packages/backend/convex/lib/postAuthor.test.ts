import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "postAuthor.ts"),
  "utf8",
)

describe("resolvePostAuthors", () => {
  test("les lookups Better Auth partent en parallèle, pas un par un", () => {
    // Un `await` dans la boucle des auteurs empilait N allers-retours
    // composant — mesuré live : /posts restait sur « Chargement… » ~1 s
    // alors que /pages (sans ces lookups) revenait en ~480 ms.
    expect(source).toMatch(/Promise\.all/)
    expect(source).not.toMatch(
      /for \(const id of unique\)[\s\S]*await ctx\.runQuery/,
    )
  })
})
