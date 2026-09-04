import { ConvexError } from "convex/values"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { describePageError } from "@/lib/pageErrors"
import { splitEntities } from "@/lib/contentGuards"
import { buildSeo } from "@/lib/buildSeo"
import { coverPatch } from "@/lib/coverPatch"

export type Profile = FunctionReturnType<typeof api.profiles.me>
export type PostDoc = NonNullable<FunctionReturnType<typeof api.posts.get>> & {
  hasUnpublishedChanges?: boolean
}

export type PostFormValues = {
  title: string
  slug: string
  excerpt: string
  body: string
  coverId: Id<"_storage"> | null
  targetKeyword: string
  seoTitle: string
  seoDescription: string
  seoCanonicalUrl: string
  seoNoindex: boolean
  geoSummary: string
  geoEntities: string
  geoFaq: { question: string; answer: string }[]
  geoNoai: boolean
}

export type FieldOf<K extends keyof PostFormValues> = {
  name: string
  state: { value: PostFormValues[K] }
  handleBlur: () => void
  handleChange: (value: PostFormValues[K]) => void
}

/** TanStack Form n'exporte pas un `Field` portable hors du `useForm`. */
export type PostFormApi = {
  Field: any
  Subscribe: any
}

export const POST_ERROR_MESSAGES: Record<string, string> = {
  SLUG_ALREADY_EXISTS: "Ce slug est déjà utilisé par un autre article.",
  UNKNOWN_MEDIA: "Cette image n'existe plus dans la médiathèque.",
}

export function describePostError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string" && POST_ERROR_MESSAGES[code]) {
        return POST_ERROR_MESSAGES[code]
      }
    }
  }
  return describePageError(error)
}

export function initialValues(post: PostDoc): PostFormValues {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? "",
    body: post.body,
    coverId: post.coverId ?? null,
    targetKeyword: post.targetKeyword ?? "",
    seoTitle: post.seo?.title ?? "",
    seoDescription: post.seo?.description ?? "",
    seoCanonicalUrl: post.seo?.canonicalUrl ?? "",
    seoNoindex: post.seo?.noindex ?? false,
    geoSummary: post.geo?.summary ?? "",
    geoEntities: (post.geo?.entities ?? []).join(", "),
    geoFaq: post.geo?.faq ?? [],
    geoNoai: post.geo?.noai ?? false,
  }
}

export function autoFieldsOf(
  values: PostFormValues,
  existing?: { ogImageId?: Id<"_storage"> },
) {
  return {
    title: values.title,
    body: values.body,
    excerpt: values.excerpt,
    ...coverPatch(values.coverId),
    targetKeyword: values.targetKeyword,
    seo: buildSeo({
      existing,
      fields: {
        title: values.seoTitle,
        description: values.seoDescription,
        canonicalUrl: values.seoCanonicalUrl,
        noindex: values.seoNoindex,
      },
    }),
    geo: {
      summary: values.geoSummary.trim() || undefined,
      faq: values.geoFaq.filter(
        (item) => item.question.trim() !== "" && item.answer.trim() !== "",
      ),
      entities: splitEntities(values.geoEntities),
      noai: values.geoNoai,
    },
  }
}

export const EMPTY_POST_FORM: PostFormValues = {
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  coverId: null,
  targetKeyword: "",
  seoTitle: "",
  seoDescription: "",
  seoCanonicalUrl: "",
  seoNoindex: false,
  geoSummary: "",
  geoEntities: "",
  geoFaq: [],
  geoNoai: false,
}
