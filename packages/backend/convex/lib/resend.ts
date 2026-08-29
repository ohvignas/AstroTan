import { Resend } from "@convex-dev/resend"
import type { ActionCtx } from "../_generated/server"
import { components } from "../_generated/api"
import { lireSecret } from "../secrets"

/**
 * Le client Resend du dépôt — un seul endroit décide de sa configuration.
 *
 * `testMode` est lu dans l'environnement (et non écrit en dur) : passer en
 * production est un changement de configuration (`RESEND_TEST_MODE=false`
 * + un domaine d'envoi vérifié), pas un changement de code. `!== "false"`
 * conserve la valeur sûre par défaut du composant (`true`) pour toute
 * autre valeur, y compris l'absence de variable.
 *
 * Une fabrique, et non une constante de module : le constructeur du client
 * fige sa configuration au moment où il est appelé (vérifié dans
 * `@convex-dev/resend`'s `client/index.ts`, `getDefaultConfig()` lu une fois
 * dans le constructeur). Construit à l'import, un module chargé avant que la
 * clé ne soit posée garderait une clé vide pour toute la durée du processus
 * — un piège dont la seule trace serait « API key is not set » sur un
 * déploiement où la clé est pourtant bien là.
 *
 * La clé passe désormais par `lireSecret`, le lecteur unique : la variable
 * d'environnement l'emporte, et à défaut on déchiffre celle qui a été saisie
 * dans l'administration. Sans ce passage, le champ de l'écran rangeait un
 * jeton que personne ne lisait — un réglage décoratif, ce qui est pire qu'un
 * réglage absent.
 *
 * `apiKey` n'est posé que s'il vaut quelque chose : passer `undefined`
 * laisse le composant retomber sur sa propre lecture de l'environnement,
 * qui est le comportement d'avant.
 */
export async function makeResend(ctx: ActionCtx): Promise<Resend> {
  const apiKey = await lireSecret(ctx, "RESEND_API_KEY")
  return new Resend(components.resend, {
    testMode: process.env.RESEND_TEST_MODE !== "false",
    ...(apiKey ? { apiKey } : {}),
  })
}
