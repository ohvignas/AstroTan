// @ts-check
import tseslint from "typescript-eslint"

// Même configuration délibérément étroite que `packages/backend` : les deux
// règles qui attrapent un `await` manquant, et rien de plus. La raison est
// la même ici — ce service écrit un fichier que Traefik relit ; une écriture
// dont on n'attend pas la fin laisse un YAML tronqué, et Traefik ne charge
// alors AUCUNE route.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
)
