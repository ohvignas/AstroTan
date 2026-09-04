export type GeoCheckStatus = "missing" | "ok" | "warn" | "blocked" | "pending"

export type GeoCheckItem = {
  id: "summary" | "entities" | "faq" | "noai" | "schemaFaq" | "schemaArticle"
  status: GeoCheckStatus
  title: string
  label: string
}

export function geoChecklist(input: {
  summary: string
  entities: string[]
  faq: { question: string; answer: string }[]
  noai: boolean
  publishedAt?: number
}): GeoCheckItem[] {
  const summary = input.summary.trim().length > 0
  const entities = input.entities.some((e) => e.trim().length > 0)
  const faq = input.faq.some(
    (row) => row.question.trim().length > 0 && row.answer.trim().length > 0,
  )
  const noai = input.noai
  return [
    {
      id: "summary",
      title: "Résumé extractible",
      status: summary ? "ok" : "missing",
      label: summary
        ? "Résumé extractible renseigné."
        : "Ajoutez un résumé que les moteurs de réponse pourront citer.",
    },
    {
      id: "entities",
      title: "Entités",
      status: entities ? "ok" : "missing",
      label: entities
        ? "Des entités sont posées."
        : "Indiquez au moins une entité (désambiguïsation).",
    },
    {
      id: "faq",
      title: "FAQ",
      status: faq ? "ok" : "missing",
      label: faq
        ? "Une FAQ complète est prête."
        : "Ajoutez au moins une question / réponse (FAQPage).",
    },
    {
      id: "noai",
      title: "Reprise IA",
      status: noai ? "warn" : "ok",
      label: noai
        ? "noai : résumé, mots-clés et JSON-LD publics sont coupés."
        : "Reprise par les IA génératives autorisée.",
    },
    {
      id: "schemaFaq",
      title: "FAQPage",
      status: noai ? "blocked" : faq ? "ok" : "missing",
      label: noai
        ? "FAQPage ne sera pas émis (noai)."
        : faq
          ? "FAQPage sera émis."
          : "FAQPage exige une paire question / réponse.",
    },
    {
      id: "schemaArticle",
      title: "Article JSON-LD",
      status: noai
        ? "blocked"
        : input.publishedAt === undefined
          ? "pending"
          : "ok",
      label: noai
        ? "Article JSON-LD ne sera pas émis (noai)."
        : input.publishedAt === undefined
          ? "Article JSON-LD partira à la publication."
          : "Article JSON-LD est émis sur le site public.",
    },
  ]
}
