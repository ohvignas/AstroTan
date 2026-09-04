import { marked } from "marked"
import { internalMutation } from "./_generated/server"
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  hasAuthoredAgentInstructions,
} from "./lib/defaultAgentInstructions"
import { hotePublicDepuisEnv } from "./lib/hoteNu"

// Demo content for a fresh install.
//
// The two long bodies are authored as Markdown here because it is far more
// readable in source than the HTML they become — but `posts.body` holds
// HTML, so they are converted once on the way in. What the dashboard's
// editor writes back is HTML directly; this is only a convenience for
// writing the fixture.
//
// Run by an operator, never by a client:
//
//     npx convex run seed:demoContent
//
// A template that clones into an empty database shows an empty dashboard
// and an empty blog, and there is no way to tell "it works, there is
// nothing yet" from "it is broken". This fills in enough to see every
// moving part: a published page, a published article with real Markdown,
// a draft to prove drafts stay invisible, and tags on both.
//
// Idempotent by slug: running it twice changes nothing, so it is safe to
// re-run after a schema change or on a database that is already half
// populated. Everything it writes is meant to be deleted from the
// dashboard once the real content exists.
//
// It writes through `ctx.db` directly rather than through the public
// mutations, on purpose: those require a session, and an operator running a
// CLI command has none. The trade-off is that it bypasses the role checks —
// acceptable for a command that already needs deploy-key access, and the
// reason it is an `internalMutation` and not a `mutation`.

// Le champ `geo.faq` est émis en JSON-LD `FAQPage` — le format que les
// moteurs de réponse citent le plus fidèlement.
const DEMO_FAQ = {
  summary:
    "AstroTan sépare ce que dit un site de ce à quoi il ressemble : le texte et les réglages vivent dans l'administration, le design dans le code.",
  faq: [
    {
      question: "Faut-il savoir coder pour modifier le contenu ?",
      answer:
        "Non. Le texte des articles, les réglages SEO et le nom du site se modifient depuis l'administration. Seul le design se touche dans le code.",
    },
    {
      question: "Où vivent les pages ?",
      answer:
        "Chaque page est un fichier .astro dans le code du site. L'administration décide de son adresse, de sa publication et de son référencement.",
    },
  ],
  entities: ["AstroTan", "Astro", "Convex"],
  noai: false,
}

const DEMO_TAGS = [
  { name: "Astro", slug: "astro" },
  { name: "Convex", slug: "convex" },
]

const DEMO_PAGES = [
  { slug: "accueil", title: "Accueil", publish: true },
  { slug: "contact", title: "Contact", publish: true },
  // Une page est un couple : le fichier `.astro` ET sa ligne. Ces trois-là
  // ont leur fichier depuis le portage du template ; sans leur ligne, elles
  // répondent 404 — ce qui est l'invariant, pas une panne.
  { slug: "fonctionnalites", title: "Fonctionnalités", publish: true },
  { slug: "tarifs", title: "Tarifs", publish: true },
  // Les pages réglementaires. Publiées comme les autres : une page légale
  // en brouillon est un lien mort dans le pied de page de tout le site, et
  // c'est exactement le genre de manque qu'on ne remarque jamais soi-même.
  { slug: "mentions-legales", title: "Mentions légales", publish: true },
  { slug: "confidentialite", title: "Politique de confidentialité", publish: true },
  { slug: "cookies", title: "Politique de cookies", publish: true },
]

const FIRST_POST_BODY_MD = `Ce site tourne sur AstroTan. Cet article est du contenu
de démonstration : supprimez-le depuis l'administration quand vous n'en aurez
plus besoin.

## Ce qui vient de la base, et ce qui vient du code

Une **page** est son fichier \`.astro\`. Son balisage, sa mise en page et ses
mots s'écrivent en code ; l'administration ne décide que de son slug, de sa
publication et de ses champs SEO et GEO.

Un **article**, lui, porte son texte en base — parce qu'un billet *est* du
contenu, et que personne ne demandera à un agent d'écrire chaque article.

## Ce que vous pouvez essayer tout de suite

1. Modifiez le titre de cet article dans l'administration, enregistrez,
   rechargez cette page.
2. Dépubliez-le : cette URL répondra 404 en quelques secondes.
3. Republiez-le, puis utilisez le bouton *Prévisualiser* sur un brouillon —
   l'aperçu s'ouvre sur l'URL réelle de l'article, pas sur une route à part.

> Le corps d'un article est du Markdown, stocké tel quel et assaini *après*
> rendu. Une balise \`<script>\` écrite ici n'atteindra jamais un visiteur.
`

const SECOND_POST_BODY_MD = `Un second article, pour que la liste du blog ait de
quoi montrer un ordre : les articles sortent du plus récent au plus ancien.

## Listes et images

Une liste :

- un point
- un autre
- un dernier

Et du \`code en ligne\`, plus un bloc :

\`\`\`ts
const { post } = await loadPost(Astro, slug)
\`\`\`
`

