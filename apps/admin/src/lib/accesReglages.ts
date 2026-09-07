/**
 * Qui peut écrire les réglages du site.
 *
 * L'UI masque, elle ne décide pas : `settings.update`, `secrets.set` et
 * `dataforseo.enregistrer` revérifient le rôle (et `exigerPasDemo`) côté
 * serveur. Cette fonction ne sert qu'à ne pas montrer un formulaire dont
 * chaque clic reviendrait refusé.
 *
 * Le compte démo est un editor, mais on le nomme ici quand même : si le
 * rôle changeait un jour, le bac à sable resterait en lecture seule.
 */
export function canWriteSettings(input: {
  role: string | undefined
  isDemo: boolean
}): boolean {
  if (input.isDemo) return false
  return input.role === "owner" || input.role === "admin"
}
