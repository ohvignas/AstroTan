// Quels scripts de mesure la page doit charger, et à quelles conditions.
//
// Une fonction pure plutôt qu'une suite de conditions dans le `.astro` :
// c'est ici que se décide si le site parle à un service tiers, et cette
// décision mérite d'être vérifiable sans rendre une page.

export interface AnalyticsEnv {
  PUBLIC_UMAMI_URL?: string
  PUBLIC_UMAMI_WEBSITE_ID?: string
  /**
   * L'enregistrement de session — Replays et Heatmaps d'Umami.
   *
   * Séparé, et faux par défaut, parce que ce n'est pas la même promesse que
   * le comptage : le comptage enregistre qu'une page a été vue, alors que
   * l'enregistrement rejoue ce qu'une personne a fait dessus. Le second
   * peut capter du contenu saisi, et fait sortir la mesure du régime « sans
   * cookie et sans donnée personnelle » qui permet de se passer de bandeau
   * de consentement. Ce n'est pas une case à cocher, c'est une décision.
   */
  PUBLIC_UMAMI_RECORDER?: string
}

export interface AnalyticsScript {
  src: string
  websiteId: string
}

/**
 * Les scripts à poser dans le `<head>`, dans l'ordre.
 *
 * Vide quand la mesure n'est pas configurée : l'absence de configuration est
 * l'interrupteur, de sorte qu'un adoptant qui n'en veut pas n'ait rien à
 * désactiver, et qu'aucune requête ne parte vers un tiers.
 */
export function analyticsScripts(env: AnalyticsEnv): AnalyticsScript[] {
  const base = env.PUBLIC_UMAMI_URL?.replace(/\/$/, "")
  const websiteId = env.PUBLIC_UMAMI_WEBSITE_ID
  // Les deux ou aucun : une moitié de configuration produirait une balise
  // qui échoue silencieusement, ce qui est pire que pas de balise.
  if (!base || !websiteId) return []

  const scripts: AnalyticsScript[] = [{ src: `${base}/script.js`, websiteId }]

  // `recorder.js` est bien un SECOND script, pas une option du premier —
  // constaté dans les réglages d'Umami, qui affiche les deux balises dès
  // que Replays ou Heatmaps est activé.
  //
  // Le côté Umami doit l'être aussi : sans l'interrupteur sur le site dans
  // Umami, ce script est chargé pour rien. Les deux moitiés, encore.
  if (env.PUBLIC_UMAMI_RECORDER === "true") {
    scripts.push({ src: `${base}/recorder.js`, websiteId })
  }

  return scripts
}
