// Le sommaire d'un article, construit depuis l'HTML rendu.
//
// Le template `astro-emdash` reçoit ses `headings` d'`astro:content`, qui
// les extrait du Markdown à la compilation. Nos articles sont de l'HTML
// stocké dans Convex : personne ne les a jamais analysés, et il n'y a donc
// pas de liste toute faite.
//
// Ce qu'on a vérifié plutôt que supposé : l'éditeur du dashboard (Tiptap)
// émet des `<h2>` NUS, sans `id`. Et même s'il en posait un,
// `renderStoredHtml` le retirerait — l'allowlist de `sanitize-html`
// n'accepte que `class` sur les balises génériques.
//
// D'où l'ordre, qui est la seule chose délicate ici : **assainir d'abord,
// poser les ancres ensuite**. Élargir l'allowlist à `id` aurait été
// l'inverse, et aurait laissé un auteur choisir des `id` arbitraires —
// c'est la porte du DOM clobbering, où un `id` bien choisi masque une
// propriété de `document`. Ici les ancres sont engendrées à partir du seul
// texte, après nettoyage, donc l'auteur ne les choisit pas.
//
// Une expression régulière et non un analyseur d'HTML : elle ne s'applique
// qu'à du balisage DÉJÀ passé par l'allowlist, dont le jeu de balises est
// clos et les attributs connus. Sur de l'HTML arbitraire ce serait une
// mauvaise idée.

export interface Heading {
  depth: number
  slug: string
  text: string
}

export interface ExtractedToc {
  headings: Heading[]
  /** Le même HTML, avec un `id` sur chaque titre relevé. */
  html: string
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
}

function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+|#\d+);/gi, (match, name: string) => {
      const known = ENTITIES[name.toLowerCase()]
      if (known !== undefined) return known
      // `&eacute;` et les autres entités nommées d'accents : le tableau
      // ci-dessus ne les liste pas une par une, `String.fromCharCode` ne
      // sait pas les résoudre, et une table complète serait un dictionnaire
      // de 2000 lignes. On les laisse telles quelles sauf les usuelles.
      const accents: Record<string, string> = {
        eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â",
        ccedil: "ç", ugrave: "ù", ucirc: "û", icirc: "î", iuml: "ï",
        ouml: "ö", ocirc: "ô", auml: "ä", uuml: "ü", euml: "ë",
      }
      return accents[name.toLowerCase()] ?? match
    })
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

/**
 * Transforme un libellé en ancre d'URL.
 *
 * `NFD` puis suppression des diacritiques : « Café » et « Cafe » donnent la
 * même ancre, ce qui évite une URL contenant un caractère accentué encodé
 * en pourcents dans la barre d'adresse.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Relever les `<h2>`/`<h3>` d'un corps d'article et leur poser une ancre.
 *
 * Ne touche ni `h1` (le titre de l'article, qui est hors du corps) ni `h4`
 * et au-delà (trop fins pour un sommaire de deux niveaux).
 *
 * @param html HTML **déjà assaini** par `renderStoredHtml`.
 */
export function extractHeadings(html: string): ExtractedToc {
  const headings: Heading[] = []
  const used = new Set<string>()

  const out = html.replace(
    /<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (whole, tag: string, attrs: string, inner: string) => {
      const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim()
      // Un titre vide n'a rien à annoncer dans un sommaire, et son ancre
      // pointerait sur une ligne invisible.
      if (text === "") return whole

      const base = slugifyHeading(text) || `section-${headings.length + 1}`
      // Deux titres identiques donneraient deux ancres identiques, et le
      // lien du second sauterait au premier — sans erreur, ce qui est le
      // pire cas.
      let slug = base
      let n = 2
      while (used.has(slug)) slug = `${base}-${n++}`
      used.add(slug)

      headings.push({ depth: Number(tag[1]), slug, text })
      // `id` ajouté APRÈS les attributs existants, pour ne pas écraser une
      // `class` que l'auteur aurait posée.
      return `<${tag}${attrs} id="${slug}">${inner}</${tag}>`
    }
  )

  return { headings, html: out }
}

/**
 * Temps de lecture, en minutes, depuis l'HTML d'un corps.
 *
 * 200 mots/minute, la même constante que le template. Toujours au moins 1 :
 * « 0 min de lecture » ne veut rien dire.
 */
export function readingTime(html: string): number {
  const words = html
    .replace(/<[^>]*>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}
