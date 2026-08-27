import type { Role } from "./validators"

export type RegistryEntry = {
  name: string
  allowedRoles: Role[]
  invoke: (t: any) => Promise<unknown>
}

// Vide à la création. Chaque tâche qui ajoute une mutation ajoute son entrée
// ici, sans quoi le test d'exhaustivité (authz.test.ts) échoue.
export const MUTATION_REGISTRY: RegistryEntry[] = []
