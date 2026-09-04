/** Ports documentés de `pnpm dev` / `docker-compose.local.yml`. */
export const WEB_LOCAL = "localhost:4321"
export const ADMIN_LOCAL = "localhost:3001"

/**
 * Cet écran tourne-t-il sur la machine de l'opérateur, pas sur le VPS ?
 *
 * `import.meta.env.DEV` couvre `pnpm dev`. Le hostname couvre un build
 * servi en local. Ni l'un ni l'autre ne lit le DNS public : c'est ce
 * hostname-ci, celui du navigateur.
 */
export function estEnvironnementLocal(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === "undefined") return false
  const hote = window.location.hostname
  return hote === "localhost" || hote === "127.0.0.1"
}

export function valeurLocalePour(cle: string): string {
  return cle === "admin" ? ADMIN_LOCAL : WEB_LOCAL
}

/**
 * Ce que le champ Domaine affiche au montage.
 *
 * Le domaine déclaré s'il existe. Sinon l'hôte de `webUrl` — celui que
 * bootstrap a déjà posé, et dont les A existent souvent déjà. Localhost
 * n'est pas un domaine à déclarer : le champ reste vide en `pnpm dev`.
 */
export function domaineInitial(
  declared: string | null | undefined,
  webUrl: string | null | undefined,
): string {
  const declare = declared?.trim() ?? ""
  if (declare) return declare
  if (!webUrl) return ""
  try {
    const hote = new URL(webUrl).hostname
    if (hote === "localhost" || hote === "127.0.0.1") return ""
    return hote
  } catch {
    return ""
  }
}
