// The content contract: which texts of which page the dashboard may edit.
//
// This module is the single source of truth, imported by all three sides:
//
//   - the Astro page, which reads each field to render it;
//   - the dashboard, which generates its form from this list and nothing
//     else — it has no other way to know a field exists;
//   - the Convex mutation, which refuses any key not declared here.
//
// It is also, deliberately, the document an agent reads before editing a
// page: "these are the texts, this is what each one is for, this is how
// long it may be". Adding a field here and referencing it from the `.astro`
// page is the whole procedure — there is no third place to update.
//
// What is NOT here, on purpose: layout, spacing, colour, image choice,
// link targets, or the number of cards in a list. Those live in the page's
// markup, where they are edited as code. The dashboard changes what a page
// says, never what it looks like.

/** How a field is presented, and what it may contain. */
export type ContentFieldType =
  /** One line, no markup. Headings, badges, button labels. */
  | "line"
  /** Several lines, no markup. Standfirsts, card descriptions. */
  | "text"
  /**
   * One or more lines with *inline* markup only — bold, italic, links.
   * Never block markup: no headings, no lists, no paragraphs. This exists
   * because real copy needs emphasis mid-sentence ("**4,8/5** sur les avis
   * Google"), and splitting that into three fields to avoid markup would
   * be worse for everyone editing it.
   */
  | "rich"

export interface ContentField {
  /** Stable identifier, `section.nom`. Renaming one loses its stored text. */
  key: string
  /** What the dashboard shows above the input. */
  label: string
  /** Section heading the dashboard groups this field under. */
  group: string
  type: ContentFieldType
  /** Upper bound, enforced by the mutation — not merely by the input. */
  max: number
  /**
   * The text the page ships with. Rendered whenever nothing has been saved
   * for this key, so a freshly-created page is complete rather than a grid
   * of empty boxes — and so the dashboard can show what has actually been
   * changed.
   */
  fallback: string
  /** Shown under the input when the label alone is not enough. */
  hint?: string
}

export interface PageContentDefinition {
  /** Matches `pages.slug`. */
  slug: string
  label: string
  fields: ContentField[]
}

// ---------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------

const ACCUEIL: PageContentDefinition = {
  slug: "accueil",
  label: "Accueil",
  fields: [
    {
      key: "hero.badge",
      label: "Pastille",
      group: "Hero",
      type: "line",
      max: 80,
      fallback: "École No-Code & IA · 100% à distance",
    },
    {
      key: "hero.titreLigne1",
      label: "Titre — première ligne",
      group: "Hero",
      type: "line",
      max: 60,
      fallback: "Apprenez à créer avec",
      hint: "Reste en noir.",
    },
    {
      key: "hero.titreLigne2",
      label: "Titre — seconde ligne",
      group: "Hero",
      type: "line",
      max: 60,
      fallback: "le No-Code & l'IA",
      hint: "Affichée en rose. Deux champs plutôt qu'un parce que la couleur est portée par le design, pas par le texte.",
    },
    {
      key: "hero.accroche",
      label: "Accroche",
      group: "Hero",
      type: "text",
      max: 300,
      fallback:
        "Formez-vous aux métiers de la tech avec des parcours certifiants, intensifs et adaptés à vos objectifs, accompagnés par des experts du secteur.",
    },
    {
      key: "hero.ctaPrincipal",
      label: "Bouton principal",
      group: "Hero",
      type: "line",
      max: 40,
      fallback: "Découvrir nos parcours →",
      hint: "Le lien de destination se règle dans le code, pas ici.",
    },
    {
      key: "hero.ctaSecondaire",
      label: "Bouton secondaire",
      group: "Hero",
      type: "line",
      max: 40,
      fallback: "Me faire accompagner",
    },
    {
      key: "hero.preuveSociale",
      label: "Preuve sociale",
      group: "Hero",
      type: "rich",
      max: 120,
      fallback: "**4,8/5** sur les avis Google · éligible **CPF**",
      hint: "Le gras s'écrit entre doubles astérisques : **texte**.",
    },
  ],
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

const DEFINITIONS: PageContentDefinition[] = [ACCUEIL]

export const PAGE_CONTENT: Record<string, PageContentDefinition> =
  Object.fromEntries(DEFINITIONS.map((definition) => [definition.slug, definition]))

/** The definition for a slug, or `null` for a page with no declared texts. */
export function contentDefinitionFor(slug: string): PageContentDefinition | null {
  return PAGE_CONTENT[slug] ?? null
}

/**
 * Resolve one field for rendering: the saved text when there is one, the
 * declared fallback otherwise.
 *
 * An empty saved string counts as saved — deleting a text is a legitimate
 * edit, and silently restoring the fallback would make it impossible.
 */
export function resolveContent(
  definition: PageContentDefinition | null,
  stored: Record<string, string> | undefined,
  key: string
): string {
  const saved = stored?.[key]
  if (saved !== undefined) return saved
  return definition?.fields.find((field) => field.key === key)?.fallback ?? ""
}

/**
 * Reject anything the page has not declared, and anything too long.
 *
 * Called by `pages.update` before the patch. Refusing undeclared keys is
 * what keeps this map from drifting into a junk drawer: a key that no page
 * reads is a text someone believes they edited and nobody will ever see.
 */
export function assertContentValid(
  definition: PageContentDefinition | null,
  content: Record<string, string>
): { code: string; field?: string; max?: number } | null {
  if (definition === null) {
    const [first] = Object.keys(content)
    return first === undefined ? null : { code: "NO_CONTENT_FIELDS", field: first }
  }
  const byKey = new Map(definition.fields.map((field) => [field.key, field]))
  for (const [key, value] of Object.entries(content)) {
    const field = byKey.get(key)
    if (field === undefined) return { code: "UNKNOWN_CONTENT_FIELD", field: key }
    if (value.length > field.max) {
      return { code: "FIELD_TOO_LONG", field: key, max: field.max }
    }
    // A "line" field lands in a heading or a button; a newline there does
    // not render as a break, it just makes the markup lie about its shape.
    if (field.type === "line" && /[\r\n]/.test(value)) {
      return { code: "FIELD_NOT_A_LINE", field: key }
    }
  }
  return null
}
