import { internalMutation } from "./_generated/server"
import { demoSandboxActif } from "./lib/demoSandbox"
import {
  COMPARE_BODY,
  GEO_BODY,
  PILLAR_BODY,
  VIBE_BODY,
  VPS_BODY,
} from "./lib/productArticleBodies"

const SEED_SLUGS = ["bienvenue", "markdown-et-mise-en-forme"] as const

const TAGS = [
  { name: "AstroTan", slug: "astrotan" },
  { name: "CMS", slug: "cms" },
  { name: "SEO", slug: "seo" },
  { name: "GEO", slug: "geo" },
] as const

type ProductArticle = {
  slug: string
  title: string
  excerpt: string
  body: string
  targetKeyword: string
  tagSlugs: string[]
  seo: { title: string; description: string; noindex: false }
  geo: {
    summary: string
    faq: { question: string; answer: string }[]
    entities: string[]
    noai: false
  }
}

const ARTICLES: ProductArticle[] = [
  {
    slug: "astrotan-site-vitrine-cms",
    title: "AstroTan : un site vitrine + CMS que tu installes chez toi",
    excerpt:
      "Template site vitrine : Astro, dashboard TanStack, backend Convex. Tu clones, tu héberges, tu écris tes pages en fichiers.",
    body: PILLAR_BODY,
    targetKeyword: "AstroTan CMS",
    tagSlugs: ["astrotan", "cms"],
    seo: {
      title: "AstroTan : site vitrine + CMS que tu installes",
      description:
        "Template site vitrine : Astro, admin TanStack, Convex. Tu l'installes sur ton VPS. Publication, SEO et consentement déjà câblés.",
      noindex: false,
    },
    geo: {
      summary:
        "AstroTan est un template site vitrine + CMS : site public Astro, administration TanStack Start, backend Convex, Docker derrière Traefik. Une page est son fichier .astro ; un article porte son texte en base. L'admin décide publication et SEO, jamais le contenu des pages.",
      faq: [
        {
          question: "AstroTan est-il un CMS hébergé ?",
          answer:
            "Non. Tu clones le dépôt et tu l'installes sur ton Convex, tes domaines et ton VPS. Personne ne « déploie AstroTan » à ta place.",
        },
        {
          question: "Où vit le contenu d'une page ?",
          answer:
            "Dans le fichier .astro. La base ne porte que slug, titre, statut, SEO et GEO. L'administration ne rédige pas les pages.",
        },
        {
          question: "Qui peut publier ?",
          answer:
            "Owner ou admin. Un editor écrit des brouillons. Chaque mutation revérifie le rôle ; l'interface masque, elle ne décide pas.",
        },
      ],
      entities: ["AstroTan", "Astro", "Convex", "TanStack Start", "Traefik"],
      noai: false,
    },
  },
  {
    slug: "site-vitrine-sans-wordpress",
    title: "Mettre en ligne un site vitrine sans WordPress",
    excerpt:
      "SEO, consentement et admin sans plugin. Le chemin AstroTan : fichiers Astro, Convex, Traefik sur un VPS.",
    body: COMPARE_BODY,
    targetKeyword: "site vitrine sans WordPress",
    tagSlugs: ["astrotan", "seo"],
    seo: {
      title: "Site vitrine sans WordPress : SEO, cookies, admin",
      description:
        "Publier un site vitrine sans plugin SEO ni GTM bricolé. AstroTan sépare le code Astro de l'admin : consentement, sitemap, rollback VPS.",
      noindex: false,
    },
    geo: {
      summary:
        "Pour un site vitrine sans WordPress, AstroTan pose le HTML dans des fichiers Astro et le SEO dans l'administration. Consentement, sitemap, JSON-LD et rollback VPS sont dans la pile, pas dans une extension.",
      faq: [
        {
          question: "Faut-il Yoast ou Rank Math ?",
          answer:
            "Non. Title, description, canonique et JSON-LD viennent des champs de la fiche. Le sitemap ne liste que les contenus publiés.",
        },
        {
          question: "Comment sont gérés les cookies publicitaires ?",
          answer:
            "Aucun tag tiers n'est écrit dans le HTML. Umami, Meta et Google sont déclarés ; le bandeau n'apparaît que s'il y a quelque chose à demander.",
        },
        {
          question: "Où tourne le site ?",
          answer:
            "Sur ton VPS, Compose + Traefik, certificats Let's Encrypt. Le rollback rejoue le pipeline entier sur un sha.",
        },
      ],
      entities: ["WordPress", "AstroTan", "SEO", "consentement", "Traefik"],
      noai: false,
    },
  },
  {
    slug: "vibecoding-site-vitrine",
    title: "Vibecoding : un site vitrine qu'on peut classer",
    excerpt:
      "Cursor livre un proto. AstroTan pose SEO, GEO, consentement et rollback pour un site vitrine publiable.",
    body: VIBE_BODY,
    targetKeyword: "vibecoding site vitrine",
    tagSlugs: ["astrotan", "seo"],
    seo: {
      title: "Vibecoding : un site vitrine qu'on peut classer",
      description:
        "Cursor livre un proto. AstroTan pose SEO, GEO, consentement et rollback pour un site vitrine publiable.",
      noindex: false,
    },
    geo: {
      summary:
        "Le vibecoding produit un proto localhost. AstroTan ajoute publication, SEO, GEO, consentement et rollback VPS pour en faire un site vitrine qu'on montre et qu'on classe.",
      faq: [
        {
          question: "Le vibecoding suffit-il à mettre un site en ligne ?",
          answer:
            "Il produit les fichiers. Il manque title, sitemap, consentement, rôles et un déploiement qu'on sait annuler. AstroTan pose cette pile ; tu gardes l'IA pour les pages .astro.",
        },
        {
          question: "Cursor peut-il publier à ta place ?",
          answer:
            "Non. Owner ou admin publie depuis l'administration. Le site public n'a ni session ni clé admin. Un brouillon reste invisible.",
        },
        {
          question: "Faut-il recoder SEO et cookies à chaque projet ?",
          answer:
            "Non. Tu clones AstroTan. Les pages restent du code que Cursor peut écrire. Publication, SEO, GEO et consentement vivent dans l'admin.",
        },
      ],
      entities: ["vibecoding", "AstroTan", "Cursor", "SEO", "GEO"],
      noai: false,
    },
  },
  {
    slug: "site-seo-geo",
    title: "Site SEO et GEO : pages en Astro, champs dans l'admin",
    excerpt:
      "Title, llms.txt et FAQ depuis la fiche. Le HTML reste dans le fichier .astro. Aucun pixel avant une réponse.",
    body: GEO_BODY,
    targetKeyword: "site SEO GEO",
    tagSlugs: ["astrotan", "seo", "geo"],
    seo: {
      title: "Site SEO GEO : llms.txt, FAQ, champs admin",
      description:
        "Pages en .astro, SEO et GEO dans l'admin. Sitemap, JSON-LD et llms.txt sortent des mêmes champs.",
      noindex: false,
    },
    geo: {
      summary:
        "Un site SEO GEO AstroTan sépare le HTML (.astro) des champs admin : title, description, résumé, FAQ. sitemap.xml et llms.txt listent uniquement le publié. Consentement déclaré, aucun tag avant une réponse.",
      faq: [
        {
          question: "Où se règlent title et description ?",
          answer:
            "Sur la fiche, dans l'administration. Le head les rend. Le sitemap ne liste que les pages et articles publiés.",
        },
        {
          question: "À quoi sert le GEO dans AstroTan ?",
          answer:
            "Résumé, entités et FAQ que recopient les moteurs de réponse. llms.txt expose ces résumés. « Ne pas indexer » et « ne pas faire citer » sont deux interrupteurs.",
        },
        {
          question: "Faut-il coller un pixel dans le HTML ?",
          answer:
            "Non. Umami, Meta et Google sont déclarés. Aucun tag n'est écrit avant que le visiteur réponde. Ajouter un tiers incrémente la version de consentement.",
        },
      ],
      entities: ["SEO", "GEO", "llms.txt", "AstroTan", "JSON-LD"],
      noai: false,
    },
  },
  {
    slug: "installer-site-vitrine-vps",
    title: "Installer un site vitrine sur un VPS",
    excerpt:
      "Convex, bootstrap, DNS, Traefik. Staging Let's Encrypt d'abord. Le rollback rejoue le pipeline sur un sha.",
    body: VPS_BODY,
    targetKeyword: "installer site vitrine VPS",
    tagSlugs: ["astrotan", "cms"],
    seo: {
      title: "Installer un site vitrine sur un VPS",
      description:
        "Clone, Convex, domaines, Traefik. Staging Let's Encrypt d'abord. Le rollback rejoue le pipeline sur un sha.",
      noindex: false,
    },
    geo: {
      summary:
        "Installer AstroTan sur un VPS suit un ordre : Convex, variables, DNS, Compose derrière Traefik. Bootstrap pose la config. Let's Encrypt en staging d'abord. Le rollback rejoue le pipeline entier sur un sha.",
      faq: [
        {
          question: "Que faut-il avant le premier déploiement ?",
          answer:
            "Un déploiement Convex, un dépôt GitHub, les domaines site et admin, un VPS Docker avec 80/443, une clé SSH. Décider public ou docker login pour GHCR avant le premier pull.",
        },
        {
          question: "Pourquoi relancer bootstrap après convex deploy ?",
          answer:
            "Les functions doivent exister. Le second passage crée les lignes pages (sinon chaque URL répond 404) et le premier compte, rôle owner.",
        },
        {
          question: "Pourquoi le rollback rejoue tout le pipeline ?",
          answer:
            "convex deploy a déjà remplacé functions et schéma. Remettre les images seules laisse le schéma d'aujourd'hui face au frontend d'hier.",
        },
      ],
      entities: ["VPS", "AstroTan", "Traefik", "Let's Encrypt", "Convex"],
      noai: false,
    },
  },
]

