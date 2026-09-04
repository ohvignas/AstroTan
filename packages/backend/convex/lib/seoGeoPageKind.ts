export type SeoPageKind =
  | "home"
  | "contact"
  | "legal"
  | "service"
  | "blog_index"
  | "article"
  | "generic"

const HOME = /^(accueil|home|index)$/i
const CONTACT = /^(contact|nous-contacter|nouscontacter)$/i
const LEGAL =
  /^(mentions-legales|mentions|confidentialite|cookies|cgv|cgu|privacy|legal)$/i
const SERVICE =
  /^(fonctionnalites|tarifs|services|pricing|offre|prestations|features)$/i
const BLOG = /^(blog|articles|journal)$/i

export function classifyPageKind(
  source: { kind: "page" | "post"; slug: string; title: string },
  homePageSlug?: string,
): SeoPageKind {
  if (source.kind === "post") return "article"
  const slug = source.slug.trim()
  if (homePageSlug && slug === homePageSlug) return "home"
  if (HOME.test(slug)) return "home"
  if (CONTACT.test(slug) || /contact/i.test(source.title)) return "contact"
  if (LEGAL.test(slug) || /mention|confidential|cookie|cgv|cgu/i.test(source.title)) {
    return "legal"
  }
  if (SERVICE.test(slug) || /tarif|service|offre|prestation/i.test(source.title)) {
    return "service"
  }
  if (BLOG.test(slug)) return "blog_index"
  return "generic"
}

/** Consignes spécifiques — n°1 Google + citation par les IA. */
export const KIND_INSTRUCTIONS: Record<SeoPageKind, string> = {
  home:
    "Page d'accueil : promesse du site en une phrase, pour qui, où. Titre = marque + bénéfice. " +
    "GEO : définition citables de l'activité (sujet + lieu + offre), 3–5 FAQ d'intention commerciale.",
  contact:
    "Page contact : comment joindre, délai de réponse, zone desservie. Pas de SIRET inventé. " +
    "Titre utile (« Contact + marque + ville »). FAQ : horaires, délai, quoi préparer.",
  legal:
    "Page réglementaire : décrire le rôle de la page (mentions, cookies, confidentialité). " +
    "INTERDIT d'inventer raison sociale, SIRET, TVA, adresse, hébergeur. " +
    "Si ces faits ne sont pas dans le contexte, rester générique. noai=true si le fond est juridique.",
  service:
    "Page offre / tarifs / fonctionnalités : un bénéfice clair, un mot-clé, un CTA. " +
    "GEO : ce que c'est, pour qui, ce que ça change — phrases extractibles, sans superlatif vide.",
  blog_index:
    "Index du blog : promettre le type de contenus, pas un article. Titre de rubrique + marque. " +
    "GEO : de quoi parle le journal, à qui il s'adresse.",
  article:
    "Article : t'appuyer UNIQUEMENT sur titre, extrait et corps fournis. " +
    "Chapô (excerpt) ≤ 300 car. : une phrase factuelle, pas de teaser vide. " +
    "GEO : définition courte du sujet, entités nommées, FAQ qui reprennent le corps.",
  generic:
    "Page vitrine : intention du slug + titre. Reste factuel — tu n'as pas le HTML. " +
    "Une requête cible, un bénéfice, des entités pour lever l'ambiguïté.",
}
