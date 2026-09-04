import {
  MAX_CANONICAL_URL_LENGTH,
  MAX_GEO_ANSWER_LENGTH,
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
  MAX_GEO_QUESTION_LENGTH,
  MAX_GEO_SUMMARY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
} from "@astrotan/backend/convex/content"
import type { FieldOf, PostFormApi } from "@/lib/postForm"
import { PostTextField } from "@/components/post-text-field"
import { RepeatableItems } from "@/components/repeatable-items"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"

export function PostAdvancedFields({
  form,
  canWrite,
  titlePlaceholder,
}: {
  form: PostFormApi
  canWrite: boolean
  titlePlaceholder: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Visibilité sociale</h3>
      <p className="text-xs text-muted-foreground">
        Google, aperçus et partages.
      </p>
      <PostTextField
        form={form}
        name="seoTitle"
        label="Titre Google"
        maxLength={MAX_SEO_TITLE_LENGTH}
        disabled={!canWrite}
        placeholder={titlePlaceholder}
        helper="Si vide, on utilise le titre."
      />
      <PostTextField
        form={form}
        name="seoDescription"
        label="Méta description"
        maxLength={MAX_SEO_DESCRIPTION_LENGTH}
        disabled={!canWrite}
        multiline
        helper="Si vide, on utilise l’extrait."
      />
      <PostTextField
        form={form}
        name="slug"
        label="Slug"
        maxLength={MAX_SLUG_LENGTH}
        disabled={!canWrite}
        helper={
          <>
            Chemin public sous <code>/blog/</code> — sans slash de tête ni de
            fin.
          </>
        }
      />
      <PostTextField
        form={form}
        name="seoCanonicalUrl"
        label="URL canonique"
        maxLength={MAX_CANONICAL_URL_LENGTH}
        disabled={!canWrite}
        placeholder="https://…"
      />
      <form.Field
        name="seoNoindex"
        children={(field: FieldOf<"seoNoindex">) => (
          <Field orientation="horizontal">
            <Switch
              id={field.name}
              checked={field.state.value}
              disabled={!canWrite}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
            />
            <FieldLabel htmlFor={field.name}>
              Exclure des moteurs de recherche (noindex)
            </FieldLabel>
          </Field>
        )}
      />

      <h3 className="text-sm font-medium">Moteurs de réponse (GEO)</h3>
      <PostTextField
        form={form}
        name="geoSummary"
        label="Résumé extractible"
        maxLength={MAX_GEO_SUMMARY_LENGTH}
        disabled={!canWrite}
        multiline
        helper="Ce qu’un moteur de réponse citera tel quel. Deux ou trois phrases factuelles, qui se suffisent hors contexte."
      />
      <PostTextField
        form={form}
        name="geoEntities"
        label="Entités"
        maxLength={(MAX_GEO_ENTITY_LENGTH + 2) * MAX_GEO_ENTITIES}
        disabled={!canWrite}
        placeholder="AstroTan, Convex, Astro"
        helper={`Ce dont parle l’article, séparé par des virgules — de quoi lever une ambiguïté de nom. ${MAX_GEO_ENTITIES} au maximum.`}
      />
      <form.Field
        name="geoFaq"
        children={(field: FieldOf<"geoFaq">) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Questions / réponses</FieldLabel>
            <FieldDescription>
              Émises en JSON-LD <code>FAQPage</code> — le format que les
              moteurs de réponse citent le plus fidèlement. {MAX_GEO_FAQ_ITEMS}{" "}
              au maximum.
            </FieldDescription>
            <RepeatableItems
              items={field.state.value}
              disabled={!canWrite || field.state.value.length >= MAX_GEO_FAQ_ITEMS}
              addLabel="Ajouter une question"
              emptyItem={{ question: "", answer: "" }}
              fields={[
                {
                  key: "question",
                  label: "Question",
                  max: MAX_GEO_QUESTION_LENGTH,
                },
                {
                  key: "answer",
                  label: "Réponse",
                  max: MAX_GEO_ANSWER_LENGTH,
                  multiline: true,
                },
              ]}
              onChange={field.handleChange}
            />
          </div>
        )}
      />
      <form.Field
        name="geoNoai"
        children={(field: FieldOf<"geoNoai">) => (
          <Field orientation="horizontal">
            <Switch
              id={field.name}
              checked={field.state.value}
              disabled={!canWrite}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
            />
            <FieldLabel htmlFor={field.name}>
              Interdire la reprise par les IA génératives
            </FieldLabel>
          </Field>
        )}
      />
      <FieldDescription>
        Distinct de <code>noindex</code> : un article peut rester indexable par
        un moteur de recherche sans que son contenu soit repris par un moteur
        de réponse.
      </FieldDescription>
    </div>
  )
}
