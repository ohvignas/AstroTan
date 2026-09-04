import { SERP_LIEUX } from "./serpLocale"
import { classifyPageKind, KIND_INSTRUCTIONS } from "./seoGeoPageKind"
import {
  MAX_PROMPT_BODY_LENGTH,
  sourcePayload,
  type GenerationSource,
} from "./seoGeoDraft"

const CONTRACT = `Réponds UNIQUEMENT par un objet JSON (pas de markdown) avec ces clés :
- seoTitle (string, ≤ 60 caractères visibles, mot-clé près du début, marque à la fin si elle tient)
- seoDescription (string, ≤ 155 caractères, unique, bénéfice + CTA, le mot-clé une fois)
- geoSummary (string, ≤ 500 : définition citables, 1–3 phrases, entités nommées — ce qu'une IA recopie)
- geoFaq (array de { question, answer }, 3–8, factuel, réponses autonomes pour FAQPage / AI Overviews)
- geoEntities (array de strings, 3–12 : choses dont parle la page, pour lever une ambiguïté)
- geoNoai (boolean : true seulement si le contenu ne doit pas être repris — typiquement une page juridique)
- excerpt (string, ≤ 300 : UNIQUEMENT pour kind=post ; chapô factuel. Omettre ou "" pour une page)

N'invente pas d'URL canonique, d'image Open Graph, de robots, de noindex, de SIRET, de raison sociale, d'adresse légale ni de mentions. Pas de clickbait mensonger.`

const SHARED = `Tu es rédacteur SEO + GEO (citations ChatGPT, Perplexity, AI Overviews) pour un site vitrine francophone.
Objectif : n°1 Google sur le mot-clé cible s'il est fourni, et être cité par les IA.
Title 50–60 car., description 140–155, un seul focus. Français. E-E-A-T : n'invente aucun credential.
Pour kind=page tu n'as PAS le HTML — reste factuel à partir du titre, du slug et du contexte.
Les champs déjà saisis sont à améliorer, pas à ignorer s'ils sont justes.`

export function systemPrompt(source: GenerationSource): string {
  const kind = classifyPageKind(source, source.homePageSlug)
  return `${SHARED}

${KIND_INSTRUCTIONS[kind]}

${CONTRACT}`
}

function serpLabel(code?: number): string | undefined {
  if (code === undefined) return undefined
  return SERP_LIEUX.find((lieu) => lieu.locationCode === code)?.label
}

export function userPrompt(source: GenerationSource): string {
  const kind = classifyPageKind(source, source.homePageSlug)
  const lines = [
    `Type de document : ${kind} (${source.kind}).`,
    source.siteName ? `Marque / nom du site : ${source.siteName}.` : null,
    source.declaredDomain ? `Domaine déclaré : ${source.declaredDomain}.` : null,
    source.publicUrl ? `URL publique : ${source.publicUrl}.` : null,
    source.targetKeyword
      ? `Mot-clé cible (focus unique, à placer dans title + description) : ${source.targetKeyword}.`
      : "Aucun mot-clé cible saisi — déduis-en un, sans le renvoyer dans un champ à part.",
    source.defaultSeoTitle || source.defaultSeoDescription
      ? `SEO par défaut du site — title: ${source.defaultSeoTitle ?? "—"} ; description: ${source.defaultSeoDescription ?? "—"}.`
      : null,
    source.serpLocationCode !== undefined
      ? `Marché SERP : ${serpLabel(source.serpLocationCode) ?? source.serpLocationCode} (${source.serpLanguageCode ?? "fr"}).`
      : null,
    source.socials && source.socials.length > 0
      ? `Réseaux : ${source.socials.join(", ")}.`
      : null,
    source.kind === "page"
      ? "Pas de corps HTML en base (invariant AstroTan). N'invente pas le contenu de la page."
      : "Le corps de l'article est en base : appuie-toi dessus. Tronqué s'il est trop long.",
  ]
  const payload = sourcePayload({
    ...source,
    body:
      source.kind === "post"
        ? (source.body ?? "").slice(0, MAX_PROMPT_BODY_LENGTH)
        : undefined,
  })
  return `${lines.filter(Boolean).join("\n")}

Contexte JSON :
${JSON.stringify(payload)}`
}
