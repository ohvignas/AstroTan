export const EXTRACT_TIMEOUT_MS = 45_000
export const MAX_EXTRACT_ERROR_LENGTH = 280

export const EXTRACT_ERRORS = {
  timeout:
    "L'extraction a trop duré. Réessayez, ou convertissez le fichier en Markdown.",
  parse: "Impossible d'extraire le texte de ce fichier.",
  empty:
    "Aucun texte extractible, même après OCR. Réessayez, ou convertissez le fichier en Markdown.",
  missing: "Le fichier a disparu du stockage. Téléversez-le à nouveau.",
  tooLarge: "Ce fichier dépasse la taille maximale autorisée pour l'extraction.",
  noKey:
    "L'OCR des PDF scannés exige une clé OpenRouter. Ajoutez-la dans la section Modèle IA.",
  ocr: "L'OCR n'a pas pu lire ce PDF. Réessayez, ou convertissez le fichier en Markdown.",
} as const

export type ExtractErrorCode = keyof typeof EXTRACT_ERRORS

export class ExtractFailure extends Error {
  readonly code: ExtractErrorCode

  constructor(code: ExtractErrorCode) {
    super(EXTRACT_ERRORS[code])
    this.name = "ExtractFailure"
    this.code = code
  }
}

function extractErrorCode(error: unknown): ExtractErrorCode | null {
  if (error instanceof ExtractFailure) return error.code
  if (error === null || typeof error !== "object") return null
  const code = "code" in error ? error.code : undefined
  if (typeof code === "string" && code in EXTRACT_ERRORS) {
    return code as ExtractErrorCode
  }
  const message = "message" in error && typeof error.message === "string" ? error.message : ""
  const matched = (Object.keys(EXTRACT_ERRORS) as ExtractErrorCode[]).find(
    (key) => EXTRACT_ERRORS[key] === message,
  )
  return matched ?? null
}

export function describeExtractFailure(error: unknown): string {
  const code = extractErrorCode(error)
  if (code !== null) return EXTRACT_ERRORS[code]
  return EXTRACT_ERRORS.parse
}

export async function withExtractTimeout<T>(
  work: Promise<T>,
  ms = EXTRACT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractFailure("timeout")), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