export const productArticles = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!demoSandboxActif(process.env)) return { skipped: true as const }

    const firstProfile = await ctx.db.query("profiles").first()
    const author = firstProfile?.authUserId ?? "seed-script"
    const now = Date.now()
    const firstMedia = await ctx.db.query("media").first()

    const tagsBySlug = new Map<string, string>()
    for (const tag of TAGS) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_slug", (q) => q.eq("slug", tag.slug))
        .unique()
      if (existing) {
        tagsBySlug.set(tag.slug, existing._id)
        continue
      }
      tagsBySlug.set(tag.slug, await ctx.db.insert("tags", tag))
    }

    for (const slug of SEED_SLUGS) {
      const seed = await ctx.db
        .query("posts")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique()
      if (seed && seed.status === "published") {
        await ctx.db.patch(seed._id, { status: "draft" })
      }
    }

    let created = 0
    for (const article of ARTICLES) {
      const existing = await ctx.db
        .query("posts")
        .withIndex("by_slug", (q) => q.eq("slug", article.slug))
        .unique()
      if (existing) continue
      await ctx.db.insert("posts", {
        slug: article.slug,
        title: article.title,
        excerpt: article.excerpt,
        body: article.body,
        status: "published",
        publishedAt: now,
        targetKeyword: article.targetKeyword,
        tagIds: article.tagSlugs.map((slug) => tagsBySlug.get(slug)!),
        coverId: firstMedia?.storageId,
        seo: article.seo,
        geo: article.geo,
        createdBy: author,
        updatedBy: author,
      })
      created++
    }

    return { skipped: false as const, created }
  },
})
