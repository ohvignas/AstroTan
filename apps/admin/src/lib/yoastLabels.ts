import type { YoastRating } from "@astrotan/backend/convex/lib/yoastFindings"

type FindingCopy = { title: string; bad: string }

const LABELS: Record<string, FindingCopy> = {
  introductionKeyword: {
    title: "Mot-clé dans l’introduction",
    bad: "Le mot-clé n’apparaît pas assez tôt dans le texte.",
  },
  keyphraseLength: {
    title: "Longueur du mot-clé",
    bad: "Le mot-clé cible est absent ou trop long.",
  },
  keywordDensity: {
    title: "Densité du mot-clé",
    bad: "Densité du mot-clé à ajuster dans le corps.",
  },
  keyphraseDensity: {
    title: "Densité du mot-clé",
    bad: "Densité du mot-clé à ajuster dans le corps.",
  },
  metaDescriptionKeyword: {
    title: "Mot-clé dans la meta description",
    bad: "Le mot-clé n’est pas dans la meta description.",
  },
  metaDescriptionLength: {
    title: "Longueur de la meta description",
    bad: "La meta description est trop courte ou trop longue.",
  },
  textCompetingLinks: {
    title: "Liens concurrents",
    bad: "Un lien sortant concurrence le mot-clé.",
  },
  internalLinks: {
    title: "Liens internes",
    bad: "Ajoutez au moins un lien interne.",
  },
  titleKeyword: {
    title: "Mot-clé dans le titre Google",
    bad: "Le mot-clé n’est pas dans le titre Google.",
  },
  keyphraseInSEOTitle: {
    title: "Mot-clé dans le titre Google",
    bad: "Le mot-clé n’est pas dans le titre Google.",
  },
  urlKeyword: {
    title: "Mot-clé dans le slug",
    bad: "Le mot-clé n’est pas dans le slug.",
  },
  slugKeyword: {
    title: "Mot-clé dans le slug",
    bad: "Le mot-clé n’est pas dans le slug.",
  },
  textLength: {
    title: "Longueur du texte",
    bad: "Le corps est trop court pour ce mot-clé.",
  },
  outboundLinks: {
    title: "Liens sortants",
    bad: "Ajoutez un lien sortant pertinent.",
  },
  externalLinks: {
    title: "Liens sortants",
    bad: "Ajoutez un lien sortant pertinent.",
  },
  functionWordsInKeyphrase: {
    title: "Mots vides dans le mot-clé",
    bad: "Le mot-clé est surtout fait de mots vides.",
  },
  singleH1: {
    title: "Titre H1",
    bad: "Un H1 dans le corps double le titre public.",
  },
  subheadingsKeyword: {
    title: "Mot-clé dans les intertitres",
    bad: "Le mot-clé n’apparaît pas dans un intertitre.",
  },
  imageKeyphrase: {
    title: "Mot-clé dans les images",
    bad: "Le mot-clé n’est pas dans le texte alternatif d’une image.",
  },
  textImages: {
    title: "Images",
    bad: "Le corps n’a pas assez d’images.",
  },
  images: {
    title: "Images",
    bad: "Le corps n’a pas assez d’images.",
  },
  textPresence: {
    title: "Présence de texte",
    bad: "Le corps est vide.",
  },
  sentenceLengthInText: {
    title: "Longueur des phrases",
    bad: "Trop de phrases longues.",
  },
  textSentenceLength: {
    title: "Longueur des phrases",
    bad: "Trop de phrases longues.",
  },
  paragraphTooLong: {
    title: "Longueur des paragraphes",
    bad: "Un paragraphe est trop long.",
  },
  textParagraphTooLong: {
    title: "Longueur des paragraphes",
    bad: "Un paragraphe est trop long.",
  },
  subheadingDistributionTooLong: {
    title: "Distribution des intertitres",
    bad: "Une section sans intertitre est trop longue.",
  },
  subheadingsTooLong: {
    title: "Distribution des intertitres",
    bad: "Une section sans intertitre est trop longue.",
  },
  transitionWords: {
    title: "Mots de transition",
    bad: "Pas assez de mots de transition.",
  },
  textTransitionWords: {
    title: "Mots de transition",
    bad: "Pas assez de mots de transition.",
  },
  passiveVoice: {
    title: "Voix passive",
    bad: "Trop de voix passive.",
  },
  sentenceBeginnings: {
    title: "Débuts de phrases",
    bad: "Trop de phrases commencent pareil.",
  },
}

export function findingCopy(
  identifier: string,
  rating: YoastRating = "bad",
): { title: string; phrase: string } {
  const row = LABELS[identifier]
  if (!row) {
    return { title: identifier, phrase: `Point à revoir (${identifier}).` }
  }
  return {
    title: row.title,
    phrase: rating === "good" ? "C’est en ordre." : row.bad,
  }
}

export function phraseFinding(identifier: string): string {
  return findingCopy(identifier).phrase
}
