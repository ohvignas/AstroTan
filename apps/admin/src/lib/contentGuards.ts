import {
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
} from "@astrotan/backend/convex/content"

// Les refus que le serveur prononcera de toute façon, mais qu'il faut
// connaître *avant* d'envoyer.
//
// `convex/content.ts` borne chaque champ (`assertPageTextWithinLimits`) et
// `pages.update`/`posts.update` refusent un titre vide. La plupart de ces
// bornes sont déjà tenues côté saisie par un `maxLength` sur l'`<input>` —
// trois ne le sont pas, et ce sont précisément celles qu'une sauvegarde
// automatique transformerait en échec répété :
//
//   • le champ « Entités » est une seule chaîne séparée par des virgules,
//     dont le `maxLength` borne le total et non chaque entité ni leur
//     nombre ;
//   • la liste de questions/réponses peut dépasser le maximum si des lignes
//     ont été semées avant que la limite existe ;
//   • un titre vidé n'est pas une longueur, c'est `INVALID_TITLE`.
//
// La sauvegarde automatique consulte cette fonction et n'envoie rien
// lorsqu'elle rend une phrase : signaler une fois vaut mieux que réessayer
// sans fin.

export function describeContentProblem(fields: {
  title: string
  entities: string[]
  faq: { question: string; answer: string }[]
}): string | null {
  if (fields.title.trim().length === 0) {
    return "Le titre ne peut pas être vide."
  }
  if (fields.entities.length > MAX_GEO_ENTITIES) {
    return `Trop d'entités : ${fields.entities.length} pour un maximum de ${MAX_GEO_ENTITIES}.`
  }
  const tooLong = fields.entities.find(
    (entity) => entity.length > MAX_GEO_ENTITY_LENGTH
  )
  if (tooLong !== undefined) {
    return `L'entité « ${tooLong.slice(0, 30)}… » dépasse ${MAX_GEO_ENTITY_LENGTH} caractères.`
  }
  if (fields.faq.length > MAX_GEO_FAQ_ITEMS) {
    return `Trop de questions : ${fields.faq.length} pour un maximum de ${MAX_GEO_FAQ_ITEMS}.`
  }
  return null
}

/**
 * Les entités telles qu'elles partent au serveur, depuis la chaîne saisie.
 *
 * Partagée entre l'écran des pages et celui des articles parce que
 * `describeContentProblem` doit voir exactement la liste qui sera envoyée,
 * et non une seconde découpe écrite à côté qui divergerait.
 */
export function splitEntities(value: string): string[] {
  return value
    .split(",")
    .map((entity) => entity.trim())
    .filter((entity) => entity !== "")
}