export const demoContent = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Attributed to the first profile there is — on a fresh install, the
    // owner. Falls back to a marker string rather than failing: seeding a
    // database with no accounts yet is a legitimate order of operations.
    const firstProfile = await ctx.db.query("profiles").first()
    const author = firstProfile?.authUserId ?? "seed-script"
    const now = Date.now()

    const created = { tags: 0, pages: 0, posts: 0 }

    const tagIds = []
    for (const tag of DEMO_TAGS) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_slug", (q) => q.eq("slug", tag.slug))
        .unique()
      if (existing) {
        tagIds.push(existing._id)
        continue
      }
      tagIds.push(await ctx.db.insert("tags", tag))
      created.tags++
    }

    for (const page of DEMO_PAGES) {
      const existing = await ctx.db
        .query("pages")
        .withIndex("by_slug", (q) => q.eq("slug", page.slug))
        .unique()
      if (existing) continue
      await ctx.db.insert("pages", {
        slug: page.slug,
        title: page.title,
        status: page.publish ? "published" : "draft",
        publishedAt: page.publish ? now : undefined,
        seo: {
          description:
            "Page de démonstration livrée avec AstroTan — à remplacer par la vôtre.",
          noindex: false,
        },
        createdBy: author,
        updatedBy: author,
      })
      created.pages++
    }

    const posts = [
      {
        slug: "bienvenue",
        title: "Bienvenue sur AstroTan",
        excerpt:
          "Ce que l'administration décide, ce que le code décide, et comment les deux se rejoignent.",
        body: marked.parse(FIRST_POST_BODY_MD, { async: false }),
        status: "published" as const,
        // Espacés d'une heure pour que l'ordre de la liste soit visible
        // plutôt que dépendant d'un tri à la milliseconde près.
        publishedAt: now,
        tagIds,
      },
      {
        slug: "markdown-et-mise-en-forme",
        title: "Markdown et mise en forme",
        excerpt: "Listes, code, citations : ce que le rendu accepte.",
        body: marked.parse(SECOND_POST_BODY_MD, { async: false }),
        status: "published" as const,
        publishedAt: now - 3_600_000,
        tagIds: tagIds.slice(0, 1),
      },
      {
        slug: "brouillon-de-demonstration",
        title: "Un brouillon, invisible depuis le site",
        excerpt: "Il n'apparaît ni sur /blog, ni à son URL — c'est l'invariant.",
        body: "<p>Cet article est un brouillon. Il n'est visible qu'ici, ou par un lien de prévisualisation.</p>",
        status: "draft" as const,
        publishedAt: undefined,
        tagIds: [],
      },
    ]

    // Une couverture, si la médiathèque contient déjà quelque chose : ça
    // rend visible le chemin d'optimisation d'image distante, qui reste
    // sinon du code que rien n'exerce.
    const firstMedia = await ctx.db.query("media").first()

    for (const post of posts) {
      const existing = await ctx.db
        .query("posts")
        .withIndex("by_slug", (q) => q.eq("slug", post.slug))
        .unique()
      if (existing) {
        // Rattrape la couverture d'un article de démonstration créé avant
        // qu'il y ait des médias. Volontairement le seul champ rattrapé :
        // tout le reste a pu être édité depuis, et le seed n'a pas à
        // écraser le travail de quelqu'un.
        if (!existing.coverId && firstMedia && existing.status === "published") {
          await ctx.db.patch(existing._id, { coverId: firstMedia.storageId })
        }
        // Une FAQ de démonstration sur le premier article : c'est ce qui
        // rend visible le JSON-LD `FAQPage`, sans quoi ce champ n'a aucun
        // lecteur et personne ne sait qu'il existe.
        if (!existing.geo?.faq && post.slug === "bienvenue") {
          await ctx.db.patch(existing._id, { geo: DEMO_FAQ })
        }
        continue
      }
      await ctx.db.insert("posts", {
        ...post,
        coverId: post.status === "published" ? firstMedia?.storageId : undefined,
        seo: { noindex: false },
        createdBy: author,
        updatedBy: author,
      })
      created.posts++
    }

    // Le site a un nom et une page d'accueil, sinon `/` répond 404 sur une
    // installation neuve et rien n'indique que c'est un réglage manquant
    // plutôt qu'une panne.
    //
    // `declaredDomain` aussi, quand l'environnement le connaît déjà :
    // bootstrap a posé `WEB_DOMAIN`, les A existent, et l'écran Domaine
    // lisait une ligne vide. On ne remplace jamais un domaine saisi.
    const hoteEnv = hotePublicDepuisEnv(process.env)
    const settings = await ctx.db.query("settings").first()
    if (settings === null) {
      await ctx.db.insert("settings", {
        siteName: "AstroTan",
        homePageSlug: "accueil",
        agentInstructions: DEFAULT_AGENT_INSTRUCTIONS,
        ...(hoteEnv ? { declaredDomain: hoteEnv } : {}),
      })
    } else {
      const patch: {
        homePageSlug?: string
        agentInstructions?: string
        declaredDomain?: string
      } = {}
      if (!settings.homePageSlug) patch.homePageSlug = "accueil"
      if (!hasAuthoredAgentInstructions(settings.agentInstructions)) {
        patch.agentInstructions = DEFAULT_AGENT_INSTRUCTIONS
      }
      if (!settings.declaredDomain?.trim() && hoteEnv) {
        patch.declaredDomain = hoteEnv
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(settings._id, patch)
    }

    return { ...created, author }
  },
})
