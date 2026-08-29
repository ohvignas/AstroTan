// Quels scripts de mesure la page charge sans rien demander à personne.
//
// Une fonction pure plutôt qu'une suite de conditions dans le `.astro` :
// c'est ici que se décide si le site parle à un service tiers, et cette
// décision mérite d'être vérifiable sans rendre une page.
//
// La frontière avec `consent.ts` est la seule chose à retenir : ici vivent
// les balises qui ne déposent rien sur l'appareil du visiteur et
// n'identifient personne — elles n'ont pas à attendre un accord. Tout le
// reste est dans `consent.ts` et n'est posé qu'après réponse.

export interface AnalyticsEnv {
  PUBLIC_UMAMI_URL?: string
  PUBLIC_UMAMI_WEBSITE_ID?: string
}

export interface AnalyticsScript {
  src: string
  websiteId: string
}

/**
 * Les scripts à poser dans le `<head>`.
 *
 * Vide quand la mesure n'est pas configurée : l'absence de configuration est
 * l'interrupteur, de sorte qu'un adoptant qui n'en veut pas n'ait rien à
 * désactiver, et qu'aucune requête ne parte vers un tiers.
 *
 * Un seul script en sort, et c'est voulu : `script.js` d'Umami compte des
 * pages vues sans cookie, sans stockage local et sans adresse IP conservée.
 * `recorder.js` — Replays et Heatmaps — rejoue ce qu'une personne a fait sur
 * la page ; il n'est pas ici mais dans `consent.ts`, derrière le bandeau.
 */
export function analyticsScripts(
  // `Record<string, …>` et non `AnalyticsEnv` seul : `import.meta.env` est
  // typé par Astro avec ses propres clés, et TypeScript refuse un objet qui
  // n'a « aucune propriété en commun » avec un type strict. L'intersection
  // garde la vérification sur NOS clés tout en acceptant l'objet réel.
  env: AnalyticsEnv & Record<string, unknown>,
): AnalyticsScript[] {
  const base = env.PUBLIC_UMAMI_URL?.replace(/\/$/, "")
  const websiteId = env.PUBLIC_UMAMI_WEBSITE_ID
  // Les deux ou aucun : une moitié de configuration produirait une balise
  // qui échoue silencieusement, ce qui est pire que pas de balise.
  if (!base || !websiteId) return []

  return [{ src: `${base}/script.js`, websiteId }]
}
